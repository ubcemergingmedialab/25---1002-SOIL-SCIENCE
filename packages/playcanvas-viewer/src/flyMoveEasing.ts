// @ts-nocheck
import { KeyboardMouseSource } from "playcanvas";
import type * as pc from "playcanvas";
import type { CameraControls } from "playcanvas/scripts/esm/camera-controls.mjs";
import type { ControlMode } from "@soil/shared/three/ScreenSpace";
import { isMobileLikeControls } from "./mobileCamera";

/** Seconds to ramp from slow start to full fly move speed while a movement key is held. */
export const FLY_MOVE_RAMP_DURATION_S = 1;

type Controls = InstanceType<typeof CameraControls>;

export type FlyMoveBaseSpeeds = {
  moveSpeed: number;
  moveFastSpeed: number;
  moveSlowSpeed: number;
};

export type FlyMoveEasingHandle = {
  setControlMode(mode: ControlMode): void;
  reset(): void;
  destroy(): void;
};

/** Quadratic ease-in: slow at first, reaches 1 after `rampDuration` seconds. */
export function flyMoveSpeedFactor(
  holdSeconds: number,
  rampDuration = FLY_MOVE_RAMP_DURATION_S,
): number {
  if (holdSeconds <= 0 || rampDuration <= 0) return 0;
  const t = Math.min(1, holdSeconds / rampDuration);
  return t * t;
}

const MOVE_KEY_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

function isMovementKeyHeld(controls: Controls, heldKeys: Set<string>): boolean {
  if (heldKeys.size > 0) return true;

  const desktop = controls._desktopInput;
  if (!desktop?._keyNow) return false;

  const { keyCode } = KeyboardMouseSource;
  const keyNow = desktop._keyNow;

  return Boolean(
    keyNow[keyCode.W] ||
      keyNow[keyCode.A] ||
      keyNow[keyCode.S] ||
      keyNow[keyCode.D] ||
      keyNow[keyCode.Q] ||
      keyNow[keyCode.E] ||
      keyNow[keyCode.UP] ||
      keyNow[keyCode.DOWN] ||
      keyNow[keyCode.LEFT] ||
      keyNow[keyCode.RIGHT],
  );
}

/**
 * Desktop fly-mode keyboard move easing: ramps move speed from slow to full over 1s
 * while movement keys stay held. Gamepad / non-keyboard input keeps full speed.
 */
export function setupFlyMoveEasing(
  app: pc.AppBase,
  controls: Controls,
  baseSpeeds: FlyMoveBaseSpeeds,
): FlyMoveEasingHandle {
  let active = false;
  let holdSeconds = 0;
  let currentMode: ControlMode = "orbit";
  const heldKeys = new Set<string>();

  const restoreSpeeds = () => {
    controls.moveSpeed = baseSpeeds.moveSpeed;
    controls.moveFastSpeed = baseSpeeds.moveFastSpeed;
    controls.moveSlowSpeed = baseSpeeds.moveSlowSpeed;
  };

  const applySpeedFactor = (factor: number) => {
    controls.moveSpeed = baseSpeeds.moveSpeed * factor;
    controls.moveFastSpeed = baseSpeeds.moveFastSpeed * factor;
    controls.moveSlowSpeed = baseSpeeds.moveSlowSpeed * factor;
  };

  const syncActive = (mode: ControlMode) => {
    active = mode === "fly" && !isMobileLikeControls();
    if (!active) {
      holdSeconds = 0;
      heldKeys.clear();
      restoreSpeeds();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!active || !controls.enabled) return;
    if (MOVE_KEY_CODES.has(event.code)) {
      heldKeys.add(event.code);
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (!MOVE_KEY_CODES.has(event.code)) return;
    heldKeys.delete(event.code);
    if (heldKeys.size === 0) {
      holdSeconds = 0;
    }
  };

  const onBlur = () => {
    heldKeys.clear();
    holdSeconds = 0;
  };

  const onUpdate = (dt: number) => {
    if (!active) return;

    if (!controls.enabled) {
      holdSeconds = 0;
      restoreSpeeds();
      return;
    }

    const keyboardMove = isMovementKeyHeld(controls, heldKeys);
    if (keyboardMove) {
      holdSeconds = Math.min(FLY_MOVE_RAMP_DURATION_S, holdSeconds + dt);
      applySpeedFactor(flyMoveSpeedFactor(holdSeconds));
      return;
    }

    holdSeconds = 0;
    heldKeys.clear();
    restoreSpeeds();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  app.on("update", onUpdate);

  return {
    setControlMode(mode) {
      currentMode = mode;
      syncActive(mode);
    },
    reset() {
      holdSeconds = 0;
      heldKeys.clear();
      syncActive(currentMode);
    },
    destroy() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      app.off("update", onUpdate);
      holdSeconds = 0;
      heldKeys.clear();
      restoreSpeeds();
    },
  };
}
