import type { Field, ListFieldsResponse, Pin } from "@soil/shared/types/fields";
import { normalizeFieldItem } from "@soil/shared/utils/fields";
import { unwrapAttributeValue, isRecord } from "@soil/shared/utils/markers";

const BASE = import.meta.env.VITE_PUBLIC_API_URL as string | undefined;

function requireBaseUrl(): string {
  if (!BASE) {
    throw new Error("VITE_PUBLIC_API_URL is not configured.");
  }
  return BASE;
}

function listFromResponse(raw: unknown): unknown[] {
  const value = unwrapAttributeValue(raw);
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.items)) return value.items;
  return [];
}

async function publicFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${requireBaseUrl()}${path}`, { method: "GET" });

  if (res.status === 404) {
    return null as T;
  }

  if (!res.ok) {
    const raw = await res.text();
    throw new Error(`${res.status} ${res.statusText}${raw ? `: ${raw}` : ""}`);
  }

  return res.json() as Promise<T>;
}

export async function getFields(): Promise<Field[]> {
  const raw = await publicFetch<ListFieldsResponse | Field[] | unknown>("/fields");
  return listFromResponse(raw).map(normalizeFieldItem).filter(Boolean) as Field[];
}

export async function getFieldById(fieldId: string): Promise<Field | null> {
  const requested = fieldId.trim();
  if (!requested) return null;

  const listedField = (await getFields()).find((field) => field.FieldID === requested);
  if (!listedField) return null;

  const raw = await publicFetch<unknown | null>(`/fields/${encodeURIComponent(listedField.FieldID)}`);
  return raw ? normalizeFieldItem(raw) ?? listedField : listedField;
}

export async function getPins(): Promise<Pin[]> {
  const raw = await publicFetch<unknown>("/pins");
  const value = unwrapAttributeValue(raw);
  if (!Array.isArray(value)) return [];

  return value.map((pin) => {
    if (!isRecord(pin)) {
      return { title: "", path: "", markers: [] };
    }
    return {
      title: typeof pin.title === "string" ? pin.title : "",
      path: typeof pin.path === "string" ? pin.path : "",
      FilePlayCanvas:
        typeof pin.FilePlayCanvas === "string" ? pin.FilePlayCanvas : undefined,
      FileFormat: typeof pin.FileFormat === "string" ? pin.FileFormat : undefined,
      start_pos: pin.start_pos,
      markers: Array.isArray(pin.markers) ? pin.markers : [],
    };
  });
}

export type { Field, ViewerMarkerPayload } from "@soil/shared/types/fields";
