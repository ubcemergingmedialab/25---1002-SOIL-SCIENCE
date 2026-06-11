import * as pc from "playcanvas";
import { CameraControls } from "playcanvas/scripts/esm/camera-controls.mjs";

export type PlayCanvasHarnessOptions = {
  canvas: HTMLCanvasElement;
  splatUrl: string;
  /** Euler X rotation (degrees) — tune if scene appears upside-down vs legacy viewer. */
  orientationX?: number;
  /** Global splat budget in millions (mobile ~1, desktop ~3–4). */
  splatBudgetM?: number;
};

export type PlayCanvasHarness = {
  destroy: () => void;
};

/**
 * Minimal PlayCanvas engine harness for streamed LOD (`lod-meta.json`) smoke tests.
 */
export async function createPlayCanvasHarness(
  options: PlayCanvasHarnessOptions,
): Promise<PlayCanvasHarness> {
  const { canvas, splatUrl, orientationX = 0, splatBudgetM } = options;
  const budgetM =
    splatBudgetM ?? (pc.platform.mobile ? 1 : 3);

  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
    antialias: false,
  });

  const appOptions = new pc.AppOptions();
  appOptions.graphicsDevice = device;
  appOptions.mouse = new pc.Mouse(canvas);
  appOptions.touch = new pc.TouchDevice(canvas);
  appOptions.keyboard = new pc.Keyboard(window);

  appOptions.componentSystems = [
    pc.RenderComponentSystem,
    pc.CameraComponentSystem,
    pc.ScriptComponentSystem,
    pc.GSplatComponentSystem,
  ];
  appOptions.resourceHandlers = [
    pc.TextureHandler,
    pc.ScriptHandler,
    pc.GSplatHandler,
  ];

  const app = new pc.AppBase(canvas);
  app.init(appOptions);

  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);

  const onResize = () => app.resizeCanvas();
  window.addEventListener("resize", onResize);

  app.scene.gsplat.lodUpdateAngle = 90;
  app.scene.gsplat.lodBehindPenalty = 3;
  app.scene.gsplat.radialSorting = true;
  app.scene.gsplat.splatBudget = Math.round(budgetM * 1_000_000);

  const asset = new pc.Asset("gsplat", "gsplat", { url: splatUrl });
  app.assets.add(asset);

  await new Promise<void>((resolve, reject) => {
    asset.on("load", () => resolve());
    asset.on("error", (err: string) => reject(new Error(err)));
    app.assets.load(asset);
  });

  app.start();

  const camera = new pc.Entity("camera");
  camera.addComponent("camera", {
    clearColor: new pc.Color(0.05, 0.05, 0.06),
    fov: 75,
    toneMapping: pc.TONEMAP_LINEAR,
  });
  camera.setLocalPosition(0, 2, 6);
  app.root.addChild(camera);

  camera.addComponent("script");
  const controls = camera.script?.create(CameraControls) as InstanceType<
    typeof CameraControls
  >;
  if (controls) {
    Object.assign(controls, {
      sceneSize: 200,
      moveSpeed: 4,
      moveFastSpeed: 12,
      enableOrbit: true,
      enablePan: true,
      focusPoint: new pc.Vec3(0, 0.5, 0),
    });
  }

  const splatEntity = new pc.Entity("splat");
  splatEntity.addComponent("gsplat", { asset });
  splatEntity.setLocalEulerAngles(orientationX, 0, 0);
  app.root.addChild(splatEntity);

  const gsplat = splatEntity.gsplat;
  const resource = gsplat?.resource as { octree?: { lodLevels?: number } } | undefined;
  const lodLevels = resource?.octree?.lodLevels;
  if (lodLevels) {
    const worstLod = lodLevels - 1;
    app.scene.gsplat.lodRangeMin = worstLod;
    app.scene.gsplat.lodRangeMax = worstLod;

    const gsplatSystem = app.systems.gsplat as pc.GSplatComponentSystem & {
      on: (name: string, fn: (...args: unknown[]) => void) => void;
      off: (name: string, fn: (...args: unknown[]) => void) => void;
    };

    const onFrameReady = (
      _cam: unknown,
      _layer: unknown,
      ready: boolean,
      loadingCount: number,
    ) => {
      if (ready && loadingCount === 0) {
        gsplatSystem.off("frame:ready", onFrameReady);
        app.scene.gsplat.lodRangeMin = 0;
        app.scene.gsplat.lodRangeMax = worstLod;
      }
    };
    gsplatSystem.on("frame:ready", onFrameReady);
  }

  return {
    destroy() {
      window.removeEventListener("resize", onResize);
      app.destroy();
    },
  };
}
