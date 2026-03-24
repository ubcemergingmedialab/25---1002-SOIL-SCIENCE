import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as THREE from "three";
import { ThreeApp } from "./three/ThreeApp";
import type { ControlMode } from "./three/ScreenSpace";
import type { MarkerInput } from "./three/WorldMarkers";
import { awsClient } from "./lib/awsClient";
import { listFields, updateFieldMarkers } from "./adminApi";
import type { Field as AdminField, MarkerPayload } from "./adminApi";
import "./index.css";

const PLACEMENT_DISTANCE_DEFAULT = 1;

/** Four marker icon options: markerIcon1–4. Rendered same as DB markers. */
const MARKER_ICON_OPTIONS: { value: string; label: string }[] = [
  { value: "/assets/icons/markerIcon1.png", label: "Marker Icon 1" },
  { value: "/assets/icons/markerIcon2.png", label: "Marker Icon 2" },
  { value: "/assets/icons/markerIcon3.png", label: "Marker Icon 3" },
  { value: "/assets/icons/markerIcon4.png", label: "Marker Icon 4" },
];

const DEFAULT_MARKER_ICON = MARKER_ICON_OPTIONS[0].value;

type EditorMarker = {
  position: [number, number, number];
  radius?: number;
  label?: string;
  icon?: string;
};

type Pin = {
  title: string;
  path: string;
  start_pos?: unknown;
  markers?: Array<Record<string, unknown>>;
};

function parseStartPos(raw: unknown): [number, number, number] | null {
  if (Array.isArray(raw) && raw.length >= 3) {
    const [x, y, z] = raw;
    if ([x, y, z].every((value) => typeof value === "number" && Number.isFinite(value))) {
      return [x, y, z];
    }
  }

  if (raw && typeof raw === "object") {
    const pos = raw as { x?: unknown; y?: unknown; z?: unknown };
    const x = toFiniteNumber(pos.x);
    const y = toFiniteNumber(pos.y);
    const z = toFiniteNumber(pos.z);
    if (x !== null && y !== null && z !== null) {
      return [x, y, z];
    }
  }

  return null;
}

function backendMarkersToEditorMarkers(raw: MarkerPayload[] | undefined): EditorMarker[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 4) return null;
      const [icon, scale, position, text] = entry;
      if (!Array.isArray(position) || position.length < 3) return null;
      if (position.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
      const [x, y, z] = position as [number, number, number];
      return {
        position: [x, y, z],
        radius: typeof scale === "number" && Number.isFinite(scale) ? scale : undefined,
        label: typeof text === "string" ? text : "",
        icon: typeof icon === "string" ? icon : undefined,
      };
    })
    .filter(Boolean) as EditorMarker[];
}

function editorMarkersToBackend(markers: EditorMarker[]): MarkerPayload[] {
  return markers.map((marker) => {
    const [xRaw, yRaw, zRaw] = marker.position;
    const normalizedPosition: [number, number, number] = [
      Number.isFinite(xRaw) ? xRaw : 0,
      Number.isFinite(yRaw) ? yRaw : 0,
      Number.isFinite(zRaw) ? zRaw : 0,
    ];
    const radius = typeof marker.radius === "number" && Number.isFinite(marker.radius) ? marker.radius : 0.25;
    const icon = marker.icon && marker.icon.trim() ? marker.icon : DEFAULT_MARKER_ICON;
    return [icon, radius, normalizedPosition, marker.label ?? ""];
  });
}

const resolveAssetUrl = (raw: string) => {
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, window.location.origin).href;
  return new URL(`/${raw}`, window.location.origin).href;
};

function parseApiMarkers(raw: Array<Record<string, unknown>> | undefined): EditorMarker[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      const pos = m.position as { x?: number; y?: number; z?: number } | undefined;
      const x = pos?.x;
      const y = pos?.y;
      const z = pos?.z;
      if (![x, y, z].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
      const scale = typeof m.scale === "number" && Number.isFinite(m.scale) ? m.scale : undefined;
      return {
        position: [x, y, z],
        radius: scale,
        label: typeof m.text === "string" ? m.text : "",
        icon: typeof m.icon === "string" ? m.icon : undefined,
      };
    })
    .filter(Boolean) as EditorMarker[];
}

