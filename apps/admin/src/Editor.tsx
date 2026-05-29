import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import * as THREE from "three";
import { ThreeApp } from "@soil/shared/three/ThreeApp";
import type { ControlMode } from "@soil/shared/three/ScreenSpace";
import type { MarkerInput } from "@soil/shared/three/WorldMarkers";
// import { updateFieldMarkers } from "./adminApi";
import { getField, listFields, updateField } from "./adminApi";
import type { Field as AdminField, MarkerPayload } from "./adminApi";
import { normalizeMarkerLabel, type MarkerLabel } from "@soil/shared/types/markerLabel";
import "@soil/shared/styles.css";

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
  viewPosition: [number, number, number];
  radius?: number;
  label?: MarkerLabel;
  icon?: string;
};

type Pin = {
  title: string;
  path: string;
  start_pos?: unknown;
  markers?: unknown[];
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

function parseVector(raw: unknown): [number, number, number] | null {
  if (Array.isArray(raw) && raw.length >= 3) {
    const [x, y, z] = raw.slice(0, 3).map(toFiniteNumber);
    if (x !== null && y !== null && z !== null) return [x, y, z];
  }

  if (raw && typeof raw === "object") {
    const value = raw as { x?: unknown; y?: unknown; z?: unknown };
    const x = toFiniteNumber(value.x);
    const y = toFiniteNumber(value.y);
    const z = toFiniteNumber(value.z);
    if (x !== null && y !== null && z !== null) return [x, y, z];
  }

  return null;
}

function deriveViewPosition(position: [number, number, number]): [number, number, number] {
  return [position[0], position[1] + 2.5, position[2] + 5];
}

function backendMarkersToEditorMarkers(
  raw: unknown[] | undefined,
  currentCameraPosition?: [number, number, number] | null
): EditorMarker[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 3) return null;
      const [icon, scale] = entry;
      const position = parseVector(entry[2]);
      if (!position) return null;
      const isCurrentShape = entry.length >= 5;
      const viewPosition =
        (isCurrentShape ? parseVector(entry[3]) : null) ??
        currentCameraPosition ??
        deriveViewPosition(position);
      return {
        position,
        viewPosition,
        radius: typeof scale === "number" && Number.isFinite(scale) ? scale : undefined,
        label: normalizeMarkerLabel(isCurrentShape ? entry[4] : entry[3]),
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
    const normalizedViewPosition: [number, number, number] = marker.viewPosition.map((value, index) =>
      Number.isFinite(value) ? value : deriveViewPosition(normalizedPosition)[index]
    ) as [number, number, number];
    const radius = typeof marker.radius === "number" && Number.isFinite(marker.radius) ? marker.radius : 0.25;
    const icon = marker.icon && marker.icon.trim() ? marker.icon : DEFAULT_MARKER_ICON;
    return [icon, radius, normalizedPosition, normalizedViewPosition, normalizeMarkerLabel(marker.label)];
  });
}

function cloneEditorMarkers(markers: EditorMarker[]): EditorMarker[] {
  return markers.map((marker) => ({
    ...marker,
    position: [...marker.position] as [number, number, number],
    viewPosition: [...marker.viewPosition] as [number, number, number],
    label: normalizeMarkerLabel(marker.label),
  }));
}

function markerSnapshot(markers: EditorMarker[]): string {
  return JSON.stringify(editorMarkersToBackend(markers));
}

const resolveAssetUrl = (raw: string) => {
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, window.location.origin).href;
  return new URL(`/${raw}`, window.location.origin).href;
};

