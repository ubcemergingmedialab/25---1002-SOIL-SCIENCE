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
      onProgress?: (
        percentComplete: number,
        percentCompleteLabel: string,
        loaderStatus: number
      ) => void;
    }
  ): Promise<void>;
  update(): void;
  render(): void;
  dispose(): void;
  getSceneCount?(): number;
  isLoadingOrUnloading?(): boolean;
  removeSplatScenes?(indexes: number[], showLoadingUI?: boolean): Promise<void>;
  splatMesh?: {
    visibleRegionChanging?: boolean;
  };
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
  sphericalHarmonicsDegree?: SphericalHarmonicsDegree;
}

export type SphericalHarmonicsDegree = 0 | 1 | 2;

export type GaussianLoadPhase = "downloading" | "processing" | "finalizing";

export interface GaussianLoadProgress {
  progress: number | null;
  phase: GaussianLoadPhase;
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

    this.viewer = new ViewerClass({
      selfDrivenMode: false,
      renderer,
      camera,
      useBuiltInControls: false,
      gpuAcceleratedSort: false,
      sharedMemoryForWorkers: useSharedMemory,
      integerBasedSort: true,
      halfPrecisionCovariancesOnGPU: true,
      // Most splat files don't have SH data anyway. The renderer falls back to
      // the SH degree present in a loaded splat if this requests more data.
      sphericalHarmonicsDegree: options.sphericalHarmonicsDegree ?? 0,
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

  async loadScene(path: string, onProgress?: (state: GaussianLoadProgress) => void) {
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

      onProgress?.({ progress: 0, phase: "downloading" });

      await this.viewer.addSplatScene(path, {
        position: [0, 0, 0],
        scale: [1, 1, 1],
        // Flip so it doesn't render upside down.
        rotation: [1, 0, 0, 0],
        progressiveLoad: true, // Load progressively for faster initial render
        // Remove transparent splats - higher = more culling = faster
        splatAlphaRemovalThreshold: this.alphaThreshold,
        onProgress: (percentComplete, _percentLabel, loaderStatus) => {
          if (this.destroyed || token !== this.loadToken) return;

          const progress = Number.isFinite(percentComplete)
            ? Math.max(0, Math.min(1, percentComplete / 100))
            : null;

          onProgress?.({
            progress,
            phase: loaderStatus === 1 ? "processing" : "downloading",
          });
        },
      });
      if (this.destroyed || token !== this.loadToken) return;

      onProgress?.({ progress: 1, phase: "finalizing" });
      await this.waitForViewerReady(token);
      if (this.destroyed || token !== this.loadToken) return;

      onProgress?.({ progress: 1, phase: "finalizing" });
    } catch (e) {
      if (this.destroyed || token !== this.loadToken) {
        // Ignore errors from loads that were superseded or canceled by dispose.
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

  private waitForViewerReady(token: number, stableFrameTarget = 12) {
    return new Promise<void>((resolve) => {
      let stableFrames = 0;

      const step = () => {
        if (this.destroyed || token !== this.loadToken) {
          resolve();
          return;
        }

        const stillLoading = this.viewer.isLoadingOrUnloading?.() ?? false;
        const stillRevealing = Boolean(this.viewer.splatMesh?.visibleRegionChanging);
        const ready = !stillLoading && !stillRevealing;

        stableFrames = ready ? stableFrames + 1 : 0;

        if (stableFrames >= stableFrameTarget) {
          resolve();
          return;
        }

        requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    });
  }
}