function editorMarkersToInput(
  markers: EditorMarker[],
  textureCache: Map<string, THREE.Texture>
): MarkerInput[] {
  const loader = new THREE.TextureLoader();
  const toTexture = (icon?: string) => {
    if (!icon) return undefined;
    const resolved = resolveAssetUrl(icon);
    const cached = textureCache.get(resolved);
    if (cached) return cached;
    const texture = loader.load(resolved);
    textureCache.set(resolved, texture);
    return texture;
  };
  return markers.map((m) => ({
    position: m.position,
    radius: m.radius,
    label: typeof m.label === "string" ? m.label : "",
    texture: toTexture(m.icon),
  }));
}

function getTextureForIcon(iconUrl: string, textureCache: Map<string, THREE.Texture>): THREE.Texture | undefined {
  if (!iconUrl.trim()) return undefined;
  const resolved = resolveAssetUrl(iconUrl);
  const cached = textureCache.get(resolved);
  if (cached) return cached;
  const loader = new THREE.TextureLoader();
  const texture = loader.load(resolved);
  textureCache.set(resolved, texture);
  return texture;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function formatCoordinateForInput(value: number | undefined): string {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return numericValue.toFixed(2);
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function isCoordinateDraft(value: string): boolean {
  return /^-?\d*(?:\.\d*)?$/.test(value.trim());
}

function parseMarkerFormParam(raw: string | null): EditorMarker | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed) return null;
    const x = toFiniteNumber(parsed.posX);
    const y = toFiniteNumber(parsed.posY);
    const z = toFiniteNumber(parsed.posZ);
    if (x === null || y === null || z === null) return null;
    const radius = toFiniteNumber(parsed.scale) ?? undefined;
    const label = typeof parsed.text === "string" ? parsed.text : "";
    const icon = typeof parsed.icon === "string" ? parsed.icon : undefined;
    return {
      position: [x, y, z],
      radius,
      label,
      icon,
    };
  } catch {
    return null;
  }
}

