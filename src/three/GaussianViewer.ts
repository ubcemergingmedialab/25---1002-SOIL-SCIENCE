//GaussianViewer.ts
import * as THREE from "three";
import * as GaussianSplats3D from "@mkkellogg/gaussian-splats-3d";

interface GSViewer {
  addSplatScene(
    path: string,
    opts: {
      position: [number, number, number];
      scale: [number, number, number];
      rotation: [number, number, number, number];
      progressiveLoad?: boolean;
      splatAlphaRemovalThreshold?: number;
    }
  ): Promise<void>;
  update(): void;
  render(): void;
  dispose(): void;
  getSceneCount?(): number;
  removeSplatScenes?(indexes: number[], showLoadingUI?: boolean): Promise<void>;
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
  halfPrecisionCovariancesOnGPU?: boolean;
  sphericalHarmonicsDegree?: number;
  logLevel?: number;
  dynamicScene?: boolean;
  freeIntermediateSplatData?: boolean;
}) => GSViewer;

const ViewerClass: GSViewerCtor = (
  GaussianSplats3D as unknown as {
    Viewer: GSViewerCtor;
  }
).Viewer;

const LogLevelNone: number =
  (GaussianSplats3D as unknown as { LogLevel?: { None: number } }).LogLevel
    ?.None ?? 0;

export interface GaussianViewerOptions {
  // Higher = more aggressive culling = faster but more visual holes
  splatAlphaRemovalThreshold?: number;
}

export class GaussianViewer {
  private viewer: GSViewer;
  private currentPath?: string;
  private loadToken = 0;
  private destroyed = false;
  private alphaThreshold: number;

  constructor(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    options: GaussianViewerOptions = {}
  ) {
    // Optimizations:
    // - integerBasedSort: ~2x faster CPU sorting
    // - sharedMemoryForWorkers: faster worker communication (if available)
    // - halfPrecisionCovariancesOnGPU: less VRAM, slightly less precision
    // - freeIntermediateSplatData: free memory after loading
    // - dynamicScene: false = optimizes for static scenes
    const useSharedMemory = typeof SharedArrayBuffer !== "undefined";
    this.alphaThreshold = options.splatAlphaRemovalThreshold ?? 1;

    console.log("[GaussianViewer] Alpha removal threshold:", this.alphaThreshold);
    console.log("[GaussianViewer] SharedArrayBuffer:", useSharedMemory);

    this.viewer = new ViewerClass({
      selfDrivenMode: false,
      renderer,
      camera,
      useBuiltInControls: false,
      gpuAcceleratedSort: false,
      sharedMemoryForWorkers: useSharedMemory,
      integerBasedSort: true,
      halfPrecisionCovariancesOnGPU: true,
      sphericalHarmonicsDegree: 0, // Most splat files don't have SH data anyway
      dynamicScene: false,
      freeIntermediateSplatData: true,
      logLevel: LogLevelNone,
    });
  }

  getAlphaThreshold(): number {
    return this.alphaThreshold;
  }

  getCurrentPath(): string | undefined {
    return this.currentPath;
  }

  update() {
    if (this.destroyed) return;
    this.viewer.update();
  }

  render() {
    if (this.destroyed) return;
    this.viewer.render();
  }

  async loadScene(path: string, onProgress?: (progress: number | null) => void) {
    if (!path) return;
    if (this.destroyed) return;
    if (this.currentPath === path) return;
    this.currentPath = path;
    const token = ++this.loadToken;

    try {
      if (this.destroyed || token !== this.loadToken) return;

      const count = this.viewer.getSceneCount?.() ?? 0;
      if (count > 0 && typeof this.viewer.removeSplatScenes === "function") {
        const indexes = Array.from({ length: count }, (_, i) => i);
        await this.viewer.removeSplatScenes(indexes, false);
      }
      if (this.destroyed || token !== this.loadToken) return;

      onProgress?.(null);

      await this.viewer.addSplatScene(path, {
        position: [0, 0, 0],
        scale: [1, 1, 1],
        // Flip so it doesn't render upside down.
        rotation: [1, 0, 0, 0],
        progressiveLoad: true, // Load progressively for faster initial render
        // Remove transparent splats - higher = more culling = faster
        splatAlphaRemovalThreshold: this.alphaThreshold,
      });
      await this.waitForFrames(30); // Reduced from 60
      onProgress?.(1);
    } catch (e) {
      if (this.destroyed || token !== this.loadToken) {
        // Ignore errors from loads that were superseded or canceled by dispose
        console.debug("Skipped load error from disposed GaussianViewer:", e);
        return;
      }
      console.error("Failed to load splat via setPath:", e);
    }
  }

  dispose() {
    this.destroyed = true;
    this.loadToken++;
    this.viewer.dispose();
  }

  private waitForFrames(count: number) {
    return new Promise<void>((resolve) => {
      let remaining = count;
      const step = () => {
        if (--remaining <= 0 || this.destroyed) {
          resolve();
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });
  }
}
