// ThreeApp.ts
import * as THREE from "three";
import { FlyControls } from "./FlyControls";
import type { PerformanceSettings } from "./ScreenSpace";
import { ScreenSpaceUI, PERFORMANCE_PRESETS } from "./ScreenSpace";
import { GaussianViewer } from "./GaussianViewer";
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
  private controls!: FlyControls;
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
  private playAreaBounds: THREE.Box3 | null = null;

  // cene at reduced res, markers at full res
  private sceneRenderTarget: THREE.WebGLRenderTarget | null = null;
  private blitScene = new THREE.Scene();
  private blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blitQuad: THREE.Mesh | null = null;


  // ------------------
  // CONSTRUCTOR
  // ------------------
  constructor(container: HTMLElement) {
    this.container = container;

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
    });
  }

  private initUI() {
    this.screenUI = new ScreenSpaceUI(this.container);
    this.overlay = new LoadingOverlay(this.container);
  }

  private initCamera() {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    this.camera.position.set(0, 2.5, 5);
  }

  private initControls() {
    this.controls = new FlyControls(this.camera, this.renderer.domElement);
    this.setPlayAreaBounds(DEFAULT_PLAY_AREA_BOUNDS);
    this.screenUI.setSpeedChangeHandler((v) => this.controls.setFlySpeed(v));
    this.screenUI.setSpeed(this.controls.getFlySpeed());
    
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
      moveThresholdPx: 6,
    });
    this.initSkybox();
    this.worldAxes = new THREE.AxesHelper(1);
    this.worldAxesScene.add(this.worldAxes);
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
    this.controls.update(dt);
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
    } else {
      // Full quality path. everything to canvas
      this.skybox.render(this.renderer, this.camera);
      this.markers.render(this.renderer, this.camera);
      this.gaussian.render();
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
    try {
      await this.gaussian.loadScene(path);
      if (!this.destroyed) {
        this.camera.position.set(0, 2.5, 5);
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
  }

  public getCamera(): THREE.Camera {
    return this.camera;
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
  }) {
    this.markerPicking.setEditorCallbacks(callbacks);
  }

  public setPlayAreaBounds(bounds: THREE.Box3 | null | undefined) {
    this.playAreaBounds = bounds ? bounds.clone() : null;
    this.controls.setBounds(this.playAreaBounds);
  }

  // -------------------------------------------------------------------------
  //HELPER METHODS-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  private resizeToContainer(force = false) {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const canvasDpr = window.devicePixelRatio || 1;

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

  private updateFPS(): number {
    const dt = Math.max(0.0001, Math.min(0.1, this.clock.getDelta()));
    const instFps = 1 / dt;
    this.fps =
      this.fps === 0
        ? instFps
        : THREE.MathUtils.lerp(this.fps, instFps, 0.1); // smooth a bit
      
    return dt;
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
    });
    
    // Reload scene if one was loaded
    if (currentPath) {
      this.overlay.show();
      try {
        await this.gaussian.loadScene(currentPath);
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

    // Dispose controls
    this.controls.dispose();

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
}
