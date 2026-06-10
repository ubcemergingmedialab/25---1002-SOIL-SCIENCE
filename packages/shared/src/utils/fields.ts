import type { Field } from "../types/fields";
import { parseMarkers, unwrapAttributeValue, isRecord } from "./markers";
import { toFiniteNumber } from "./numbers";

const toStringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export function normalizeFieldItem(raw: unknown): Field | null {
  const unwrapped = unwrapAttributeValue(raw);
  const value = isRecord(unwrapped) && "item" in unwrapped ? unwrapAttributeValue(unwrapped.item) : unwrapped;
  if (!isRecord(value)) return null;

  const fieldId = toStringValue(value.FieldID);
  if (!fieldId) return null;

  const markers = parseMarkers(value.markers ?? value.Markers);

  return {
    FieldID: fieldId,
    Name: toStringValue(value.Name) ?? fieldId,
    Description: toStringValue(value.Description),
    LocationName: toStringValue(value.LocationName),
    Latitude: toFiniteNumber(value.Latitude),
    Longitude: toFiniteNumber(value.Longitude),
    Metadata: value.Metadata,
    Thumbnail: toStringValue(value.Thumbnail),
    ThumbnailAlt: toStringValue(value.ThumbnailAlt),
    File: toStringValue(value.File),
    FilePlayCanvas: toStringValue(value.FilePlayCanvas),
    FileFormat: toStringValue(value.FileFormat),
    markers,
    Markers: markers,
    start_pos: value.start_pos ?? value.StartPos ?? value.startPos,
  };
}
