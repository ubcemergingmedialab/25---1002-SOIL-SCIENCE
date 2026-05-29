export type MarkerLabel = [string, string];

export function normalizeMarkerLabel(value: unknown): MarkerLabel {
  if (typeof value === "string") return [value, ""];
  if (!Array.isArray(value)) return ["", ""];

  const [title, description] = value;
  return [
    typeof title === "string" ? title : "",
    typeof description === "string" ? description : "",
  ];
}