export default function Editor() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<ThreeApp | null>(null);
  const textureCacheRef = useRef<Map<string, THREE.Texture>>(new Map());
  const [searchParams] = useSearchParams();
  const fieldIdParam = searchParams.get("fieldId");
  const fieldId = fieldIdParam ? fieldIdParam.trim() : "";
  const isFieldManagement = Boolean(fieldId);
  const gaussianPathParam = searchParams.get("gaussianPath") || searchParams.get("path");
  const controlModeParam = searchParams.get("controlMode");
  const defaultControlMode: ControlMode = controlModeParam === "fly" || controlModeParam === "orbit" ? controlModeParam : "orbit";

  const [pins, setPins] = useState<Pin[]>([]);
  const [selectedPinIndex, setSelectedPinIndex] = useState<number>(0);
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  const [mode, setMode] = useState<"preview" | "place" | "edit">("preview");
  const [placementDistance, setPlacementDistance] = useState(PLACEMENT_DISTANCE_DEFAULT);
  const [selectedMarkerIndex, setSelectedMarkerIndex] = useState<number | null>(null);
  const [placementIconIndex, setPlacementIconIndex] = useState(0);
  const [placementRadius, setPlacementRadius] = useState(0.1);
  const [placementLabel, setPlacementLabel] = useState("New marker");
  const [managedField, setManagedField] = useState<AdminField | null>(null);
  const [fieldStatus, setFieldStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [fieldError, setFieldError] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [positionDrafts, setPositionDrafts] = useState<[string, string, string]>(["0.00", "0.00", "0.00"]);
  const [axisStartPos, setAxisStartPos] = useState<[number, number, number] | null>(null);

  const syncMarkersToApp = useCallback(() => {
    if (!appRef.current) return;
    const input = editorMarkersToInput(markers, textureCacheRef.current);
    const iconUrl = MARKER_ICON_OPTIONS[placementIconIndex]?.value ?? MARKER_ICON_OPTIONS[0].value;
    const preview =
      mode === "place"
        ? {
            position: [0, 0, 0] as [number, number, number],
            radius: placementRadius,
            texture: getTextureForIcon(iconUrl, textureCacheRef.current),
            label: "",
          }
        : undefined;
    const selectedIndex = mode === "edit" ? selectedMarkerIndex : undefined;
    appRef.current.setWorldMarkers(input, preview, selectedIndex);
  }, [markers, mode, placementRadius, placementIconIndex, selectedMarkerIndex]);

  const placeMarkerAtCurrentPreview = useCallback(() => {
    if (!appRef.current) return;
    const pos = appRef.current.getPlacementPosition();
    const iconUrl = MARKER_ICON_OPTIONS[placementIconIndex]?.value ?? MARKER_ICON_OPTIONS[0].value;
    const newMarker: EditorMarker = {
      position: [pos.x, pos.y, pos.z],
      radius: placementRadius,
      label: placementLabel || "New marker",
      icon: iconUrl,
    };
    setMarkers((prev) => [...prev, newMarker]);
  }, [placementIconIndex, placementRadius, placementLabel]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const app = new ThreeApp(wrapRef.current, { defaultControlMode });
    appRef.current = app;
    app.setWorldAxesPosition(axisStartPos ?? [0, 0, 0]);

    const pathFromUrl = gaussianPathParam;
    const markersParam = searchParams.get("markers");
    if (pathFromUrl) {
      const resolved =
        pathFromUrl.startsWith("/") || /^(https?:|blob:|data:)/i.test(pathFromUrl)
          ? pathFromUrl.startsWith("/")
            ? new URL(pathFromUrl, window.location.origin).href
            : pathFromUrl
          : new URL(pathFromUrl, window.location.href).href;
      app.loadGaussianScene(resolved);
    }
    if (!isFieldManagement && markersParam) {
      try {
        const parsed = JSON.parse(markersParam) as Array<Record<string, unknown>>;
        setMarkers(parseApiMarkers(parsed));
      } catch {
        // ignore
      }
    } else if (!isFieldManagement) {
      const markerParam = searchParams.get("marker");
      const singleMarker = parseMarkerFormParam(markerParam);
      if (singleMarker) {
        setMarkers([singleMarker]);
        setSelectedMarkerIndex(0);
      }
    }

    return () => {
      app.dispose();
      appRef.current = null;
    };
  }, [searchParams, gaussianPathParam, isFieldManagement, defaultControlMode]);

  useEffect(() => {
    if (!isFieldManagement || !fieldId) {
      setManagedField(null);
      setFieldStatus("idle");
      setFieldError("");
      setAxisStartPos(null);
      return;
    }

    let cancelled = false;
    setFieldStatus("loading");
    setFieldError("");

    (async () => {
      try {
        const data = await listFields();
        if (cancelled) return;
        const items = (data.items ?? []) as AdminField[];
        const field = items.find((item) => item.FieldID === fieldId);
        if (!field) {
          setFieldStatus("error");
          setFieldError(`Field "${fieldId}" not found.`);
          return;
        }
        setManagedField(field);
        setFieldStatus("ready");
        setAxisStartPos(parseStartPos(field.start_pos));
        const backendMarkers = Array.isArray(field.markers) ? (field.markers as MarkerPayload[]) : [];
        const nextMarkers = backendMarkersToEditorMarkers(backendMarkers);
        setMarkers(nextMarkers);
        setSelectedMarkerIndex(nextMarkers.length ? 0 : null);
        if (!gaussianPathParam) {
          const filePath = field.File?.trim();
          if (filePath) {
            const resolved =
              filePath.startsWith("/") || /^(https?:|blob:|data:)/i.test(filePath)
                ? filePath.startsWith("/")
                  ? new URL(filePath, window.location.origin).href
                  : filePath
                : new URL(filePath, window.location.href).href;
            appRef.current?.loadGaussianScene(resolved);
          }
        }
      } catch (error: any) {
        if (cancelled) return;
        setFieldStatus("error");
        setFieldError(error?.message ? String(error.message) : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fieldId, gaussianPathParam, isFieldManagement]);

  useEffect(() => {
    setSaveStatus("idle");
    setSaveMessage("");
  }, [fieldId]);

  useEffect(() => {
    syncMarkersToApp();
  }, [syncMarkersToApp]);

  useEffect(() => {
    appRef.current?.setWorldAxesPosition(axisStartPos ?? [0, 0, 0]);
  }, [axisStartPos]);

  useEffect(() => {
    if (selectedMarkerIndex === null || !markers[selectedMarkerIndex]) {
      setPositionDrafts(["0.00", "0.00", "0.00"]);
      return;
    }

    const selectedMarker = markers[selectedMarkerIndex];
    setPositionDrafts([
      formatCoordinateForInput(selectedMarker.position[0]),
      formatCoordinateForInput(selectedMarker.position[1]),
      formatCoordinateForInput(selectedMarker.position[2]),
    ]);
  }, [selectedMarkerIndex]);

  useEffect(() => {
    if (!appRef.current) return;

    if (mode === "preview") {
      appRef.current.setPlacementDistance(0);
      appRef.current.setEditorCallbacks({});
    } else if (mode === "place") {
      appRef.current.setPlacementDistance(placementDistance);
      appRef.current.setEditorCallbacks({});
    } else {
      appRef.current.setPlacementDistance(0);
      appRef.current.setEditorCallbacks({
        onMarkerClick: (index) => setSelectedMarkerIndex(index),
      });
    }
  }, [mode, placementDistance]);

  useEffect(() => {
    const next = pins.length;
    if (next > 0 && selectedPinIndex >= next) setSelectedPinIndex(0);
  }, [pins.length, selectedPinIndex]);

  useEffect(() => {
    if (isFieldManagement) return;
    if (pins.length === 0) return;
    if (gaussianPathParam) return;
    const pin = pins[selectedPinIndex];
    if (!pin?.path) return;
    const resolved =
      pin.path.startsWith("/") || /^(https?:|blob:|data:)/i.test(pin.path)
        ? pin.path.startsWith("/")
          ? new URL(pin.path, window.location.origin).href
          : pin.path
        : new URL(pin.path, window.location.href).href;
    setAxisStartPos(parseStartPos(pin.start_pos));
    setMarkers(parseApiMarkers(pin.markers ?? []));
    setSelectedMarkerIndex(null);
    appRef.current?.loadGaussianScene(resolved);
  }, [pins, selectedPinIndex, gaussianPathParam, isFieldManagement]);

  useEffect(() => {
    awsClient
      .fetch(`${import.meta.env.VITE_API_URL}/pins`, { method: "GET" })
      .then((r) => r.json())
      .then((data: Array<{ title?: string; path?: string; start_pos?: unknown; markers?: Array<Record<string, unknown>> }>) => {
        const next: Pin[] = (data ?? []).map((p) => ({
          title: p.title ?? "",
          path: p.path ?? "",
          start_pos: p.start_pos,
          markers: p.markers ?? [],
        }));
        setPins(next);
        if (next.length > 0 && !searchParams.get("gaussianPath") && !searchParams.get("path")) {
          setSelectedPinIndex(0);
        }
      })
      .catch((err) => console.error("Failed to load pins for editor", err));
  }, [searchParams]);

  const handleSaveMarkers = useCallback(async () => {
    if (!fieldId) return;
    setSaveStatus("saving");
    setSaveMessage("");
    try {
      const payload = editorMarkersToBackend(markers);
      await updateFieldMarkers(fieldId, payload);
      setSaveStatus("success");
      setSaveMessage("Markers saved.");
    } catch (error: any) {
      setSaveStatus("error");
      setSaveMessage(error?.message ? String(error.message) : "Failed to save markers.");
    }
  }, [fieldId, markers]);

  const selectedMarker = selectedMarkerIndex !== null ? markers[selectedMarkerIndex] : null;

  const handlePositionDraftChange = (axisIndex: number, value: string) => {
    if (!isCoordinateDraft(value)) return;

    setPositionDrafts((prev) => {
      const next = [...prev] as [string, string, string];
      next[axisIndex] = value;
      return next;
    });
  };

  const commitPositionDraft = (axisIndex: number) => {
    if (selectedMarkerIndex === null) return;

    const draftValue = positionDrafts[axisIndex];
    const parsedValue = toFiniteNumber(draftValue);

    if (parsedValue === null) {
      const fallbackValue = selectedMarker?.position[axisIndex];
      setPositionDrafts((prev) => {
        const next = [...prev] as [string, string, string];
        next[axisIndex] = formatCoordinateForInput(fallbackValue);
        return next;
      });
      return;
    }

    const roundedValue = roundCoordinate(parsedValue);
    setMarkers((prev) => {
      const next = [...prev];
      const marker = next[selectedMarkerIndex];
      if (!marker) return prev;
      const position = [...marker.position] as [number, number, number];
      position[axisIndex] = roundedValue;
      next[selectedMarkerIndex] = { ...marker, position };
      return next;
    });
    setPositionDrafts((prev) => {
      const next = [...prev] as [string, string, string];
      next[axisIndex] = formatCoordinateForInput(roundedValue);
      return next;
    });
  };

  const handlePositionDraftBlur = (axisIndex: number) => {
    commitPositionDraft(axisIndex);
  };

  return (
    <div className="threeWrap" style={{ display: "flex", flexDirection: "row" }}>
      <div ref={wrapRef} style={{ flex: 1, position: "relative", minHeight: "100vh" }} />

      <aside
        style={{
          width: 280,
          flexShrink: 0,
          background: "rgba(26, 31, 46, 0.95)",
          borderLeft: "1px solid rgba(255,255,255,0.1)",
          padding: "1rem",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >    
        {isFieldManagement ? (
          <>
            <h3 style={{ margin: 0, fontSize: "1rem", color: "#e6edf3" }}>Managing Field</h3>
            <div
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                padding: "0.75rem",
                background: "rgba(0,0,0,0.25)",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <strong style={{ color: "#fff", fontSize: "0.95rem" }}>
                {managedField?.Name || "Untitled Field"}
              </strong>
              <span style={{ fontSize: "0.8rem", color: "#b8c2d1" }}>Field ID: {fieldId}</span>
              <span style={{ fontSize: "0.8rem", color: "#9aa4b5" }}>
                Scene path: {gaussianPathParam || managedField?.File || "Use custom path"}
              </span>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ margin: 0, fontSize: "1rem", color: "#e6edf3" }}>Scene</h3>
            {pins.length > 0 && (
              <select
                value={selectedPinIndex}
                onChange={(e) => setSelectedPinIndex(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(0,0,0,0.3)",
                  color: "#e6edf3",
                  fontSize: "0.875rem",
                }}
              >
                {pins.map((pin, i) => (
                  <option key={i} value={i}>
                    {pin.title || `Location ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
          </>
        )}

        <h3 style={{ margin: 0, fontSize: "1rem", color: "#e6edf3" }}>Mode</h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {(["preview", "place", "edit"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.2)",
                background: mode === m ? "rgba(59, 130, 246, 0.4)" : "rgba(255,255,255,0.06)",
                color: "#e6edf3",
                fontSize: "0.8rem",
                textTransform: "capitalize",
                cursor: "pointer",
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "place" && (
          <>
          <div>
            <label style={{ fontSize: "0.8rem", color: "#9aa4b5" }}>
              Placement distance: {placementDistance.toFixed(1)}m
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={placementDistance}
              onChange={(e) => setPlacementDistance(Number(e.target.value))}
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: "0.9rem", color: "#e6edf3" }}>Preview style</h3>
            <label style={{ fontSize: "0.8rem", color: "#9aa4b5" }}>Label</label>
            <input
              type="text"
              value={placementLabel}
              onChange={(e) => setPlacementLabel(e.target.value)}
              placeholder="New marker"
              style={{
                width: "100%",
                padding: "0.4rem 0.6rem",
                marginTop: "0.25rem",
                marginBottom: "0.5rem",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.3)",
                color: "#e6edf3",
                fontSize: "0.875rem",
              }}
            />
            <label style={{ fontSize: "0.8rem", color: "#9aa4b5" }}>Icon</label>
            <select
              value={placementIconIndex}
              onChange={(e) => setPlacementIconIndex(Number(e.target.value))}
              style={{
                width: "100%",
                padding: "0.4rem 0.6rem",
                marginTop: "0.25rem",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.3)",
                color: "#e6edf3",
                fontSize: "0.875rem",
              }}
            >
              {MARKER_ICON_OPTIONS.map((opt, i) => (
                <option key={i} value={i}>
                  {opt.label}
                </option>
              ))}
            </select>
            <label style={{ display: "block", fontSize: "0.8rem", color: "#9aa4b5", marginTop: "0.5rem" }}>
              Radius: {placementRadius.toFixed(2)}
            </label>
            <input
              type="range"
              min={0.01}
              max={1}
              step={0.01}
              value={placementRadius}
              onChange={(e) => setPlacementRadius(Number(e.target.value))}
              style={{ width: "100%", marginTop: "0.25rem" }}
            />
          </div>
          </>
        )}

        <h3 style={{ margin: 0, fontSize: "1rem", color: "#e6edf3" }}>Markers ({markers.length})</h3>
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {markers.map((m, i) => (
            <li key={i}>
              <button
                onClick={() => mode === "edit" && setSelectedMarkerIndex(i)}
                style={{
                  width: "100%",
                  padding: "0.4rem 0.6rem",
                  borderRadius: 4,
                  border: "1px solid transparent",
                  background: selectedMarkerIndex === i ? "rgba(59, 130, 246, 0.3)" : "rgba(255,255,255,0.04)",
                  color: selectedMarkerIndex === i ? "#fff" : "#b8c2d1",
                  fontSize: "0.8rem",
                  textAlign: "left",
                  cursor: mode === "edit" ? "pointer" : "default",
                }}
              >
                {m.label || `Marker ${i + 1}`}
              </button>
            </li>
          ))}
        </ul>

        {mode === "edit" && selectedMarker && selectedMarkerIndex !== null && (
          <div>
            <h3 style={{ margin: 0, fontSize: "1rem", color: "#e6edf3" }}>Edit marker</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
              <div>
                <label style={{ fontSize: "0.8rem", color: "#9aa4b5" }}>Label</label>
                <input
                  type="text"
                  value={selectedMarker.label ?? ""}
                  onChange={(e) =>
                    setMarkers((prev) => {
                      const next = [...prev];
                      next[selectedMarkerIndex] = { ...next[selectedMarkerIndex], label: e.target.value };
                      return next;
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    marginTop: "0.25rem",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(0,0,0,0.3)",
                    color: "#e6edf3",
                    fontSize: "0.875rem",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", color: "#9aa4b5" }}>Icon</label>
                <select
                  value={Math.max(
                    0,
                    MARKER_ICON_OPTIONS.findIndex((o) => o.value === (selectedMarker.icon ?? ""))
                  )}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    const icon = MARKER_ICON_OPTIONS[i]?.value ?? "";
                    setMarkers((prev) => {
                      const next = [...prev];
                      next[selectedMarkerIndex] = { ...next[selectedMarkerIndex], icon: icon || undefined };
                      return next;
                    });
                  }}
                  style={{
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    marginTop: "0.25rem",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(0,0,0,0.3)",
                    color: "#e6edf3",
                    fontSize: "0.875rem",
                  }}
                >
                  {MARKER_ICON_OPTIONS.map((opt, i) => (
                    <option key={i} value={i}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: "0.8rem", color: "#9aa4b5" }}>Radius (size)</label>
                <input
                  type="number"
                  step={0.01}
                  min={0.01}
                  max={1}
                  value={selectedMarker.radius ?? 0.25}
                  onChange={(e) =>
                    setMarkers((prev) => {
                      const next = [...prev];
                      next[selectedMarkerIndex] = { ...next[selectedMarkerIndex], radius: Number(e.target.value) };
                      return next;
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "0.4rem 0.6rem",
                    marginTop: "0.25rem",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(0,0,0,0.3)",
                    color: "#e6edf3",
                    fontSize: "0.875rem",
                  }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.25rem" }}>
                {(["x", "y", "z"] as const).map((axis, i) => (
                  <div key={axis}>
                    <label style={{ fontSize: "0.75rem", color: "#9aa4b5" }}>{axis.toUpperCase()}</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={positionDrafts[i]}
                      onChange={(e) => handlePositionDraftChange(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitPositionDraft(i);
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={() => handlePositionDraftBlur(i)}
                      style={{
                        width: "100%",
                        padding: "0.35rem 0.4rem",
                        marginTop: "0.2rem",
                        borderRadius: 6,
                        border: "1px solid rgba(255,255,255,0.2)",
                        background: "rgba(0,0,0,0.3)",
                        color: "#e6edf3",
                        fontSize: "0.8rem",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setMarkers((prev) => prev.filter((_, i) => i !== selectedMarkerIndex));
                setSelectedMarkerIndex(null);
              }}
              style={{
                marginTop: "0.75rem",
                padding: "0.4rem 0.75rem",
                borderRadius: 6,
                border: "1px solid rgba(239, 68, 68, 0.5)",
                background: "rgba(239, 68, 68, 0.2)",
                color: "#fca5a5",
                fontSize: "0.85rem",
                cursor: "pointer",
                width: "100%",
              }}
            >
              Delete
            </button>
          </div>
        )}

        {isFieldManagement && (
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {mode === "place" && (
              <button
                type="button"
                onClick={placeMarkerAtCurrentPreview}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: 6,
                  border: "1px solid rgba(59,130,246,0.5)",
                  background: "rgba(59,130,246,0.2)",
                  color: "#bfdbfe",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                }}
              >
                Place Marker
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveMarkers}
              disabled={fieldStatus !== "ready" || saveStatus === "saving"}
              style={{
                padding: "0.55rem 0.75rem",
                borderRadius: 6,
                border: "1px solid rgba(34,197,94,0.6)",
                background:
                  fieldStatus !== "ready" || saveStatus === "saving"
                    ? "rgba(34,197,94,0.15)"
                    : "rgba(34,197,94,0.3)",
                color: "#bbf7d0",
                fontSize: "0.95rem",
                cursor: fieldStatus !== "ready" || saveStatus === "saving" ? "not-allowed" : "pointer",
              }}
            >
              {saveStatus === "saving" ? "Saving..." : "Save Markers"}
            </button>
            {fieldStatus === "loading" && (
              <span style={{ fontSize: "0.8rem", color: "#b8c2d1" }}>Loading field markers...</span>
            )}
            {fieldStatus === "error" && (
              <span style={{ fontSize: "0.8rem", color: "#fca5a5" }}>{fieldError || "Unable to load field."}</span>
            )}
            {saveStatus === "success" && (
              <span style={{ fontSize: "0.8rem", color: "#86efac" }}>{saveMessage || "Markers saved."}</span>
            )}
            {saveStatus === "error" && (
              <span style={{ fontSize: "0.8rem", color: "#fca5a5" }}>{saveMessage || "Failed to save markers."}</span>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
