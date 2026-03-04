import type { FieldForm } from "./Admin";

type ParseResult = {
  value?: FieldForm;
  errors: string[];
  warnings: string[];
};

const KNOWN_KEYS = new Set([
  "FieldID",
  "Name",
  "Description",
  "File",
  "Latitude",
  "Longitude",
  "Thumbnail",
  "ThumbnailAlt",
  "markers",
]);

export function parseAndNormalizeEntryFromJson(text: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { errors: [`Invalid JSON: ${message}`], warnings };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { errors: ["JSON must describe a single field object."], warnings };
  }

  const record = parsed as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(`Unknown key "${key}" ignored.`);
    }
  }

  const FieldID = readRequiredString(record.FieldID, "FieldID", errors);
  const Name = readRequiredString(record.Name, "Name", errors);
  const Description = readOptionalString(record.Description);
  const File = readOptionalString(record.File);
  const Thumbnail = readOptionalString(record.Thumbnail);
  const ThumbnailAlt = readOptionalString(record.ThumbnailAlt);
  const Latitude = normalizeCoordinate(record.Latitude, "Latitude", errors);
  const Longitude = normalizeCoordinate(record.Longitude, "Longitude", errors);
  const markers = normalizeMarkers(record.markers, errors);

  if (errors.length) {
    return { errors, warnings };
  }

  return {
    value: {
      FieldID,
      Name,
      Description,
      File,
      Thumbnail,
      ThumbnailAlt,
      Latitude,
      Longitude,
      markers,
    },
    errors,
    warnings,
  };
}

function readRequiredString(value: unknown, label: string, errors: string[]): string {
  if (value === undefined || value === null) {
    errors.push(`${label} is required.`);
    return "";
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      errors.push(`${label} is required.`);
    }
    return normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    const normalized = String(value).trim();
    if (!normalized) {
      errors.push(`${label} is required.`);
    }
    return normalized;
  }
  errors.push(`${label} must be a string.`);
  return "";
}

function readOptionalString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

function normalizeCoordinate(value: unknown, label: string, errors: string[]): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      errors.push(`${label} must be a finite number.`);
      return "";
    }
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const numeric = Number(trimmed);
    if (Number.isNaN(numeric)) {
      errors.push(`${label} must be a number.`);
      return "";
    }
    return String(numeric);
  }
  errors.push(`${label} must be a number or numeric string.`);
  return "";
}

function normalizeMarkers(raw: unknown, errors: string[]): FieldForm["markers"] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push("markers must be an array.");
    return [];
  }

  const markers: FieldForm["markers"] = [];

  raw.forEach((entry, index) => {
    const normalized = normalizeMarker(entry, index, errors);
    if (normalized) markers.push(normalized);
  });

  return markers;
}

function normalizeMarker(entry: unknown, index: number, errors: string[]) {
  if (!Array.isArray(entry)) {
    errors.push(`Marker #${index + 1} must be an array: [icon, scale, [x,y,z], text].`);
    return null;
  }
  if (entry.length < 4) {
    errors.push(`Marker #${index + 1} must include icon, scale, position, and text values.`);
    return null;
  }

  const [iconRaw, scaleRaw, positionRaw, textRaw] = entry;

  if (!Array.isArray(positionRaw) || positionRaw.length < 3) {
    errors.push(`Marker #${index + 1} position must have X, Y, and Z values.`);
    return null;
  }

  const [posXRaw, posYRaw, posZRaw] = positionRaw;

  return {
    icon: readOptionalString(iconRaw),
    scale: readOptionalNumericString(scaleRaw),
    posX: readOptionalNumericString(posXRaw),
    posY: readOptionalNumericString(posYRaw),
    posZ: readOptionalNumericString(posZRaw),
    text: readOptionalString(textRaw),
  };
}

function readOptionalNumericString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}
