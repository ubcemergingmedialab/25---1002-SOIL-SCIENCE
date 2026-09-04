import {
  DEFAULT_ORIENTATION_X,
  DEFAULT_ORIENTATION_Y,
  DEFAULT_ORIENTATION_Z,
} from "./createPlayCanvasApp";
import type { SplatOrientationDegrees } from "./applySplatOrientation";

function parseOrientationAxis(
  value: string | null,
  fallback: number,
): number {
  if (value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse splat orientation query params.
 *
 * - `orientationX` — degrees about +X (default 180). Legacy alias: `orientation`.
 * - `orientationY` — degrees about +Y (default 0).
 * - `orientationZ` — degrees about +Z (default 0).
 */
export function parseOrientation(
  searchParams: URLSearchParams,
): SplatOrientationDegrees {
  return {
    x: parseOrientationAxis(
      searchParams.get("orientationX") ?? searchParams.get("orientation"),
      DEFAULT_ORIENTATION_X,
    ),
    y: parseOrientationAxis(
      searchParams.get("orientationY"),
      DEFAULT_ORIENTATION_Y,
    ),
    z: parseOrientationAxis(
      searchParams.get("orientationZ"),
      DEFAULT_ORIENTATION_Z,
    ),
  };
}

/** Parse a single axis value — default 180° X to match legacy `/viewer/`. */
export function parseOrientationX(value: string | null): number {
  return parseOrientationAxis(value, DEFAULT_ORIENTATION_X);
}

export function parseOrientationY(value: string | null): number {
  return parseOrientationAxis(value, DEFAULT_ORIENTATION_Y);
}

export function parseOrientationZ(value: string | null): number {
  return parseOrientationAxis(value, DEFAULT_ORIENTATION_Z);
}