function parseApiMarkers(
  raw: Array<Record<string, unknown>> | undefined,
  currentCameraPosition?: [number, number, number] | null
): EditorMarker[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      const position = parseVector(m.position);
      if (!position) return null;
      const scale = typeof m.scale === "number" && Number.isFinite(m.scale) ? m.scale : undefined;
      return {
        position,
        viewPosition: parseVector(m.viewPosition) ?? currentCameraPosition ?? deriveViewPosition(position),
        radius: scale,
        label: normalizeMarkerLabel(m.label ?? m.text),
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
    label: normalizeMarkerLabel(m.label),
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const label = normalizeMarkerLabel(parsed.label ?? parsed.text);
    const icon = typeof parsed.icon === "string" ? parsed.icon : undefined;
    const position: [number, number, number] = [x, y, z];
    return {
      position,
      viewPosition: parseVector(parsed.viewPosition) ?? deriveViewPosition(position),
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
  const pendingLabelMarkerIndexRef = useRef<number | null>(null);
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
  const [savedMarkers, setSavedMarkers] = useState<EditorMarker[]>([]);
  const [mode, setMode] = useState<"preview" | "place" | "edit">("preview");
  const [placementDistance, setPlacementDistance] = useState(PLACEMENT_DISTANCE_DEFAULT);
  const [selectedMarkerIndex, setSelectedMarkerIndex] = useState<number | null>(null);
  const [placementIconIndex, setPlacementIconIndex] = useState(0);
  const [placementRadius, setPlacementRadius] = useState(0.1);
  const [placementTitle, setPlacementTitle] = useState("");
  const [placementDescription, setPlacementDescription] = useState("");
  const [placementViewPosition, setPlacementViewPosition] = useState<[number, number, number] | null>(null);
  const [managedField, setManagedField] = useState<AdminField | null>(null);
  const [fieldStatus, setFieldStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [fieldError, setFieldError] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [positionDrafts, setPositionDrafts] = useState<[string, string, string]>(["0.00", "0.00", "0.00"]);
  const [viewPositionDrafts, setViewPositionDrafts] = useState<[string, string, string]>(["0.00", "0.00", "0.00"]);
  const [axisStartPos, setAxisStartPos] = useState<[number, number, number] | null>(null);
  const [showViewPositionNotice, setShowViewPositionNotice] = useState(false);
  const [markerListHost, setMarkerListHost] = useState<HTMLDivElement | null>(null);
  const viewPositionNoticeTimeoutRef = useRef<number | null>(null);

  const getCurrentCameraPosition = useCallback(
    () => appRef.current?.getCameraPosition() ?? null,
    []
  );

  const moveCameraToMarker = useCallback((marker: EditorMarker) => {
    appRef.current?.moveCameraToMarkerView(marker.position, marker.viewPosition);
  }, []);

  const openMarker = useCallback(
    (marker: EditorMarker, index: number) => {
      moveCameraToMarker(marker);
      if (selectedMarkerIndex !== index) {
        pendingLabelMarkerIndexRef.current = index;
        setSelectedMarkerIndex(index);
        return;
      }
      appRef.current?.showWorldMarkerLabel(index);
    },
    [moveCameraToMarker, selectedMarkerIndex]
  );

  const notifyViewPositionSet = useCallback(() => {
    setShowViewPositionNotice(true);
    if (viewPositionNoticeTimeoutRef.current !== null) {
      window.clearTimeout(viewPositionNoticeTimeoutRef.current);
    }
    viewPositionNoticeTimeoutRef.current = window.setTimeout(() => {
      setShowViewPositionNotice(false);
      viewPositionNoticeTimeoutRef.current = null;
    }, 2200);
  }, []);

  useEffect(
    () => () => {
      if (viewPositionNoticeTimeoutRef.current !== null) {
        window.clearTimeout(viewPositionNoticeTimeoutRef.current);
      }
    },
    []
  );

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
            label: ["", ""] as MarkerLabel,
          }
        : undefined;
    const selectedIndex = mode === "edit" ? selectedMarkerIndex : undefined;
    appRef.current.setWorldMarkers(input, preview, selectedIndex);
    if (pendingLabelMarkerIndexRef.current !== null) {
      appRef.current.showWorldMarkerLabel(pendingLabelMarkerIndexRef.current);
      pendingLabelMarkerIndexRef.current = null;
    }
  }, [markers, mode, placementRadius, placementIconIndex, selectedMarkerIndex]);

  const placeMarkerAtCurrentPreview = useCallback(() => {
    if (!appRef.current) return;
    const pos = appRef.current.getPlacementPosition();
    const iconUrl = MARKER_ICON_OPTIONS[placementIconIndex]?.value ?? MARKER_ICON_OPTIONS[0].value;
    const newMarker: EditorMarker = {
      position: [pos.x, pos.y, pos.z],
      viewPosition:
        placementViewPosition ??
        getCurrentCameraPosition() ??
        deriveViewPosition([pos.x, pos.y, pos.z]),
      radius: placementRadius,
      label: [placementTitle, placementDescription],
      icon: iconUrl,
    };
    setMarkers((prev) => {
      setSelectedMarkerIndex(prev.length);
      return [...prev, newMarker];
    });
    setPlacementTitle("");
    setPlacementDescription("");
    setPlacementViewPosition(null);
  }, [
    getCurrentCameraPosition,
    placementDescription,
    placementIconIndex,
    placementRadius,
    placementTitle,
    placementViewPosition,
  ]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const app = new ThreeApp(wrapRef.current, { defaultControlMode, sidebarUi: true });
    appRef.current = app;
    setMarkerListHost(app.getViewerAddonHost());
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
        const nextMarkers = parseApiMarkers(parsed, getCurrentCameraPosition());
        setMarkers(nextMarkers);
        setSavedMarkers(cloneEditorMarkers(nextMarkers));
      } catch {
        // ignore
      }
    } else if (!isFieldManagement) {
      const markerParam = searchParams.get("marker");
      const singleMarker = parseMarkerFormParam(markerParam);
      if (singleMarker) {
        setMarkers([singleMarker]);
        setSavedMarkers(cloneEditorMarkers([singleMarker]));
        setSelectedMarkerIndex(null);
      }
    }

    return () => {
      setMarkerListHost(null);
      app.dispose();
      appRef.current = null;
    };
  }, [searchParams, gaussianPathParam, getCurrentCameraPosition, isFieldManagement, defaultControlMode]);

  useEffect(() => {
    if (!isFieldManagement || !fieldId) {
      setManagedField(null);
      setFieldStatus("idle");
      setFieldError("");
      setAxisStartPos(null);
      setSavedMarkers([]);
      return;
    }

    let cancelled = false;
    setFieldStatus("loading");
    setFieldError("");

    (async () => {
      try {
        const field = await getField(fieldId);
        if (cancelled) return;
        if (!field) {
          setFieldStatus("error");
          setFieldError(`Field "${fieldId}" not found.`);
          return;
        }
        setManagedField(field);
        setFieldStatus("ready");
        setAxisStartPos(parseStartPos(field.start_pos));
        const backendMarkers = Array.isArray(field.markers) ? (field.markers as MarkerPayload[]) : [];
        const nextMarkers = backendMarkersToEditorMarkers(backendMarkers, getCurrentCameraPosition());
        setMarkers(nextMarkers);
        setSavedMarkers(cloneEditorMarkers(nextMarkers));
        const nextSelectedIndex = null;
        setSelectedMarkerIndex(nextSelectedIndex);
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
      } catch (error: unknown) {
        if (cancelled) return;
        setFieldStatus("error");
        setFieldError(errorMessage(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fieldId, gaussianPathParam, getCurrentCameraPosition, isFieldManagement]);

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
      setViewPositionDrafts(["0.00", "0.00", "0.00"]);
      return;
    }

    const selectedMarker = markers[selectedMarkerIndex];
    setPositionDrafts([
      formatCoordinateForInput(selectedMarker.position[0]),
      formatCoordinateForInput(selectedMarker.position[1]),
      formatCoordinateForInput(selectedMarker.position[2]),
    ]);
    setViewPositionDrafts([
      formatCoordinateForInput(selectedMarker.viewPosition[0]),
      formatCoordinateForInput(selectedMarker.viewPosition[1]),
      formatCoordinateForInput(selectedMarker.viewPosition[2]),
    ]);
  }, [markers, selectedMarkerIndex]);

  useEffect(() => {
    if (!appRef.current) return;
    appRef.current.setWorldAxesVisible(true);

    if (mode === "preview") {
      appRef.current.setPlacementDistance(0);
      appRef.current.setEditorCallbacks({
        onMarkerClick: (index) => {
          const marker = markers[index];
          if (!marker) return;
          openMarker(marker, index);
        },
      });
      appRef.current.setMarkerEditing(null);
      appRef.current.setInterestPointEditing(false);
    } else if (mode === "place") {
      appRef.current.setPlacementDistance(placementDistance);
      appRef.current.setEditorCallbacks({
        onMarkerClick: (index) => {
          const marker = markers[index];
          if (!marker) return;
          openMarker(marker, index);
        },
      });
      appRef.current.setMarkerEditing(null);
      appRef.current.setInterestPointEditing(false);
    } else if (mode === "edit") {
      appRef.current.setPlacementDistance(0);
      appRef.current.setEditorCallbacks({
        onMarkerClick: (index) => {
          const marker = markers[index];
          if (marker) openMarker(marker, index);
        },
      });
      appRef.current.setMarkerEditing(
        selectedMarkerIndex,
        (position) => {
          const roundedPosition = position.map((value) => roundCoordinate(value)) as [
            number,
            number,
            number,
          ];
          if (selectedMarkerIndex === null) return;
          setMarkers((prev) => {
            const next = [...prev];
            const marker = next[selectedMarkerIndex];
            if (!marker) return prev;
            next[selectedMarkerIndex] = { ...marker, position: roundedPosition };
            return next;
          });
          setPositionDrafts(roundedPosition.map((value) => formatCoordinateForInput(value)) as [
            string,
            string,
            string,
          ]);
        }
      );
      appRef.current.setInterestPointEditing(false);
    }
  }, [markers, mode, openMarker, placementDistance, selectedMarkerIndex]);

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
    const rawMarkers = pin.markers ?? [];
    const nextMarkers = rawMarkers.some(Array.isArray)
      ? backendMarkersToEditorMarkers(rawMarkers, getCurrentCameraPosition())
      : parseApiMarkers(rawMarkers as Array<Record<string, unknown>>, getCurrentCameraPosition());
    setMarkers(nextMarkers);
    setSavedMarkers(cloneEditorMarkers(nextMarkers));
    setSelectedMarkerIndex(null);
    appRef.current?.loadGaussianScene(resolved);
  }, [pins, selectedPinIndex, gaussianPathParam, getCurrentCameraPosition, isFieldManagement]);

  useEffect(() => {
    listFields()
      .then((data) => {
        const next: Pin[] = data.items.map((field) => ({
          title: field.Name || field.FieldID,
          path: field.File ?? "",
          start_pos: field.start_pos,
          markers: Array.isArray(field.markers) ? field.markers : [],
        }));
        setPins(next);
        if (next.length > 0 && !searchParams.get("gaussianPath") && !searchParams.get("path")) {
          setSelectedPinIndex(0);
        }
      })
      .catch((err) => console.error("Failed to load fields for editor", err));
  }, [searchParams]);

  const handleSaveMarkers = useCallback(async () => {
    if (!fieldId) {
      return;
    }
    setSaveStatus("saving");
    setSaveMessage("");
    try {
      const markerPayload = editorMarkersToBackend(markers);
      const nextStartPos = axisStartPos ?? [0, 0, 0];
      const startPosPayload = {
        x: roundCoordinate(nextStartPos[0]),
        y: roundCoordinate(nextStartPos[1]),
        z: roundCoordinate(nextStartPos[2]),
      };
      await updateField(fieldId, {
        markers: markerPayload,
        start_pos: startPosPayload,
      });
      const refreshedField = await getField(fieldId);
      const persistedStartPos = parseStartPos(refreshedField?.start_pos);
      const persistedMarkers = Array.isArray(refreshedField?.markers)
        ? backendMarkersToEditorMarkers(refreshedField.markers as MarkerPayload[], getCurrentCameraPosition())
        : markerPayload.map((entry) => ({
            icon: entry[0],
            radius: entry[1],
            position: entry[2],
            viewPosition: entry[3],
            label: entry[4],
          }));

      if (refreshedField) {
        setManagedField(refreshedField);
      }
      setAxisStartPos(persistedStartPos ?? nextStartPos);
      setMarkers(persistedMarkers);
      setSavedMarkers(cloneEditorMarkers(persistedMarkers));
      setSaveStatus("success");
      setSaveMessage("Saved.");
    } catch (error: unknown) {
      setSaveStatus("error");
      setSaveMessage(errorMessage(error) || "Failed to save.");
    }
  }, [fieldId, markers, axisStartPos, getCurrentCameraPosition]);

  const selectedMarker = selectedMarkerIndex !== null ? markers[selectedMarkerIndex] : null;
  const hasUnsavedChanges = markerSnapshot(markers) !== markerSnapshot(savedMarkers);

  const handleDiscardMarkers = () => {
    setMarkers(cloneEditorMarkers(savedMarkers));
    setSelectedMarkerIndex(null);
    setSaveStatus("idle");
    setSaveMessage("");
  };

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

  const handleViewPositionDraftChange = (axisIndex: number, value: string) => {
    if (!isCoordinateDraft(value)) return;

    setViewPositionDrafts((prev) => {
      const next = [...prev] as [string, string, string];
      next[axisIndex] = value;
      return next;
    });
  };

  const commitViewPositionDraft = (axisIndex: number) => {
    if (selectedMarkerIndex === null) return;

    const parsedValue = toFiniteNumber(viewPositionDrafts[axisIndex]);
    if (parsedValue === null) {
      setViewPositionDrafts((prev) => {
        const next = [...prev] as [string, string, string];
        next[axisIndex] = formatCoordinateForInput(selectedMarker?.viewPosition[axisIndex]);
        return next;
      });
      return;
    }

    const roundedValue = roundCoordinate(parsedValue);
    setMarkers((prev) => {
      const marker = prev[selectedMarkerIndex];
      if (!marker) return prev;
      const next = [...prev];
      const viewPosition = [...marker.viewPosition] as [number, number, number];
      viewPosition[axisIndex] = roundedValue;
      next[selectedMarkerIndex] = { ...marker, viewPosition };
      return next;
    });
    setViewPositionDrafts((prev) => {
      const next = [...prev] as [string, string, string];
      next[axisIndex] = formatCoordinateForInput(roundedValue);
      return next;
    });
  };

  const selectedMarkerLabel = normalizeMarkerLabel(selectedMarker?.label);
  const selectedIconIndex = Math.max(
    0,
    MARKER_ICON_OPTIONS.findIndex((option) => option.value === (selectedMarker?.icon ?? ""))
  );
  const updateSelectedMarker = (update: (marker: EditorMarker) => EditorMarker) => {
    if (selectedMarkerIndex === null) return;
    setMarkers((prev) => {
      const marker = prev[selectedMarkerIndex];
      if (!marker) return prev;
      const next = [...prev];
      next[selectedMarkerIndex] = update(marker);
      return next;
    });
  };

  const handleSetPlacementViewPosition = () => {
    const viewPosition = getCurrentCameraPosition();
    if (!viewPosition) return;
    setPlacementViewPosition(viewPosition);
    notifyViewPositionSet();
  };

  return (
    <div className="threeWrap markerEditorShell">
      <div className="markerEditorViewer">
        <div className="markerEditorCanvas" ref={wrapRef} />
        {markerListHost &&
          createPortal(
            <aside className="viewerMarkerSidebar" aria-label="Scene markers">
              <h2>Markers</h2>
              <div className="viewerMarkerList">
                {markers.map((marker, index) => (
                  <button
                    key={index}
                    type="button"
                    className={selectedMarkerIndex === index ? "active" : ""}
                    onClick={() => openMarker(marker, index)}
                  >
                    {marker.icon && <img src={resolveAssetUrl(marker.icon)} alt="" />}
                    <span>{normalizeMarkerLabel(marker.label)[0] || `Marker ${index + 1}`}</span>
                  </button>
                ))}
              </div>
            </aside>,
            markerListHost
          )}
        {showViewPositionNotice && (
          <div className="markerViewPositionNotice" role="status" aria-live="polite">
            View Position Set
          </div>
        )}
      </div>
      <aside className="markerEditorSidebar">
        <div className="markerEditorScroll">
          <header className="markerEditorHeader">
            <div className="markerEditorTitleRow">
              <h1>Marker Editor</h1>
              <span className={`markerDirtyFlag ${hasUnsavedChanges ? "isDirty" : ""}`}>
                {hasUnsavedChanges ? "Unsaved changes" : "Saved"}
              </span>
            </div>

            <div className="markerFieldCard">
              {isFieldManagement ? (
                <>
                  <strong>{managedField?.Name || "Untitled Field"}</strong>
                  <span>FieldID: {fieldId}</span>
                  <span>Scene: {gaussianPathParam || managedField?.File || "No scene path"}</span>
                </>
              ) : (
                <>
                  <strong>Scene Preview</strong>
                  {pins.length > 0 && (
                    <select value={selectedPinIndex} onChange={(e) => setSelectedPinIndex(Number(e.target.value))}>
                      {pins.map((pin, i) => (
                        <option key={i} value={i}>
                          {pin.title || `Location ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  )}
                  <span>Open a field from Admin to persist marker changes.</span>
                </>
              )}
            </div>
          </header>

          <section className="markerEditorSection">
            <h2>Mode</h2>
            <div className="markerModeTabs" role="tablist" aria-label="Marker editor mode">
              {([
                ["preview", "Preview"],
                ["place", "Place"],
                ["edit", "Edit"],
              ] as const).map(([nextMode, label]) => (
                <button
                  key={nextMode}
                  type="button"
                  role="tab"
                  aria-selected={mode === nextMode}
                  className={mode === nextMode ? "active" : ""}
                  onClick={() => setMode(nextMode)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {mode === "preview" && (
            <section className="markerEditorSection">
              <div className="markerSectionTitle">
                <h2>Markers</h2>
                <span>{markers.length}</span>
              </div>
              <p className="markerEditorHint">
                Inspect local markers before saving. Select a marker to keep it ready for Edit mode.
              </p>
              <div className="markerList">
                {markers.length === 0 && <p className="markerEmptyState">No markers in this scene.</p>}
                {markers.map((marker, index) => (
                  <button
                    key={index}
                    type="button"
                    className={selectedMarkerIndex === index ? "active" : ""}
                    onClick={() => openMarker(marker, index)}
                  >
                    <span>{normalizeMarkerLabel(marker.label)[0] || "Untitled marker"}</span>
                    <small>
                      {marker.position.map((value) => formatCoordinateForInput(value)).join(", ")}
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )}

          {mode === "place" && (
            <section className="markerEditorSection markerForm">
              <h2>Place Mode</h2>
              <p className="markerEditorHint">
                Fly to the target area, tune the placement preview, and place a marker locally.
              </p>
              <label>
                <span>Placement Distance</span>
                <output>{placementDistance.toFixed(1)} m</output>
              </label>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={placementDistance}
                onChange={(e) => setPlacementDistance(Number(e.target.value))}
              />
              <label>
                <span>Icon</span>
              </label>
              <select value={placementIconIndex} onChange={(e) => setPlacementIconIndex(Number(e.target.value))}>
                {MARKER_ICON_OPTIONS.map((option, index) => (
                  <option key={option.value} value={index}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label>
                <span>Icon Radius</span>
                <output>{placementRadius.toFixed(2)}</output>
              </label>
              <div className="markerRangeRow">
                <input
                  type="range"
                  min={0.01}
                  max={1}
                  step={0.01}
                  value={placementRadius}
                  onChange={(e) => setPlacementRadius(Number(e.target.value))}
                />
                <input
                  type="number"
                  min={0.01}
                  max={1}
                  step={0.01}
                  value={placementRadius}
                  onChange={(e) => setPlacementRadius(Number(e.target.value))}
                />
              </div>
              <label>
                <span>Title</span>
              </label>
              <input
                type="text"
                placeholder="Enter title..."
                value={placementTitle}
                onChange={(e) => setPlacementTitle(e.target.value)}
              />
              <label>
                <span>Description</span>
              </label>
              <textarea
                placeholder="Enter description..."
                value={placementDescription}
                onChange={(e) => setPlacementDescription(e.target.value)}
              />
              <div className="markerEditorCallout">
                The marker will use the preview position and the captured camera view.
              </div>
              <button
                type="button"
                className="markerSubtleButton"
                onClick={handleSetPlacementViewPosition}
              >
                Set View Position
              </button>
              {placementViewPosition && (
                <small className="markerViewCaptured">View position captured from the current camera.</small>
              )}
              <button type="button" className="markerPrimaryButton" onClick={placeMarkerAtCurrentPreview}>
                Place Marker
              </button>
            </section>
          )}

          {mode === "edit" && (
            <>
              <section className="markerEditorSection markerForm">
                <h2>Select Marker</h2>
                <select
                  value={selectedMarkerIndex ?? ""}
                  onChange={(e) => setSelectedMarkerIndex(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Select a marker</option>
                  {markers.map((marker, index) => (
                    <option key={index} value={index}>
                      {normalizeMarkerLabel(marker.label)[0] || "Untitled marker"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="markerSubtleButton"
                  onClick={() => {
                    setPlacementTitle("");
                    setPlacementDescription("");
                    setMode("place");
                  }}
                >
                  + New Marker
                </button>
              </section>

              <section className="markerEditorSection markerForm">
                <h2>Marker Properties</h2>
                {!selectedMarker && <p className="markerEmptyState">Select a marker to edit its properties.</p>}
                {selectedMarker && (
                  <>
                    <label>
                      <span>Icon</span>
                    </label>
                    <select
                      value={selectedIconIndex}
                      onChange={(e) => {
                        const icon = MARKER_ICON_OPTIONS[Number(e.target.value)]?.value;
                        updateSelectedMarker((marker) => ({ ...marker, icon }));
                      }}
                    >
                      {MARKER_ICON_OPTIONS.map((option, index) => (
                        <option key={option.value} value={index}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <label>
                      <span>Icon Radius</span>
                      <output>{(selectedMarker.radius ?? 0.25).toFixed(2)}</output>
                    </label>
                    <div className="markerRangeRow">
                      <input
                        type="range"
                        min={0.01}
                        max={1}
                        step={0.01}
                        value={selectedMarker.radius ?? 0.25}
                        onChange={(e) =>
                          updateSelectedMarker((marker) => ({ ...marker, radius: Number(e.target.value) }))
                        }
                      />
                      <input
                        type="number"
                        min={0.01}
                        max={1}
                        step={0.01}
                        value={selectedMarker.radius ?? 0.25}
                        onChange={(e) =>
                          updateSelectedMarker((marker) => ({ ...marker, radius: Number(e.target.value) }))
                        }
                      />
                    </div>
                    <label>
                      <span>Title</span>
                    </label>
                    <input
                      type="text"
                      value={selectedMarkerLabel[0]}
                      onChange={(e) =>
                        updateSelectedMarker((marker) => ({
                          ...marker,
                          label: [e.target.value, normalizeMarkerLabel(marker.label)[1]],
                        }))
                      }
                    />
                    <label>
                      <span>Description</span>
                    </label>
                    <textarea
                      value={selectedMarkerLabel[1]}
                      onChange={(e) =>
                        updateSelectedMarker((marker) => ({
                          ...marker,
                          label: [normalizeMarkerLabel(marker.label)[0], e.target.value],
                        }))
                      }
                    />
                    <label>
                      <span>Position (World)</span>
                    </label>
                    <div className="markerPositionGrid">
                      {(["x", "y", "z"] as const).map((axis, index) => (
                        <label key={axis}>
                          <span>{axis.toUpperCase()}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step={0.01}
                            value={positionDrafts[index]}
                            onChange={(e) => handlePositionDraftChange(index, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                commitPositionDraft(index);
                                e.currentTarget.blur();
                              }
                            }}
                            onBlur={() => handlePositionDraftBlur(index)}
                          />
                        </label>
                      ))}
                    </div>
                    <label>
                      <span>View Position (Camera)</span>
                    </label>
                    <div className="markerPositionGrid">
                      {(["x", "y", "z"] as const).map((axis, index) => (
                        <label key={axis}>
                          <span>{axis.toUpperCase()}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step={0.01}
                            value={viewPositionDrafts[index]}
                            onChange={(e) => handleViewPositionDraftChange(index, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                commitViewPositionDraft(index);
                                e.currentTarget.blur();
                              }
                            }}
                            onBlur={() => commitViewPositionDraft(index)}
                          />
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="markerSubtleButton"
                      onClick={() => {
                        const viewPosition = getCurrentCameraPosition();
                        if (viewPosition) {
                          updateSelectedMarker((marker) => ({ ...marker, viewPosition }));
                          notifyViewPositionSet();
                        }
                      }}
                    >
                      Set View Position
                    </button>
                    <button
                      type="button"
                      className="markerDangerButton"
                      onClick={() => {
                        setMarkers((prev) => prev.filter((_, index) => index !== selectedMarkerIndex));
                        setSelectedMarkerIndex(null);
                      }}
                    >
                      Delete Marker
                    </button>
                  </>
                )}
              </section>
            </>
          )}

          {(fieldStatus === "loading" || fieldStatus === "error" || saveStatus !== "idle") && (
            <section className="markerEditorStatus" aria-live="polite">
              {fieldStatus === "loading" && <span>Loading field markers...</span>}
              {fieldStatus === "error" && <span className="error">{fieldError || "Unable to load field."}</span>}
              {saveStatus === "success" && <span className="success">{saveMessage || "Saved."}</span>}
              {saveStatus === "error" && <span className="error">{saveMessage || "Failed to save."}</span>}
            </section>
          )}
        </div>

        <footer className="markerEditorActions">
          <span>{markers.length} markers</span>
          <button type="button" onClick={handleDiscardMarkers} disabled={!hasUnsavedChanges || saveStatus === "saving"}>
            Discard Changes
          </button>
          <button
            type="button"
            className="save"
            onClick={handleSaveMarkers}
            disabled={!isFieldManagement || fieldStatus !== "ready" || !hasUnsavedChanges || saveStatus === "saving"}
          >
            {saveStatus === "saving" ? "Saving..." : "Save Changes"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
