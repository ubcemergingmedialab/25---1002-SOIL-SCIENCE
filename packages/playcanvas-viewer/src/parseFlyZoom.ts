const ENABLED = new Set(["1", "true", "yes", "on", "enable", "enabled"]);
const DISABLED = new Set(["0", "false", "no", "off", "disable", "disabled"]);

type SearchParamsLike = {
  get(name: string): string | null;
};

/**
 * Parse viewer/editor URL params for fly-mode scroll-wheel FOV zoom.
 *
 * On by default on desktop fly mode; disable with `?flyZoom=0` or `?flyZoom=off`.
 */
export function parseFlyZoomEnabled(searchParams: SearchParamsLike): boolean {
  const value = searchParams.get("flyZoom");
  if (value === null) return true;
  const normalized = value.trim().toLowerCase();
  if (DISABLED.has(normalized)) return false;
  if (ENABLED.has(normalized)) return true;
  return true;
}
