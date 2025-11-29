// ThreeApp.ts
import * as THREE from "three";
import { FlyControls } from "./FlyControls";
import { ScreenSpaceUI } from "./ScreenSpace";
import { GaussianViewer } from "./GaussianViewer";
import { WorldMarkers } from "./WorldMarkers";

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

    // Gaussian splats viewer
    this.gaussian = new GaussianViewer(this.renderer, this.camera);

    // World markers
    this.markers = new WorldMarkers();
    this.markers.setMarkers([
      {
        position: new THREE.Vector3(0, 5, 0),
        color: "#ff4444",
        radius: 0.2,
      },
    ]);

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
    const dt = Math.max(0.0001, Math.min(0.1, this.clock.getDelta()));
    const instFps = 1 / dt;
    this.fps =
      this.fps === 0
        ? instFps
        : THREE.MathUtils.lerp(this.fps, instFps, 0.1); // smooth a bit

    // DPR changes
    const dpr = window.devicePixelRatio || 1;
    if (Math.abs(dpr - this.prevDpr) > 0.001) {
      this.prevDpr = dpr;
      const { clientWidth: w, clientHeight: h } = this.container;
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.setSize(Math.max(1, w), Math.max(1, h), false);
      this.camera.aspect = (w || 1) / (h || 1);
      this.camera.updateProjectionMatrix();
    }

    // clear frame (color + depth)
    this.renderer.setRenderTarget(null);
    this.renderer.clear(true, true, true);

    // Fly update
    this.controls.update(dt);

    // Scale world axes based on distance
    if (this.worldAxes) {
      const dist = this.camera.position.length();
      const s = THREE.MathUtils.clamp(dist * 0.05, 0.5, 10);
      this.worldAxes.scale.setScalar(s);
    }

    // Gaussian splats viewer
    this.gaussian.update();

    // World markers first so splats can occlude them 
    this.markers.render(this.renderer, this.camera);

    // Gaussians 
    this.gaussian.render();

     // screen space UI
    this.screenUI.setPlayerWorldPosition(this.camera.position);
    this.screenUI.setFps(this.fps);
    this.screenUI.update();

    // world axes
    this.renderer.clearDepth();
    this.renderer.render(this.worldAxesScene, this.camera);
  };

  public async setGaussianPath(path: string) {
    if (this.destroyed) return;
    await this.gaussian.setPath(path);
    if (!this.destroyed) {
      this.camera.position.set(0, 2.5, 5);
    }
  }

  public setWorldMarkers(markers: Parameters<WorldMarkers["setMarkers"]>[0]) {
    this.markers.setMarkers(markers);
  }

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

  dispose() {
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObs?.disconnect();

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

    this.gaussian.dispose();
    this.markers.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
