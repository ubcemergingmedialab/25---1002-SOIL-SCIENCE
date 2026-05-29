import { normalizeMarkerLabel } from "../types/markerLabel";
import type { MarkerVector, ViewerMarkerPayload } from "../types/fields";
import { toFiniteNumber } from "./numbers";

type RawObject = Record<string, unknown>;

export const isRecord = (value: unknown): value is RawObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function unwrapAttributeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(unwrapAttributeValue);
  if (!isRecord(value)) return value;

  if ("S" in value) return value.S;
  if ("N" in value) return toFiniteNumber(value.N);
  if ("BOOL" in value) return value.BOOL;
  if ("NULL" in value) return null;
  if ("L" in value && Array.isArray(value.L)) return value.L.map(unwrapAttributeValue);
  if ("M" in value && isRecord(value.M)) return unwrapAttributeValue(value.M);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, unwrapAttributeValue(entry)])
  );
}

export function normalizeVector(raw: unknown): MarkerVector | null {
  if (Array.isArray(raw) && raw.length >= 3) {
    const [x, y, z] = raw.slice(0, 3).map(toFiniteNumber);
    if (x !== undefined && y !== undefined && z !== undefined) return [x, y, z];
  }

  if (isRecord(raw)) {
    const x = toFiniteNumber(raw.x ?? raw.X);
    const y = toFiniteNumber(raw.y ?? raw.Y);
    const z = toFiniteNumber(raw.z ?? raw.Z);
    if (x !== undefined && y !== undefined && z !== undefined) return [x, y, z];
  }

  return null;
}

export function deriveViewPosition(position: MarkerVector): MarkerVector {
  return [position[0], position[1] + 2.5, position[2] + 5];
}

export function normalizeViewerMarker(raw: unknown): ViewerMarkerPayload | null {
  const value = unwrapAttributeValue(raw);

  if (Array.isArray(value) && value.length >= 3) {
    const [iconRaw, scaleRaw, positionRaw] = value;
    const positionVector = normalizeVector(positionRaw);
    if (!positionVector) return null;
    const isCurrentShape = value.length >= 5;
    const viewPositionVector = isCurrentShape ? normalizeVector(value[3]) : null;
    const labelRaw = isCurrentShape ? value[4] : value[3];
    return {
      icon: typeof iconRaw === "string" ? iconRaw : undefined,
      scale: toFiniteNumber(scaleRaw),
      position: { x: positionVector[0], y: positionVector[1], z: positionVector[2] },
      viewPosition: {
        x: (viewPositionVector ?? deriveViewPosition(positionVector))[0],
        y: (viewPositionVector ?? deriveViewPosition(positionVector))[1],
        z: (viewPositionVector ?? deriveViewPosition(positionVector))[2],
      },
      label: normalizeMarkerLabel(labelRaw),
    };
  }

  if (!isRecord(value)) return null;
  const positionVector = normalizeVector(value.position ?? value.Position);
  if (!positionVector) return null;
  const viewPositionVector = normalizeVector(
    value.viewPosition ?? value.ViewPosition ?? value.view_position
  );

  return {
    icon: typeof (value.icon ?? value.Icon) === "string" ? (value.icon ?? value.Icon) as string : undefined,
    scale: toFiniteNumber(value.scale ?? value.Scale),
    position: { x: positionVector[0], y: positionVector[1], z: positionVector[2] },
    viewPosition: {
      x: (viewPositionVector ?? deriveViewPosition(positionVector))[0],
      y: (viewPositionVector ?? deriveViewPosition(positionVector))[1],
      z: (viewPositionVector ?? deriveViewPosition(positionVector))[2],
    },
    label: normalizeMarkerLabel(value.label ?? value.Label ?? value.text ?? value.Text),
  };
}

export function parseMarkers(raw: unknown): ViewerMarkerPayload[] {
  const value = unwrapAttributeValue(raw);
  if (!Array.isArray(value)) return [];
  return value.map(normalizeViewerMarker).filter(Boolean) as ViewerMarkerPayload[];
}
