//GaussianViewer.ts
import * as THREE from "three";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";

// Minimal viewer interface so we don't rely on `any`
interface GSViewer {
  addSplatScene(
    path: string,
    opts: {
      position: [number, number, number];
      scale: [number, number, number];
      rotation: [number, number, number, number];
      progressiveLoad?: boolean;
    }
  ): Promise<void>;
  update(): void;
  render(): void;
  dispose(): void;
  clear?(): void;
}

// Constructor type for the lib's Viewer
type GSViewerCtor = new (opts: {
  selfDrivenMode?: boolean;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  useBuiltInControls?: boolean;
  gpuAcceleratedSort?: boolean;
  sharedMemoryForWorkers?: boolean;
  integerBasedSort?: boolean;
  sphericalHarmonicsDegree?: number;
  logLevel?: number;
}) => GSViewer;

// Safely pick the class/enum off the imported module (no `any`)
const ViewerClass: GSViewerCtor = (
  GaussianSplats3D as unknown as {
    Viewer: GSViewerCtor;
  }
).Viewer;

const LogLevelDebug: number =
  (GaussianSplats3D as unknown as { LogLevel?: { Debug: number } }).LogLevel
    ?.Debug ?? 2;

export class GaussianViewer {
  private viewer: GSViewer;
  private currentPath?: string;
  private loadToken = 0;
  private destroyed = false;

  constructor(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    this.viewer = new ViewerClass({
      selfDrivenMode: false,
      renderer,
      camera,
      useBuiltInControls: false,
      gpuAcceleratedSort: false,
      sharedMemoryForWorkers: false,
      integerBasedSort: false,
      sphericalHarmonicsDegree: 1,
      logLevel: LogLevelDebug,
    });
  }

  update() {
    if (this.destroyed) return;
    this.viewer.update();
  }

  render() {
    if (this.destroyed) return;
    this.viewer.render();
  }

  async setPath(path: string) {
    if (!path) return;
    if (this.destroyed) return;
    if (this.currentPath === path) return;
    this.currentPath = path;
    const token = ++this.loadToken;

    const uprightQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.PI / 4, 0, Math.PI, "XYZ")
    );

    try {
      if (this.destroyed || token !== this.loadToken) return;
      this.viewer.clear?.();
      await this.viewer.addSplatScene(path, {
        position: [0, 0, 0],
        scale: [1, 1, 1],
        rotation: [uprightQ.x, uprightQ.y, uprightQ.z, uprightQ.w],
        progressiveLoad: false,
      });
    } catch (e) {
      if (this.destroyed || token !== this.loadToken) {
        // Ignore errors from loads that were superseded or canceled by dispose
        console.debug("Skipped load error from disposed GaussianViewer:", e);
        return;
      }
      console.error("Failed to load ksplat via setPath:", e);
    }
  }

  dispose() {
    this.destroyed = true;
    this.loadToken++;
    this.viewer.dispose();
  }
}
