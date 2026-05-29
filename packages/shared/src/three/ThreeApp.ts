// ThreeApp.ts
import * as THREE from "three";
import { FlyControls } from "./FlyControls";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { ControlMode, MobileOrbitTool, PerformanceSettings, SceneInfo } from "./ScreenSpace";
import { ScreenSpaceUI, PERFORMANCE_PRESETS } from "./ScreenSpace";
import {
  GaussianViewer,
  type GaussianLoadProgress,
  type SphericalHarmonicsDegree,
} from "./GaussianViewer";
import { WorldMarkers } from "./WorldMarkers";
import { Skybox } from "./Skybox";
import { LoadingOverlay } from "./LoadingOverlay";
import { MarkerPickingController } from "./Interaction";


const DEFAULT_SKYBOX_URL = "/citrus_orchard_puresky_4k.hdr"; 

//we can change this per scene if we wanted to..
const DEFAULT_PLAY_AREA_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-25, -5, -25),
  new THREE.Vector3(25, 15, 25)
);
const DEFAULT_ORBIT_CAMERA_OFFSET = new THREE.Vector3(0, 2.5, 5);
const MARKER_VIEW_TRANSITION_MIN_DURATION = 1.1;
const MARKER_VIEW_TRANSITION_MAX_DURATION = 2.2;
const MARKER_VIEW_TRANSITION_DISTANCE_FACTOR = 0.018;
const MARKER_VIEW_TRANSITION_ARC_FACTOR = 0.3;

type CameraTransition = {
  target: THREE.Vector3;
  startPosition: THREE.Vector3;
  endPosition: THREE.Vector3;
  startQuaternion: THREE.Quaternion;
  endQuaternion: THREE.Quaternion;
  startDirection: THREE.Vector3;
  endRotation: THREE.Quaternion;
  startDistance: number;
  endDistance: number;
  duration: number;
  elapsed: number;
  spherical: boolean;
};

type ThreeAppOptions = {
  defaultControlMode?: ControlMode;
  onBack?: () => void;
  sceneInfo?: SceneInfo;
  sphericalHarmonicsDegree?: SphericalHarmonicsDegree;
  sidebarUi?: boolean;
};

export class ThreeApp {
  // Core
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;

  // Loop state
  private clock = new THREE.Clock();
  private fps = 0;
  private destroyed = false;

  // Performance settings (controlled by UI)
  private perfSettings: PerformanceSettings = PERFORMANCE_PRESETS.medium;

  // Resize
  private resizeObs?: ResizeObserver;
  private prevDpr = window.devicePixelRatio || 1;
  private prevW = 0;
  private prevH = 0;

  // Systems
  private flyControls: FlyControls | null = null;
  private orbitControls: OrbitControls | null = null;
  private controlMode: ControlMode = "fly";
  private readonly defaultControlMode: ControlMode;
  private readonly onBack?: () => void;
  private readonly sceneInfo?: SceneInfo;
  private readonly sphericalHarmonicsDegree: SphericalHarmonicsDegree;
  private readonly sidebarUi: boolean;
  private flySpeed = 0.5;
  private mobileOrbitTool: MobileOrbitTool = "rotate";
  private screenUI!: ScreenSpaceUI;
  private gaussian!: GaussianViewer;
  private skybox!: Skybox;
  private overlay!: LoadingOverlay;
  private markers!: WorldMarkers;

  // Picking
  private markerPicking!: MarkerPickingController;

  // Editor: placement preview (distance in front of camera, preview marker is passed via setWorldMarkers)
  private placementDistance = 0;

  // Debug
  private worldAxesScene = new THREE.Scene();
  private worldAxes?: THREE.AxesHelper;
  private transformControls?: TransformControls;
  private transformControlsHelper?: THREE.Object3D;
  private playAreaBounds: THREE.Box3 | null = null;
  private currentStartPos = new THREE.Vector3(0, 0, 0);
  private worldAxesVisible = true;
  private interestPointEditing = false;
  private onInterestPointChange?: (position: [number, number, number]) => void;
  private markerEditIndex: number | null = null;
  private onMarkerPositionCommit?: (position: [number, number, number]) => void;
  private activeTransformTarget: "interest" | "marker" | null = null;
  private cameraTransition: CameraTransition | null = null;

