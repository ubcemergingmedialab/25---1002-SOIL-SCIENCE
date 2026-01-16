// ThreeApp.ts
import * as THREE from "three";
import { FlyControls } from "./FlyControls";
import { ScreenSpaceUI } from "./ScreenSpace";
import { GaussianViewer } from "./GaussianViewer";
import { WorldMarkers } from "./WorldMarkers";
import { Skybox } from "./Skybox";
import { LoadingOverlay } from "./LoadingOverlay";

const DEFAULT_SKYBOX_URL = "/citrus_orchard_puresky_4k.hdr"; // local HDR equirectangular sky
const DEFAULT_SPLAT_PATH = "/assets/gaussian_splat_data/UBC_Farm_Agricultural.splat";

export class ThreeApp {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;

  private clock = new THREE.Clock();
  private fps = 0;

  private resizeObs?: ResizeObserver;
  private prevDpr = window.devicePixelRatio || 1;

  private destroyed = false;

  // Fly controls
  private controls: FlyControls;

  //screen space ui
  private screenUI: ScreenSpaceUI;

  // Gaussian splats viewer
  private gaussian: GaussianViewer;

  // Picking
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  // Skybox
  private skybox: Skybox;

  // Loading overlay
  private overlay: LoadingOverlay;

  // World markers
  private markers: WorldMarkers;

  // axes
  private worldAxesScene = new THREE.Scene();
  private worldAxes?: THREE.AxesHelper;

  // ------------------
  // CONSTRUCTOR
  // ------------------
  constructor(container: HTMLElement) {
    this.container = container;

    // renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
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
    this.screenUI = new ScreenSpaceUI(this.container);
    this.overlay = new LoadingOverlay(this.container);

    const gl = this.renderer.getContext();
    const scope = globalThis as unknown as WindowOrWorkerGlobalScope;
    const coi = scope.crossOriginIsolated ?? false;
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
    const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
    console.info(
      "WebGL2:",
      gl instanceof WebGL2RenderingContext,
      "| COI:",
      coi,
      "| SAB:",
      hasSharedArrayBuffer,
      "| WebGPU:",
      hasWebGPU
    );
    console.info(
      "Gaussian splats running with CPU sort (GPU sort not supported by current library build)."
    );

    // camera
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    this.camera.position.set(0, 2.5, 5);

    // Fly controls
    this.controls = new FlyControls(this.camera, this.renderer.domElement);
    this.screenUI.setSpeedChangeHandler((v) => this.controls.setFlySpeed(v));
    this.screenUI.setSpeed(this.controls.getFlySpeed());

    // Gaussian splats viewer
    this.gaussian = new GaussianViewer(this.renderer, this.camera);

    // Skybox
    this.skybox = new Skybox();
    void this.skybox
      .setEquirectangular(DEFAULT_SKYBOX_URL)
      .then(() => {
        if (this.markers) {
          this.markers.setEnvironmentMap(this.skybox.getEnvironmentMap());
        }
      });

    // World markers
    this.markers = new WorldMarkers();
    this.renderer.domElement.addEventListener("click", this.handleClick);

    // World axes setup
    this.worldAxes = new THREE.AxesHelper(1);
    this.worldAxesScene.add(this.worldAxes);

    // sizing
    this.resizeToContainer();
    this.observeResize();

    // animate
    this.renderer.setAnimationLoop(this.tick);
  }


  // ------------------
  // MAIN LOOP
  // ------------------
  private tick = () => {
    //update delta time and fps
    const dt = this.updateFPS()

    // DPR changes (if any)
    this.updateDPR()

    // clear frame (color + depth)
    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, true);

    // Fly update
    this.controls.update(dt);

    // render Skybox
    this.skybox.render(this.renderer, this.camera);

    // Scale world axes based on distance
    if (this.worldAxes) {
      const dist = this.camera.position.length();
      const s = THREE.MathUtils.clamp(dist * 0.05, 0.5, 10);
      this.worldAxes.scale.setScalar(s);
    }

    // World markers first so splats can occlude them 
    this.markers.render(this.renderer, this.camera);

    // Gaussians 
    this.gaussian.update();
    this.gaussian.render();

     // screen space UI
    this.screenUI.setPlayerWorldPosition(this.camera.position);
    this.screenUI.setFps(this.fps);
    this.screenUI.update();

    // world axes
    this.renderer.clearDepth();
    this.renderer.render(this.worldAxesScene, this.camera);
  };


  // -------------------------------------------------------------------------
  //PUBLIC METHODS-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  public async setGaussianPath(path: string) {
    if (this.destroyed) return;
    this.overlay.show();
    try {
      //await this.gaussian.setPath(DEFAULT_SPLAT_PATH); //temp
      await this.gaussian.setPath(path);
      if (!this.destroyed) {
        this.camera.position.set(0, 2.5, 5);
      }
    } finally {
      if (!this.destroyed) this.overlay.hide();
    }
  }

  public async setSkybox(path: string | null | undefined) {
    if (this.destroyed) return;
    await this.skybox.setEquirectangular(path);
    this.markers.setEnvironmentMap(this.skybox.getEnvironmentMap());
  }

  public setWorldMarkers(markers: Parameters<WorldMarkers["setMarkers"]>[0]) {
    this.markers.setMarkers(markers);
  }

  // -------------------------------------------------------------------------
  //PRIVATE METHODS-------------------------------------------------------------------------
  //-------------------------------------------------------------------------

  private resizeToContainer = () => {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private observeResize() {
    this.resizeObs = new ResizeObserver(() => this.resizeToContainer());
    this.resizeObs?.observe(this.container);
  }

  private updateDPR() {
    const dpr = window.devicePixelRatio || 1;
    if (Math.abs(dpr - this.prevDpr) > 0.001) {
      this.prevDpr = dpr;
      const { clientWidth: w, clientHeight: h } = this.container;
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.setSize(Math.max(1, w), Math.max(1, h), false);
      this.camera.aspect = (w || 1) / (h || 1);
      this.camera.updateProjectionMatrix();
    }
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

  private handleClick = (event: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.pointer.set(x, y);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hits = this.raycaster.intersectObjects([...this.markers.getPickableObjects()], false);
    if (hits.length === 0) return;

    const hitObj = hits[0].object as THREE.Sprite;

    // If clicking the label itself, close it 
    if (this.markers.getSprites().includes(hitObj) === false) {
      this.markers.removeLabel();
      return;
    }

    // Otherwise, toggle the marker's label
    this.markers.toggleLabelForSprite(hitObj, this.camera);
  };

  dispose() {
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObs?.disconnect();
    this.renderer.domElement.removeEventListener("click", this.handleClick);

    // Dispose controls (removes input listeners)
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
