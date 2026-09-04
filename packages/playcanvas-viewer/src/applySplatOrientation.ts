import * as pc from "playcanvas";

/** Legacy mkkellogg viewer: 180° about +X (`rotation: [1, 0, 0, 0]` xyzw). */
export const LEGACY_SPLAT_ORIENTATION_X = 180;

export type SplatOrientationDegrees = {
  x: number;
  y: number;
  z: number;
};

const scratchQx = new pc.Quat();
const scratchQy = new pc.Quat();
const scratchQz = new pc.Quat();
const scratchRyx = new pc.Quat();
const scratchResult = new pc.Quat();

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function isNearZeroDegrees(normalized: number): boolean {
  return normalized < 1e-6 || Math.abs(normalized - 360) < 1e-6;
}

/**
 * Apply splat rotation (degrees) about world X, Y, and Z.
 *
 * Uses axis-angle quaternions composed as `q = Rz * Ry * Rx` — NOT euler angles,
 * because setLocalEulerAngles(180, 0, 0) is a gimbal singularity (no-op in PlayCanvas).
 *
 * Lone X=180 matches legacy mkkellogg `rotation: [1, 0, 0, 0]` (xyzw).
 */
export function applySplatOrientation(
  splatEntity: pc.Entity,
  orientation: SplatOrientationDegrees,
): void {
  const nx = normalizeDegrees(orientation.x);
  const ny = normalizeDegrees(orientation.y);
  const nz = normalizeDegrees(orientation.z);

  if (isNearZeroDegrees(nx) && isNearZeroDegrees(ny) && isNearZeroDegrees(nz)) {
    splatEntity.setLocalRotation(pc.Quat.IDENTITY);
    return;
  }

  scratchQx.setFromAxisAngle(pc.Vec3.RIGHT, orientation.x);
  scratchQy.setFromAxisAngle(pc.Vec3.UP, orientation.y);
  scratchQz.setFromAxisAngle(pc.Vec3.BACK, orientation.z);
  // q = Rz * Ry * Rx — rightmost (X) applied first; lone X matches prior behavior.
  scratchRyx.mul2(scratchQy, scratchQx);
  scratchResult.mul2(scratchQz, scratchRyx);
  splatEntity.setLocalRotation(scratchResult);
}

/** @deprecated Prefer {@link applySplatOrientation}. */
export function applySplatOrientationX(
  splatEntity: pc.Entity,
  orientationXDegrees: number,
): void {
  applySplatOrientation(splatEntity, { x: orientationXDegrees, y: 0, z: 0 });
}

/** Legacy mkkellogg viewer quaternion for 180° X (x, y, z, w). */
export function legacyMkKelloggSplatQuat(out = new pc.Quat()): pc.Quat {
  return out.set(1, 0, 0, 0);
}

export function applyLegacyMkKelloggSplatFlip(splatEntity: pc.Entity): void {
  splatEntity.setLocalRotation(legacyMkKelloggSplatQuat());
}
