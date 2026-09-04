import * as pc from "playcanvas";
import { LEGACY_SPLAT_ORIENTATION_X } from "./applySplatOrientation";

const SPLAT_FLIP_AXIS = pc.Vec3.RIGHT;

export { LEGACY_SPLAT_ORIENTATION_X };

const scratchVec = new pc.Vec3();
const scratchLegacyQuat = new pc.Quat();
const scratchCurrentQuat = new pc.Quat();
const scratchInvLegacyQuat = new pc.Quat();
const scratchDeltaQuat = new pc.Quat();

/**
 * DynamoDB marker/start_pos coords assume the legacy viewer's effective 180° X
 * splat rotation. Re-map them when the runtime splat uses a different rotation
 * (e.g. `?orientationX=0` on unbaked LOD).
 */
export function mapLegacyStoredPosition(
  stored: [number, number, number],
  splatEntity: pc.Entity,
): [number, number, number] {
  scratchLegacyQuat.setFromAxisAngle(SPLAT_FLIP_AXIS, LEGACY_SPLAT_ORIENTATION_X);
  scratchCurrentQuat.copy(splatEntity.getRotation());
  scratchInvLegacyQuat.copy(scratchLegacyQuat).invert();
  scratchDeltaQuat.copy(scratchCurrentQuat).mul(scratchInvLegacyQuat);

  if (
    Math.abs(scratchDeltaQuat.x) < 1e-4 &&
    Math.abs(scratchDeltaQuat.y) < 1e-4 &&
    Math.abs(scratchDeltaQuat.z) < 1e-4 &&
    Math.abs(scratchDeltaQuat.w - 1) < 1e-4
  ) {
    return stored;
  }

  scratchVec.set(stored[0], stored[1], stored[2]);
  scratchDeltaQuat.transformVector(scratchVec, scratchVec);
  return [scratchVec.x, scratchVec.y, scratchVec.z];
}

export function mapDisplayToLegacyStored(
  display: [number, number, number],
  splatEntity: pc.Entity,
): [number, number, number] {
  scratchLegacyQuat.setFromAxisAngle(SPLAT_FLIP_AXIS, LEGACY_SPLAT_ORIENTATION_X);
  scratchCurrentQuat.copy(splatEntity.getRotation());
  scratchInvLegacyQuat.copy(scratchCurrentQuat).invert();
  scratchDeltaQuat.copy(scratchLegacyQuat).mul(scratchInvLegacyQuat);

  if (
    Math.abs(scratchDeltaQuat.x) < 1e-4 &&
    Math.abs(scratchDeltaQuat.y) < 1e-4 &&
    Math.abs(scratchDeltaQuat.z) < 1e-4 &&
    Math.abs(scratchDeltaQuat.w - 1) < 1e-4
  ) {
    return display;
  }

  scratchVec.set(display[0], display[1], display[2]);
  scratchDeltaQuat.transformVector(scratchVec, scratchVec);
  return [scratchVec.x, scratchVec.y, scratchVec.z];
}
