import type { MarkerLabel } from "./markerLabel";

export type MarkerVector = [number, number, number];

export type MarkerPayload = [
  string,
  number,
  MarkerVector,
  MarkerVector,
  MarkerLabel,
];

export type ViewerMarkerPayload = {
  icon?: string;
  scale?: number;
  position?: { x?: number; y?: number; z?: number };
  viewPosition?: { x?: number; y?: number; z?: number };
  label?: MarkerLabel;
};

export type FieldFileFormat = "ksplat" | "sog" | "streamed-lod";

export type Field = {
  FieldID: string;
  Name: string;
  Description?: string;
  LocationName?: string;
  Latitude?: number;
  Longitude?: number;
  Metadata?: unknown;
  Thumbnail?: string;
  ThumbnailAlt?: string;
  File?: string;
  /** PlayCanvas engine splat URL (SOG or streamed LOD manifest). */
  FilePlayCanvas?: string;
  /** Runtime format for FilePlayCanvas. */
  FileFormat?: FieldFileFormat | string;
  markers?: ViewerMarkerPayload[];
  Markers?: ViewerMarkerPayload[];
  start_pos?: unknown;
};

export type AdminField = Omit<Field, "markers" | "Markers"> & {
  markers?: unknown;
};

export type Pin = {
  title: string;
  path?: string;
  FilePlayCanvas?: string;
  FileFormat?: FieldFileFormat | string;
  start_pos?: unknown;
  markers?: unknown[];
};

export type ListFieldsResponse<TField = Field> = {
  items: TField[];
};

export type MutateFieldResponse<TField = Field> = {
  item: TField;
};
