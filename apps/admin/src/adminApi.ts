import { fetchAuthSession } from "aws-amplify/auth";
import type {
  AdminField,
  ListFieldsResponse,
  MarkerPayload,
  MutateFieldResponse,
} from "@soil/shared/types/fields";

const BASE = import.meta.env.VITE_ADMIN_API_URL as string | undefined;

export type Field = AdminField;
export type { MarkerPayload };

export type CreateFieldPayload = Field;

// For PUT updates, you usually want to send only what changed.
export type UpdateFieldPayload = Partial<Omit<Field, "FieldID">> & {
  FieldID?: string; // optional, we’ll force it in updateField()
};

async function authHeader() {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${token}` };
}

function requireBaseUrl(): string {
  if (!BASE) throw new Error("VITE_ADMIN_API_URL is not configured.");
  return BASE;
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = await authHeader();
  const res = await fetch(`${requireBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers ?? {}),
    },
  });

  if (res.ok) {
    // Some endpoints (DELETE) might return empty
    const text = await res.text();
    return (text ? JSON.parse(text) : (undefined as unknown as T));
  }

  // Try to extract a helpful message from JSON or text
  const raw = await res.text();
  let message = raw;

  try {
    const parsed = JSON.parse(raw);
    message =
      parsed?.error ??
      parsed?.message ??
      JSON.stringify(parsed);
  } catch {
    // raw is already text
  }

  throw new Error(`${res.status} ${res.statusText}: ${message}`);
}

export async function listFields() {
  return apiFetch<ListFieldsResponse>("/admin/api/fields");
}

export async function getField(fieldId: string): Promise<Field | null> {
  const requested = fieldId.trim();
  if (!requested) return null;
  const data = await listFields();
  return data.items.find((item) => item.FieldID === requested) ?? null;
}

export async function createField(payload: CreateFieldPayload) {
  return apiFetch<MutateFieldResponse>("/admin/api/fields", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Your API Gateway has PUT on /admin/api/fields (no /{id}),
 * so FieldID must be in the JSON body.
 */
export async function updateField(fieldId: string, payload: UpdateFieldPayload) {
  return apiFetch<MutateFieldResponse>("/admin/api/fields", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...payload,
      FieldID: fieldId, // force consistency with the URL-less route
    }),
  });
}

export async function updateFieldMarkers(fieldId: string, markers: MarkerPayload[]) {
  return updateField(fieldId, { markers });
}

/**
 * Your API Gateway has DELETE on /admin/api/fields (no /{id}).
 * Many APIs pass the id in the path, but yours currently doesn’t.
 * So we send { FieldID } in the body.
 *
 * Note: if your DELETE Lambda currently expects pathParameters,
 * update it to also accept body.FieldID (I can paste that version if needed).
 */
export async function deleteField(fieldId: string) {
  await apiFetch<void>("/admin/api/fields", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ FieldID: fieldId }),
  });
}
