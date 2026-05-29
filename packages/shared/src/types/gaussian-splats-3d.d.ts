// src/types/gaussian-splats-3d.d.ts
declare module '@mkkellogg/gaussian-splats-3d' {
  import * as THREE from 'three';

  export type Vec3 = [number, number, number];
  export type Quat = [number, number, number, number];

  export enum RenderMode { Always = 0, OnChange = 1, Never = 2 }
  export enum SceneRevealMode { Default = 0, Gradual = 1, Instant = 2 }
  export enum WebXRMode { None = 0, VR = 1, AR = 2 }
  export enum LogLevel { None = 0, Error = 1, Warn = 2, Info = 3, Debug = 4 }

  export interface SplatSceneOptions {
    position?: Vec3;
    scale?: Vec3;
    rotation?: Quat; // [x, y, z, w] quaternion
    progressiveLoad?: boolean;
    splatAlphaRemovalThreshold?: number;
    headers?: Record<string, string>;
  }

  export interface ViewerOptions {
    // control / integration
    selfDrivenMode?: boolean;
    renderer?: THREE.WebGLRenderer;
    camera?: THREE.Camera;
    useBuiltInControls?: boolean;
    threeScene?: THREE.Scene;

    // perf / quality
    gpuAcceleratedSort?: boolean;
    enableSIMDInSort?: boolean;
    sharedMemoryForWorkers?: boolean;
    integerBasedSort?: boolean;
    splatSortDistanceMapPrecision?: 8 | 16 | 32;
    halfPrecisionCovariancesOnGPU?: boolean;
    ignoreDevicePixelRatio?: boolean;
    dynamicScene?: boolean;

    // XR / render scheduling
    webXRMode?: WebXRMode;
    webXRSessionInit?: XRSessionInit;
    renderMode?: RenderMode;
    sceneRevealMode?: SceneRevealMode;

    // visual tweaks
    antialiased?: boolean;
    kernel2DSize?: number;
    focalAdjustment?: number;
    sphericalHarmonicsDegree?: 0 | 1 | 2;

    // misc
    logLevel?: LogLevel;
    inMemoryCompressionLevel?: 0 | 1 | 2;
    freeIntermediateSplatData?: boolean;
  }

  export class Viewer {
    constructor(opts?: ViewerOptions);
    addSplatScene(path: string, opts?: SplatSceneOptions): Promise<void>;
    addSplatScenes(configs: Array<SplatSceneOptions & { path: string }>): Promise<void>;
    update(): void;
    render(): void;
    start(): void;
    stop(): void;
    dispose(): void;
    setActiveSphericalHarmonicsDegrees(degree: 0 | 1 | 2): void;
  }

  export class DropInViewer extends THREE.Object3D {
    constructor(opts?: ViewerOptions);
    addSplatScenes(configs: Array<SplatSceneOptions & { path: string }>): Promise<void>;
    dispose(): void;
  }

  // Optional helpers exposed by the lib (handy for in-browser conversion)
  export namespace PlyLoader {
    function loadFromURL(
      url: string,
      onProgress?: (progress: number) => void,
      progressiveLoad?: boolean,
      onProgressiveLoadSectionProgress?: (progress: number) => void,
      minimumAlpha?: number,
      compressionLevel?: 0 | 1 | 2,
      optimizeSplatData?: boolean,
      sphericalHarmonicsDegree?: 0 | 1 | 2,
      headers?: Record<string, string>
    ): Promise<ArrayBuffer>;
  }

  export namespace KSplatLoader {
    function downloadFile(buffer: ArrayBuffer, filename: string): void;
  }
}