  // cene at reduced res, markers at full res
  private sceneRenderTarget: THREE.WebGLRenderTarget | null = null;
  private blitScene = new THREE.Scene();
  private blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitQuad: THREE.Mesh | null = null;


  // ------------------
  // CONSTRUCTOR
  // ------------------
  constructor(container: HTMLElement, options?: ThreeAppOptions) {
    this.container = container;
    this.defaultControlMode = options?.defaultControlMode ?? "orbit";
    this.onBack = options?.onBack;
    this.sceneInfo = options?.sceneInfo;
    this.sphericalHarmonicsDegree = options?.sphericalHarmonicsDegree ?? 0;
    this.sidebarUi = options?.sidebarUi ?? false;
    if (ThreeApp.isMobileLike()) {
      this.perfSettings = PERFORMANCE_PRESETS.low;
    }

    //systems
    this.initRenderer();
    this.initCamera();
    this.initGaussianViewer(); //needs cam,renderer

    this.initUI();
    this.initControls();
    this.initScene();

    // sizing
    this.resizeToContainer(false);
    this.observeResize();

    //start
    this.renderer.setAnimationLoop(this.tick);
  }

  private initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: false, // AA has minimal impact on splats
      powerPreference: "high-performance", // Request dedicated GPU
      stencil: false, // We don't use stencil
      depth: true,
    });
    Object.assign(this.renderer.domElement.style, {
      width: "100%",
      height: "100%",
      display: "block",
      cursor: "grab",
      touchAction: "none",
      overscrollBehavior: "none",
    });
    this.renderer.autoClear = false;

    // Set outputColorSpace if present in this three version
    if ("outputColorSpace" in this.renderer) {
      (
        this.renderer as unknown as { outputColorSpace: THREE.ColorSpace }
      ).outputColorSpace = THREE.SRGBColorSpace;
    }

    this.renderer.setClearColor(0x0e1116, 1);
    this.container.appendChild(this.renderer.domElement);
  }

  private initGaussianViewer() {
    this.gaussian = new GaussianViewer(this.renderer, this.camera, {
      splatAlphaRemovalThreshold: this.perfSettings.splatAlphaRemovalThreshold,
      sphericalHarmonicsDegree: this.sphericalHarmonicsDegree,
    });
  }

  private initUI() {
    this.screenUI = new ScreenSpaceUI(this.container, this.sidebarUi);
    this.overlay = new LoadingOverlay(this.container);
    this.screenUI.setMobileBackHandler(this.onBack);
    this.screenUI.setRuntimeInfo({
      clientType: this.getClientType(),
      gpuRenderer: this.getGpuRendererName(),
    });
    this.screenUI.setMobileSceneInfo(this.sceneInfo ?? {});
  }

  private initCamera() {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    this.camera.position.set(0, 2.5, 5);
  }

  private initControls() {
    this.flyControls = new FlyControls(this.camera, this.renderer.domElement);
    this.setPlayAreaBounds(DEFAULT_PLAY_AREA_BOUNDS);
    this.screenUI.setSpeedChangeHandler((v) => {
      this.flySpeed = v;
      this.flyControls?.setFlySpeed(v);
    });
    this.flyControls.setFlySpeed(this.flySpeed);
    this.screenUI.setSpeed(this.flySpeed);
    this.screenUI.setControlModeChangeHandler((mode) => this.setControlMode(mode));
    this.screenUI.setMobileOrbitToolChangeHandler((tool) => this.setMobileOrbitTool(tool));
    this.screenUI.setMobileResetHandler(() => this.resetOrbitCamera());
    this.screenUI.setPerformancePreset(this.perfSettings.preset);
    this.setControlMode(this.defaultControlMode);
    
    // Performance preset handler
    this.screenUI.setPerformanceChangeHandler((settings) => {
      this.applyPerformanceSettings(settings);
    });
  }

  private initSkybox() {
    this.skybox = new Skybox();
    void this.skybox
      .setEquirectangular(DEFAULT_SKYBOX_URL)
      .then(() => {
        if (this.markers) {
          this.markers.setEnvironmentMap(this.skybox.getEnvironmentMap());
        }
      });
  }

  private initScene() {
    this.markers = new WorldMarkers();
    this.markerPicking = new MarkerPickingController({
      dom: this.renderer.domElement,
      camera: this.camera,
      markers: this.markers,
      moveThresholdPx: ThreeApp.isMobileLike() ? 14 : 6,
    });
    this.initSkybox();
    this.worldAxes = new THREE.AxesHelper(0.75);
    const axisMaterials = Array.isArray(this.worldAxes.material)
      ? this.worldAxes.material
      : [this.worldAxes.material];
    for (const material of axisMaterials) {
      if ("linewidth" in material) {
        (material as THREE.Material & { linewidth?: number }).linewidth = 5;
      }
    }
    this.worldAxesScene.add(this.worldAxes);
    this.markerPicking.setInterestPointObject(this.worldAxes);

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.attach(this.worldAxes);
    this.transformControls.setMode("translate");
    this.transformControls.enabled = false;
    this.transformControlsHelper = this.transformControls.getHelper();
    this.transformControlsHelper.visible = false;
    this.transformControls.addEventListener("dragging-changed", (event) => {
      const isDragging = Boolean((event as { value?: unknown }).value);
      this.applyInteractionState(isDragging);
    });
    this.transformControls.addEventListener("objectChange", () => {
      if (this.activeTransformTarget === "interest" && this.worldAxes) {
        this.currentStartPos.copy(this.worldAxes.position);
        this.orbitControls?.target.copy(this.currentStartPos);
        this.orbitControls?.update();
        this.onInterestPointChange?.([
          this.currentStartPos.x,
          this.currentStartPos.y,
          this.currentStartPos.z,
        ]);
      }
    });
    this.transformControls.addEventListener("mouseUp", () => {
      if (this.activeTransformTarget !== "marker" || this.markerEditIndex === null) return;
      const sprite = this.markers.getSpriteAt(this.markerEditIndex);
      if (!sprite) return;
      this.onMarkerPositionCommit?.([
        sprite.position.x,
        sprite.position.y,
        sprite.position.z,
      ]);
    });
    this.worldAxesScene.add(this.transformControlsHelper);
    this.applyInteractionState(false);
  }


  // ------------------
  // MAIN LOOP
  // ------------------
  private tick = () => {
    const dt = this.updateFPS();
    this.resizeToContainer();
    this.beginFrame();
    this.update(dt);
    this.renderFrame();
    this.renderDebug();
  };

  private beginFrame() {
    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, true);
  }

  private update(dt: number) {
    if (this.cameraTransition) {
      this.updateCameraTransition(dt);
    } else if (this.controlMode === "fly") {
      this.flyControls?.update(dt);
    } else {
      this.orbitControls?.update();
    }
    this.gaussian.update();
    this.screenUI.setPlayerWorldPosition(this.camera.position);
    this.screenUI.setFps(this.fps);
    this.screenUI.update();

    if (this.placementDistance > 0) {
      this.markers.setPlacementPreviewPosition(this.getPlacementPosition());
    }
  }

  private renderFrame() {
    if (this.sceneRenderTarget) {
      // Low-quality path: render scene (skybox + gaussian) to reduced-res RT, then composite and draw markers at full res
      this.renderer.setRenderTarget(this.sceneRenderTarget);
      this.renderer.clear(true, true, true);
      this.skybox.render(this.renderer, this.camera);
      this.gaussian.render();

      this.renderer.setRenderTarget(null);
      this.renderer.clear(true, true, true);
      this.ensureBlitQuad();
      const mat = this.blitQuad!.material as THREE.MeshBasicMaterial;
      mat.map = this.sceneRenderTarget!.texture;
      this.renderer.render(this.blitScene, this.blitCamera);

      // Markers (and label) at full resolution
      this.markers.render(this.renderer, this.camera);
      this.markers.renderOverlay(this.renderer, this.camera);
    } else {
      // Full quality path. everything to canvas
      this.skybox.render(this.renderer, this.camera);
      this.markers.render(this.renderer, this.camera);
      this.gaussian.render();
      this.markers.renderOverlay(this.renderer, this.camera);
    }
  }

  private ensureBlitQuad() {
    if (this.blitQuad) return;
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.MeshBasicMaterial({
      map: null,
      depthTest: false,
      depthWrite: false,
    });
    this.blitQuad = new THREE.Mesh(geo, mat);
    this.blitScene.add(this.blitQuad);
  }

  private renderDebug() {
    this.renderer.clearDepth();
    this.renderer.render(this.worldAxesScene, this.camera);
  }

  // -------------------------------------------------------------------------
  //PUBLIC METHODS-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  public async loadGaussianScene(path: string) {
    if (this.destroyed) return;
    this.overlay.show();
    this.overlay.setHint("Downloading scene data...");
    this.overlay.setProgress(0);
    try {
      await this.gaussian.loadScene(path, (state) => this.updateOverlayForGaussianLoad(state));
      if (!this.destroyed) {
        this.cameraTransition = null;
        this.camera.position.copy(this.currentStartPos).add(DEFAULT_ORBIT_CAMERA_OFFSET);
        if (this.orbitControls) {
          this.orbitControls.target.copy(this.currentStartPos);
          this.orbitControls.update();
        }
        this.flyControls?.syncFromCamera();
        this.applyInteractionState(false);
      }
    } finally {
      if (!this.destroyed) this.overlay.hide();
    }
  }

  //we will use this later probably
  public async setSkybox(path: string | null | undefined) {
    if (this.destroyed) return;
    await this.skybox.setEquirectangular(path);
    this.markers.setEnvironmentMap(this.skybox.getEnvironmentMap());
  }

  public setWorldMarkers(
    markers: Parameters<WorldMarkers["setMarkers"]>[0],
    previewMarker?: Parameters<WorldMarkers["setMarkers"]>[1],
    selectedIndex?: Parameters<WorldMarkers["setMarkers"]>[2]
  ) {
    this.markers.setMarkers(markers, previewMarker, selectedIndex);
    this.syncTransformAttachment();
  }

  public setWorldAxesPosition(position: THREE.Vector3 | [number, number, number]) {
    if (Array.isArray(position)) {
      this.currentStartPos.set(position[0], position[1], position[2]);
    } else {
      this.currentStartPos.copy(position);
    }

    this.worldAxes?.position.copy(this.currentStartPos);
    this.orbitControls?.target.copy(this.currentStartPos);
    this.orbitControls?.update();
  }

  public setWorldAxesVisible(visible: boolean) {
    this.worldAxesVisible = visible;
    if (this.worldAxes) {
      this.worldAxes.visible = visible;
    }
  }

  public setInterestPointEditing(
    enabled: boolean,
    onChange?: (position: [number, number, number]) => void
  ) {
    this.interestPointEditing = enabled;
    this.onInterestPointChange = enabled ? onChange : undefined;
    if (enabled) {
      this.markerEditIndex = null;
      this.onMarkerPositionCommit = undefined;
    }
    this.syncTransformAttachment();
    this.applyInteractionState(false);
  }

  public setMarkerEditing(
    markerIndex: number | null,
    onCommit?: (position: [number, number, number]) => void
  ) {
    this.markerEditIndex = markerIndex;
    this.onMarkerPositionCommit = markerIndex !== null ? onCommit : undefined;
    if (markerIndex !== null) {
      this.interestPointEditing = false;
      this.onInterestPointChange = undefined;
    }
    this.syncTransformAttachment();
    this.applyInteractionState(false);
  }

  public getCamera(): THREE.Camera {
    return this.camera;
  }

  public getCameraPosition(): [number, number, number] {
    return [this.camera.position.x, this.camera.position.y, this.camera.position.z];
  }

  public getViewerAddonHost(): HTMLDivElement {
    return this.screenUI.getViewerAddonHost();
  }

  public moveCameraToMarkerView(
    markerPosition: [number, number, number],
    viewPosition: [number, number, number]
  ) {
    const startPosition = new THREE.Vector3();
    const startQuaternion = new THREE.Quaternion();
    this.camera.getWorldPosition(startPosition);
    this.camera.getWorldQuaternion(startQuaternion);

    const target = new THREE.Vector3(...markerPosition);
    const endPosition = new THREE.Vector3(...viewPosition);
    const startOffset = startPosition.clone().sub(target);
    const endOffset = endPosition.clone().sub(target);
    const startDistance = startOffset.length();
    const endDistance = endOffset.length();
    const spherical = startDistance > 0.0001 && endDistance > 0.0001;
    const startDirection = spherical ? startOffset.normalize() : new THREE.Vector3();
    const endDirection = spherical ? endOffset.normalize() : new THREE.Vector3();
    const arcAngle = spherical ? startDirection.angleTo(endDirection) : 0;
    const travelDistance = startPosition.distanceTo(endPosition);
    const duration = THREE.MathUtils.clamp(
      MARKER_VIEW_TRANSITION_MIN_DURATION +
        travelDistance * MARKER_VIEW_TRANSITION_DISTANCE_FACTOR +
        arcAngle * MARKER_VIEW_TRANSITION_ARC_FACTOR,
      MARKER_VIEW_TRANSITION_MIN_DURATION,
      MARKER_VIEW_TRANSITION_MAX_DURATION
    );
    const destinationCamera = this.camera.clone();
    destinationCamera.position.copy(endPosition);
    destinationCamera.lookAt(target);

    this.cameraTransition = {
      target,
      startPosition,
      endPosition,
      startQuaternion,
      endQuaternion: destinationCamera.quaternion.clone(),
      startDirection,
      endRotation: spherical
        ? new THREE.Quaternion().setFromUnitVectors(startDirection, endDirection)
        : new THREE.Quaternion(),
      startDistance,
      endDistance,
      duration,
      elapsed: 0,
      spherical,
    };

    this.applyInteractionState(false);
  }

  public toggleWorldMarkerLabel(index: number) {
    const sprite = this.markers.getSpriteAt(index);
    if (sprite) {
      this.markers.toggleLabelForSprite(sprite, this.camera);
    }
  }

  public showWorldMarkerLabel(index: number) {
    const sprite = this.markers.getSpriteAt(index);
    if (sprite) {
      this.markers.showLabelForSprite(sprite, this.camera);
    }
  }

  /** When > 0, placement preview is shown. update its position each frame via setPlacementPreviewPosition. */
  public setPlacementDistance(distance: number) {
    this.placementDistance = Math.max(0, distance);
  }

  /** Current world position of the placement preview (camera + forward * placementDistance). */
  public getPlacementPosition(): THREE.Vector3 {
    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.camera.quaternion)
      .normalize();
    return this.camera.position.clone().addScaledVector(forward, this.placementDistance);
  }

  public setEditorCallbacks(callbacks: {
    onMarkerClick?: (index: number) => void;
    onPlaceClick?: () => void;
    onInterestPointClick?: () => void;
  }) {
    this.markerPicking.setEditorCallbacks(callbacks);
  }

  public setPlayAreaBounds(bounds: THREE.Box3 | null | undefined) {
    this.playAreaBounds = bounds ? bounds.clone() : null;
    this.flyControls?.setBounds(this.playAreaBounds);
  }

  // -------------------------------------------------------------------------
  //HELPER METHODS-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  private resizeToContainer(force = false) {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const canvasDpr = this.getEffectiveCanvasDpr();

    if (!force && this.prevDpr === canvasDpr && this.prevW === w && this.prevH === h) {
      const sceneDpr = Math.min(canvasDpr, this.perfSettings.pixelRatio);
      if (sceneDpr >= canvasDpr - 0.01) return; // no RT path
      const rtw = Math.max(1, Math.round(w * sceneDpr));
      const rth = Math.max(1, Math.round(h * sceneDpr));
      if (this.sceneRenderTarget && this.sceneRenderTarget.width === rtw && this.sceneRenderTarget.height === rth) {
        return;
      }
    }
    this.prevDpr = canvasDpr;
    this.prevW = w;
    this.prevH = h;

    this.renderer.setPixelRatio(canvasDpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // When quality is low, use a reduced-resolution render target for the 3D scene only
    const sceneDpr = Math.min(canvasDpr, this.perfSettings.pixelRatio);
    if (sceneDpr < canvasDpr - 0.01) {
      const rtw = Math.max(1, Math.round(w * sceneDpr));
      const rth = Math.max(1, Math.round(h * sceneDpr));
      if (!this.sceneRenderTarget) {
        this.sceneRenderTarget = new THREE.WebGLRenderTarget(rtw, rth, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          colorSpace: THREE.SRGBColorSpace,
        });
      } else if (this.sceneRenderTarget.width !== rtw || this.sceneRenderTarget.height !== rth) {
        this.sceneRenderTarget.setSize(rtw, rth);
      }
    } else {
      if (this.sceneRenderTarget) {
        this.sceneRenderTarget.dispose();
        this.sceneRenderTarget = null;
      }
    }
  }

  private observeResize() {
    this.resizeObs = new ResizeObserver(() => this.resizeToContainer(true));
    this.resizeObs?.observe(this.container);
  }

  private getEffectiveCanvasDpr(): number {
    const rawDpr = window.devicePixelRatio || 1;
    const maxDpr = ThreeApp.isMobileLike() ? 1.25 : 2;
    return Math.min(rawDpr, maxDpr);
  }

  private updateFPS(): number {
    const dt = Math.max(0.0001, Math.min(0.1, this.clock.getDelta()));
    const instFps = 1 / dt;
    this.fps =
      this.fps === 0
        ? instFps
        : THREE.MathUtils.lerp(this.fps, instFps, 0.1); // smooth a bit
      
    return dt;
  }

  private updateOverlayForGaussianLoad(
    state: GaussianLoadProgress,
    reloading = false
  ) {
    this.overlay.setProgress(state.progress);

    if (state.phase === "downloading") {
      const prefix = reloading ? "Reloading virtual soil..." : "Downloading scene data...";
      this.overlay.setHint(
        state.progress === null
          ? prefix
          : `${prefix} ${Math.round(state.progress * 100)}%`
      );
      return;
    }

    if (state.phase === "processing") {
      this.overlay.setHint(reloading ? "Processing virtual soil..." : "Processing scene data...");
      return;
    }

    this.overlay.setHint("Finalizing virtual soil...");
  }

  private updateCameraTransition(dt: number) {
    const transition = this.cameraTransition;
    if (!transition) return;

    transition.elapsed += dt;
    const progress = Math.min(transition.elapsed / transition.duration, 1);
    const eased = progress * progress * progress * (progress * (progress * 6 - 15) + 10);

    if (transition.spherical) {
      const rotation = new THREE.Quaternion().slerp(
        transition.endRotation,
        eased
      );
      const direction = transition.startDirection.clone().applyQuaternion(rotation);
      const distance = THREE.MathUtils.lerp(
        transition.startDistance,
        transition.endDistance,
        eased
      );
      this.camera.position.copy(transition.target).addScaledVector(direction, distance);
    } else {
      this.camera.position.lerpVectors(transition.startPosition, transition.endPosition, eased);
    }

    this.camera.quaternion.slerpQuaternions(
      transition.startQuaternion,
      transition.endQuaternion,
      eased
    );
    if (progress < 1) return;

    this.camera.position.copy(transition.endPosition);
    this.camera.lookAt(transition.target);
    this.cameraTransition = null;
    this.flyControls?.syncFromCamera();
    this.orbitControls?.target.copy(transition.target);
    this.orbitControls?.update();
    this.applyInteractionState(false);
  }

  private applyPerformanceSettings(settings: PerformanceSettings) {
    const prevSettings = this.perfSettings;
    this.perfSettings = settings;
    
    console.log("[ThreeApp] Performance preset:", settings.preset);
    console.log("[ThreeApp] Alpha threshold:", settings.splatAlphaRemovalThreshold);
    console.log("[ThreeApp] Pixel ratio:", settings.pixelRatio);

    // Apply pixel ratio change
    this.resizeToContainer(true);

    // Alpha threshold change requires recreating the gaussian viewer and reloading
    if (settings.splatAlphaRemovalThreshold !== prevSettings.splatAlphaRemovalThreshold) {
      console.log("[ThreeApp] Alpha threshold changed, reloading scene...");
      this.recreateGaussianViewer();
    }
  }

  private async recreateGaussianViewer() {
    // Save current scene path
    const currentPath = this.gaussian.getCurrentPath();
    
    // Dispose old viewer
    this.gaussian.dispose();
    
    // Create new viewer with updated settings
    this.gaussian = new GaussianViewer(this.renderer, this.camera, {
      splatAlphaRemovalThreshold: this.perfSettings.splatAlphaRemovalThreshold,
      sphericalHarmonicsDegree: this.sphericalHarmonicsDegree,
    });
    
    // Reload scene if one was loaded
    if (currentPath) {
      this.overlay.show();
      this.overlay.setHint("Reloading virtual soil...");
      this.overlay.setProgress(0);
      try {
        await this.gaussian.loadScene(currentPath, (state) =>
          this.updateOverlayForGaussianLoad(state, true)
        );
      } finally {
        if (!this.destroyed) this.overlay.hide();
      }
    }
  }

  dispose() {
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObs?.disconnect();
    this.markerPicking.dispose();

    if (this.sceneRenderTarget) {
      this.sceneRenderTarget.dispose();
      this.sceneRenderTarget = null;
    }
    if (this.blitQuad) {
      this.blitQuad.geometry.dispose();
      (this.blitQuad.material as THREE.Material).dispose();
      this.blitQuad = null;
    }

    this.transformControls?.dispose();
    this.transformControls = undefined;
    this.transformControlsHelper = undefined;

    // Dispose controls
    this.flyControls?.dispose();
    this.orbitControls?.dispose();

    if (this.worldAxes) {
      this.worldAxes.geometry.dispose();
      const mats = Array.isArray(this.worldAxes.material)
        ? this.worldAxes.material
        : [this.worldAxes.material];
      for (const m of mats) {
        if ("dispose" in m && typeof m.dispose === "function") m.dispose();
      }
    }

    this.skybox.dispose();
    this.gaussian.dispose();
    this.screenUI.dispose();
    this.overlay.dispose();
    this.markers.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private setControlMode(mode: ControlMode) {
    if (mode === "fly" && ThreeApp.isMobileLike()) {
      mode = "orbit";
    }

    if (mode === this.controlMode) {
      this.syncControlModeUi(mode);
      return;
    }
    this.controlMode = mode;
    this.syncControlModeUi(mode);

    if (mode === "orbit") {
      this.flyControls?.dispose();
      this.flyControls = null;

      this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
      this.orbitControls.enableDamping = true;
      this.orbitControls.dampingFactor = 0.08;
      this.orbitControls.zoomSpeed = 0.9;
      this.orbitControls.panSpeed = 0.8;
      this.orbitControls.rotateSpeed = 0.9;

      this.orbitControls.target.copy(this.currentStartPos);
      this.orbitControls.update();
      this.applyMobileOrbitTool();
      this.applyInteractionState(false);
      this.renderer.domElement.style.cursor = "grab";
      return;
    }

    this.orbitControls?.dispose();
    this.orbitControls = null;

    this.flyControls = new FlyControls(this.camera, this.renderer.domElement);
    this.flyControls.setFlySpeed(this.flySpeed);
    this.flyControls.setBounds(this.playAreaBounds);
    this.screenUI.setSpeed(this.flySpeed);
    this.applyInteractionState(false);
  }

  private syncControlModeUi(mode: ControlMode) {
    this.screenUI.setControlMode(mode);
    this.screenUI.setSpeed(this.flySpeed);
    this.screenUI.setSpeedControlEnabled(mode === "fly");
    this.screenUI.setMobileOrbitTool(this.mobileOrbitTool);
  }

  private setMobileOrbitTool(tool: MobileOrbitTool) {
    this.mobileOrbitTool = tool;
    if (ThreeApp.isMobileLike()) {
      this.setControlMode("orbit");
    }
    this.screenUI.setMobileOrbitTool(tool);
    this.applyMobileOrbitTool();
  }

  private applyMobileOrbitTool() {
    if (!this.orbitControls || !ThreeApp.isMobileLike()) return;

    this.orbitControls.enableRotate = this.mobileOrbitTool === "rotate";
    this.orbitControls.enablePan = this.mobileOrbitTool === "pan";
    this.orbitControls.enableZoom = this.mobileOrbitTool === "zoom";

    this.orbitControls.touches.ONE =
      this.mobileOrbitTool === "rotate"
        ? THREE.TOUCH.ROTATE
        : this.mobileOrbitTool === "pan"
        ? THREE.TOUCH.PAN
        : null;
    this.orbitControls.touches.TWO =
      this.mobileOrbitTool === "zoom" ? THREE.TOUCH.DOLLY_PAN : null;
  }

  private resetOrbitCamera() {
    this.cameraTransition = null;
    this.setControlMode("orbit");
    this.camera.position.copy(this.currentStartPos).add(DEFAULT_ORBIT_CAMERA_OFFSET);
    if (this.orbitControls) {
      this.orbitControls.target.copy(this.currentStartPos);
      this.orbitControls.update();
      this.applyMobileOrbitTool();
    }
    this.flyControls?.syncFromCamera();
    this.applyInteractionState(false);
  }

  private applyInteractionState(isTransformDragging: boolean) {
    const hasActiveTransformTarget = this.activeTransformTarget !== null;

    if (this.transformControls) {
      this.transformControls.enabled = hasActiveTransformTarget;
    }
    if (this.transformControlsHelper) {
      this.transformControlsHelper.visible =
        this.activeTransformTarget === "interest"
          ? this.worldAxesVisible
          : this.activeTransformTarget === "marker";
    }
    if (this.worldAxes) {
      this.worldAxes.visible = this.worldAxesVisible;
    }

    this.markerPicking?.setEnabled(!isTransformDragging);

    if (this.orbitControls) {
      this.orbitControls.enabled = !isTransformDragging && !this.cameraTransition;
    }

    this.flyControls?.setEnabled(
      this.controlMode === "fly" && !isTransformDragging && !this.cameraTransition
    );
  }

  private syncTransformAttachment() {
    if (!this.transformControls) return;

    if (this.interestPointEditing && this.worldAxes) {
      this.transformControls.attach(this.worldAxes);
      this.activeTransformTarget = "interest";
      return;
    }

    if (this.markerEditIndex !== null) {
      const sprite = this.markers.getSpriteAt(this.markerEditIndex);
      if (sprite) {
        this.transformControls.attach(sprite);
        this.activeTransformTarget = "marker";
        return;
      }
    }

    this.transformControls.detach();
    this.activeTransformTarget = null;
  }

  private getClientType(): string {
    return ThreeApp.isMobileLike() ? "Mobile" : "Desktop";
  }

  private static isMobileLike(): boolean {
    const ua = navigator.userAgent || "";
    const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    return mobileUa || coarsePointer;
  }

  private getGpuRendererName(): string {
    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (!debugInfo) return "Unavailable";
    const rendererName = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    return typeof rendererName === "string" && rendererName.trim().length > 0
      ? rendererName
      : "Unavailable";
  }
}
