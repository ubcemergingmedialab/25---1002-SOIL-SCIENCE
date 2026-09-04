import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getField, updateField } from "./adminApi";
import {
  createPlayCanvasApp,
  getDefaultPerformancePreset,
  normalizeSplatUrl,
  parseFlyZoomEnabled,
  parseOrientation,
  type PlayCanvasApp,
} from "@soil/playcanvas-viewer";
import {
  backendMarkersToEditorMarkers,
  cloneEditorMarkers,
  deriveViewPosition,
  editorMarkersToBackend,
  editorMarkersToNavigable,
  type EditorMarker,
} from "@soil/shared/markers/editorMarkers";
import {
  formatCoordinateForInput,
  isCoordinateDraft,
  parseCoordinateDraft,
  roundCoordinate,
} from "@soil/shared/markers/editorCoordinates";
import type { ControlMode, SceneInfo } from "@soil/shared/three/ScreenSpace";
import type { Field } from "@soil/shared/types/fields";
import { normalizeMarkerLabel } from "@soil/shared/types/markerLabel";
import { normalizeFieldItem } from "@soil/shared/utils/fields";
import {
  DEFAULT_START_POS,
  deriveStartViewPosition,
  parseStartPos,
  parseStartViewPosition,
} from "@soil/shared/utils/startPos";
import {
  getFieldPlayCanvasSplatUrl,
  resolvePlayCanvasSceneUrl,
} from "@soil/shared/utils/splatUrls";
import "@soil/shared/styles.css";
import PlayCanvasLoadingOverlay from "./PlayCanvasLoadingOverlay";
import { ScrubAxisInput } from "./ScrubAxisInput";

const PLACEMENT_DISTANCE_DEFAULT = 1;

const MARKER_ICON_OPTIONS: { value: string; label: string }[] = [
  { value: "/assets/icons/markerIcon1.png", label: "Marker Icon 1" },
  { value: "/assets/icons/markerIcon2.png", label: "Marker Icon 2" },
  { value: "/assets/icons/markerIcon3.png", label: "Marker Icon 3" },
  { value: "/assets/icons/markerIcon4.png", label: "Marker Icon 4" },
];

type EditorMode = "preview" | "place" | "edit";

type LoadState =
  | { status: "loading"; message: string }
  | { status: "error"; title: string; message: string }
  | {
      status: "ready";
      splatUrl: string;
      sceneInfo: SceneInfo;
      orientationX: number;
      orientationY: number;
      orientationZ: number;
      field: Field | null;
      startPos: [number, number, number];
      startViewPosition: [number, number, number];
    };

const formatFieldLocation = (field: Field) => {
  if (field.LocationName?.trim()) return field.LocationName.trim();
  if (typeof field.Latitude === "number" && typeof field.Longitude === "number") {
    return `${field.Latitude.toFixed(5)}, ${field.Longitude.toFixed(5)}`;
  }
  return field.FieldID;
};

const getFieldSceneInfo = (field: Field): SceneInfo => ({
  title: field.Name || field.FieldID,
  location: formatFieldLocation(field),
  description: field.Description,
});

const parseControlMode = (raw: string | null): ControlMode =>
  raw === "fly" || raw === "orbit" ? raw : "fly";

const resolveAssetUrl = (raw: string) => {
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, window.location.origin).href;
  return new URL(`/${raw}`, window.location.origin).href;
};

const isSidebarTypingTarget = (element: EventTarget | null) => {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLSelectElement) return true;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    return type !== "range" && type !== "button" && type !== "checkbox" && type !== "radio";
  }
  return false;
};

const markerSnapshot = (nextMarkers: EditorMarker[]) =>
  JSON.stringify(
    nextMarkers.map((m) => ({
      ...m,
      label: normalizeMarkerLabel(m.label),
    })),
  );

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default function PlayCanvasEditor() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playCanvasAppRef = useRef<PlayCanvasApp | null>(null);
  const controlModeRef = useRef<ControlMode>("fly");
  const viewPositionNoticeTimeoutRef = useRef<number | null>(null);
  const [searchParams] = useSearchParams();
  const [controlMode, setControlMode] = useState<ControlMode>(() =>
    parseControlMode(searchParams.get("controlMode")),
  );
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "Preparing editor…",
  });
  const [splatLoading, setSplatLoading] = useState(false);
  const [overlayHint, setOverlayHint] = useState("Preparing scene...");
  const [overlayProgress, setOverlayProgress] = useState<number | null>(0);
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  const [savedMarkers, setSavedMarkers] = useState<EditorMarker[]>([]);
  const [mode, setMode] = useState<EditorMode>("preview");
  const [selectedMarkerIndex, setSelectedMarkerIndex] = useState<number | null>(null);
  const [placementDistance, setPlacementDistance] = useState(PLACEMENT_DISTANCE_DEFAULT);
  const [placementIconIndex, setPlacementIconIndex] = useState(0);
  const [placementRadius, setPlacementRadius] = useState(0.1);
  const [placementTitle, setPlacementTitle] = useState("");
  const [placementDescription, setPlacementDescription] = useState("");
  const [placementViewPosition, setPlacementViewPosition] = useState<
    [number, number, number] | null
  >(null);
  const [showViewPositionNotice, setShowViewPositionNotice] = useState(false);
  const [positionDrafts, setPositionDrafts] = useState<[string, string, string]>([
    "0.00",
    "0.00",
    "0.00",
  ]);
  const [viewPositionDrafts, setViewPositionDrafts] = useState<[string, string, string]>([
    "0.00",
    "0.00",
    "0.00",
  ]);
  const [axisStartPos, setAxisStartPos] =
    useState<[number, number, number]>(DEFAULT_START_POS);
  const [savedStartPos, setSavedStartPos] =
    useState<[number, number, number]>(DEFAULT_START_POS);
  const [startViewPosition, setStartViewPosition] = useState<[number, number, number]>(
    deriveStartViewPosition(DEFAULT_START_POS),
  );
  const [savedStartViewPosition, setSavedStartViewPosition] = useState<
    [number, number, number]
  >(deriveStartViewPosition(DEFAULT_START_POS));
  const [startViewPositionDrafts, setStartViewPositionDrafts] = useState<
    [string, string, string]
  >(["0.00", "0.00", "0.00"]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");

  const markersSyncKey = markerSnapshot(markers);
  const selectedMarkerPositionKey =
    selectedMarkerIndex !== null && markers[selectedMarkerIndex]
      ? markers[selectedMarkerIndex].position.join(",")
      : "";
  const selectedMarkerRadiusKey =
    selectedMarkerIndex !== null && markers[selectedMarkerIndex]
      ? markers[selectedMarkerIndex].radius ?? 0.25
      : null;
  const selectedMarkerIndexRef = useRef(selectedMarkerIndex);
  selectedMarkerIndexRef.current = selectedMarkerIndex;

  const fieldId = searchParams.get("fieldId")?.trim() ?? "";
  const isFieldManagement = Boolean(fieldId);
  const directUrl =
    searchParams.get("url")?.trim() ||
    searchParams.get("gaussianPath")?.trim() ||
    searchParams.get("path")?.trim() ||
    "";
  const orientation = parseOrientation(searchParams);
  const flyZoom = parseFlyZoomEnabled(searchParams);

  controlModeRef.current = controlMode;

  const getCurrentCameraPosition = useCallback((): [number, number, number] | null => {
    return playCanvasAppRef.current?.getCameraPosition() ?? null;
  }, []);

  const openMarker = useCallback((index: number) => {
    const app = playCanvasAppRef.current;
    if (!app) return;

    setSelectedMarkerIndex(index);
    app.setSelectedMarkerIndex(index);
    app.flyToMarker(index);
    app.showMarkerLabel(index);
  }, []);

  const syncCameraInputForSidebarFocus = useCallback(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const active = document.activeElement;
    const editing =
      active instanceof HTMLElement && sidebar.contains(active) && isSidebarTypingTarget(active);
    playCanvasAppRef.current?.setCameraInputEnabled(!editing);
  }, []);

  const handleSidebarFocusCapture = () => {
    syncCameraInputForSidebarFocus();
  };

  const handleSidebarBlurCapture = () => {
    window.requestAnimationFrame(() => {
      syncCameraInputForSidebarFocus();
    });
  };

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
    [],
  );

  useEffect(() => {
    setStartViewPositionDrafts([
      formatCoordinateForInput(startViewPosition[0]),
      formatCoordinateForInput(startViewPosition[1]),
      formatCoordinateForInput(startViewPosition[2]),
    ]);
  }, [startViewPosition]);

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

  const placeMarkerAtCurrentPreview = useCallback(() => {
    const app = playCanvasAppRef.current;
    if (!app) return;

    const [x, y, z] = app.getPlacementPosition();
    const iconUrl = MARKER_ICON_OPTIONS[placementIconIndex]?.value ?? MARKER_ICON_OPTIONS[0].value;
    const newMarker: EditorMarker = {
      position: [x, y, z],
      viewPosition:
        placementViewPosition ??
        getCurrentCameraPosition() ??
        deriveViewPosition([x, y, z]),
      radius: placementRadius,
      label: [placementTitle, placementDescription],
      icon: iconUrl,
    };

    setMarkers((prev) => {
      const nextIndex = prev.length;
      setSelectedMarkerIndex(nextIndex);
      return [...prev, newMarker];
    });
    setPlacementTitle("");
    setPlacementDescription("");
    setPlacementViewPosition(null);
    setMode("preview");
  }, [
    getCurrentCameraPosition,
    placementDescription,
    placementIconIndex,
    placementRadius,
    placementTitle,
    placementViewPosition,
  ]);

  const handleSetPlacementViewPosition = () => {
    const viewPosition = getCurrentCameraPosition();
    if (!viewPosition) return;
    setPlacementViewPosition(viewPosition);
    notifyViewPositionSet();
  };

  const selectedMarker = selectedMarkerIndex !== null ? markers[selectedMarkerIndex] : null;
  const selectedMarkerLabel = normalizeMarkerLabel(selectedMarker?.label);
  const selectedIconIndex = Math.max(
    0,
    MARKER_ICON_OPTIONS.findIndex((option) => option.value === (selectedMarker?.icon ?? "")),
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

  const handleEditMarkerSelect = (rawIndex: string) => {
    const index = rawIndex ? Number(rawIndex) : null;
    setSelectedMarkerIndex(index);
    playCanvasAppRef.current?.setSelectedMarkerIndex(index);
  };

  const handlePositionDraftChange = (axisIndex: number, value: string) => {
    if (!isCoordinateDraft(value)) return;
    setPositionDrafts((prev) => {
      const next = [...prev] as [string, string, string];
      next[axisIndex] = value;
      return next;
    });
  };

  const setPositionAxisValue = useCallback(
    (axisIndex: number, value: number) => {
      const rounded = roundCoordinate(value);
      const formatted = formatCoordinateForInput(rounded);
      setPositionDrafts((prev) => {
        const next = [...prev] as [string, string, string];
        next[axisIndex] = formatted;
        return next;
      });
      if (selectedMarkerIndex === null) return;
      setMarkers((prev) => {
        const next = [...prev];
        const marker = next[selectedMarkerIndex];
        if (!marker) return prev;
        const position = [...marker.position] as [number, number, number];
        position[axisIndex] = rounded;
        next[selectedMarkerIndex] = { ...marker, position };
        return next;
      });
    },
    [selectedMarkerIndex],
  );

  const setViewPositionAxisValue = useCallback(
    (axisIndex: number, value: number) => {
      const rounded = roundCoordinate(value);
      const formatted = formatCoordinateForInput(rounded);
      setViewPositionDrafts((prev) => {
        const next = [...prev] as [string, string, string];
        next[axisIndex] = formatted;
        return next;
      });
      if (selectedMarkerIndex === null) return;
      setMarkers((prev) => {
        const next = [...prev];
        const marker = next[selectedMarkerIndex];
        if (!marker) return prev;
        const viewPosition = [...marker.viewPosition] as [number, number, number];
        viewPosition[axisIndex] = rounded;
        next[selectedMarkerIndex] = { ...marker, viewPosition };
        return next;
      });
    },
    [selectedMarkerIndex],
  );

  const handleAxisScrubActiveChange = useCallback((active: boolean) => {
    if (active) {
      playCanvasAppRef.current?.setCameraInputEnabled(false);
      return;
    }
    syncCameraInputForSidebarFocus();
  }, [syncCameraInputForSidebarFocus]);

  const commitPositionDraft = (axisIndex: number) => {
    if (selectedMarkerIndex === null) return;

    const parsedValue = parseCoordinateDraft(positionDrafts[axisIndex]);
    if (parsedValue === null) {
      setPositionDrafts((prev) => {
        const next = [...prev] as [string, string, string];
        next[axisIndex] = formatCoordinateForInput(selectedMarker?.position[axisIndex]);
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

  const commitViewPositionDraft = (axisIndex: number) => {
    if (selectedMarkerIndex === null) return;

    const parsedValue = parseCoordinateDraft(viewPositionDrafts[axisIndex]);
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

  const handleSetStartViewPosition = () => {
    const viewPosition = getCurrentCameraPosition();
    if (!viewPosition) return;
    const rounded = viewPosition.map(roundCoordinate) as [number, number, number];
    setStartViewPosition(rounded);
    playCanvasAppRef.current?.setStartViewPosition(rounded);
    notifyViewPositionSet();
  };

  const setStartViewPositionAxisValue = useCallback((axisIndex: number, value: number) => {
    const rounded = roundCoordinate(value);
    const formatted = formatCoordinateForInput(rounded);
    setStartViewPositionDrafts((prev) => {
      const next = [...prev] as [string, string, string];
      next[axisIndex] = formatted;
      return next;
    });
    setStartViewPosition((prev) => {
      const next = [...prev] as [number, number, number];
      next[axisIndex] = rounded;
      playCanvasAppRef.current?.setStartViewPosition(next);
      return next;
    });
  }, []);

  const commitStartViewPositionDraft = (axisIndex: number) => {
    const parsedValue = parseCoordinateDraft(startViewPositionDrafts[axisIndex]);
    if (parsedValue === null) {
      setStartViewPositionDrafts((prev) => {
        const next = [...prev] as [string, string, string];
        next[axisIndex] = formatCoordinateForInput(startViewPosition[axisIndex]);
        return next;
      });
      return;
    }

    const roundedValue = roundCoordinate(parsedValue);
    setStartViewPosition((prev) => {
      const next = [...prev] as [number, number, number];
      next[axisIndex] = roundedValue;
      playCanvasAppRef.current?.setStartViewPosition(next);
      return next;
    });
    setStartViewPositionDrafts((prev) => {
      const next = [...prev] as [string, string, string];
      next[axisIndex] = formatCoordinateForInput(roundedValue);
      return next;
    });
  };

  const handleSetEditViewPosition = () => {
    const viewPosition = getCurrentCameraPosition();
    if (!viewPosition) return;
    const rounded = viewPosition.map(roundCoordinate) as [number, number, number];
    updateSelectedMarker((marker) => ({ ...marker, viewPosition: rounded }));
    setViewPositionDrafts([
      formatCoordinateForInput(rounded[0]),
      formatCoordinateForInput(rounded[1]),
      formatCoordinateForInput(rounded[2]),
    ]);
    notifyViewPositionSet();
  };

  const handleDeleteSelectedMarker = () => {
    if (selectedMarkerIndex === null) return;
    setMarkers((prev) => prev.filter((_, index) => index !== selectedMarkerIndex));
    setSelectedMarkerIndex(null);
    playCanvasAppRef.current?.setSelectedMarkerIndex(null);
    playCanvasAppRef.current?.hideMarkerLabel();
    playCanvasAppRef.current?.setMarkerEditing(null);
  };

  const applyStartPosEdit = useCallback((position: [number, number, number]) => {
    const rounded = position.map(roundCoordinate) as [number, number, number];
    setAxisStartPos(rounded);
  }, []);

  const applyMarkerPositionEdit = useCallback(
    (position: [number, number, number]) => {
      if (selectedMarkerIndex === null) return;
      const rounded = position.map(roundCoordinate) as [number, number, number];
      setMarkers((prev) => {
        const next = [...prev];
        const current = next[selectedMarkerIndex];
        if (!current) return prev;
        next[selectedMarkerIndex] = { ...current, position: rounded };
        return next;
      });
      setPositionDrafts([
        formatCoordinateForInput(rounded[0]),
        formatCoordinateForInput(rounded[1]),
        formatCoordinateForInput(rounded[2]),
      ]);
    },
    [selectedMarkerIndex],
  );

  const handleSaveMarkers = useCallback(async () => {
    if (!fieldId) return;

    setSaveStatus("saving");
    setSaveMessage("");
    try {
      const markerPayload = editorMarkersToBackend(markers);
      const nextStartPos = axisStartPos;
      const startPosPayload = {
        x: roundCoordinate(nextStartPos[0]),
        y: roundCoordinate(nextStartPos[1]),
        z: roundCoordinate(nextStartPos[2]),
      };
      const nextStartViewPosition = startViewPosition;
      const startViewPositionPayload = {
        x: roundCoordinate(nextStartViewPosition[0]),
        y: roundCoordinate(nextStartViewPosition[1]),
        z: roundCoordinate(nextStartViewPosition[2]),
      };
      await updateField(fieldId, {
        markers: markerPayload,
        start_pos: startPosPayload,
        start_view_position: startViewPositionPayload,
      });

      const refreshedField = await getField(fieldId);
      const persistedStartPos = parseStartPos(refreshedField?.start_pos) ?? nextStartPos;
      const persistedStartViewPosition =
        parseStartViewPosition(refreshedField?.start_view_position) ??
        deriveStartViewPosition(persistedStartPos);
      const persistedMarkers = Array.isArray(refreshedField?.markers)
        ? backendMarkersToEditorMarkers(refreshedField.markers)
        : cloneEditorMarkers(markers);

      setAxisStartPos(persistedStartPos);
      setSavedStartPos(persistedStartPos);
      setStartViewPosition(persistedStartViewPosition);
      setSavedStartViewPosition(persistedStartViewPosition);
      playCanvasAppRef.current?.setStartViewPosition(persistedStartViewPosition);
      setMarkers(cloneEditorMarkers(persistedMarkers));
      setSavedMarkers(cloneEditorMarkers(persistedMarkers));
      setSaveStatus("success");
      setSaveMessage("Saved.");
    } catch (error: unknown) {
      setSaveStatus("error");
      setSaveMessage(errorMessage(error) || "Failed to save.");
    }
  }, [axisStartPos, fieldId, markers, startViewPosition]);

  const handleDiscardMarkers = () => {
    setMarkers(cloneEditorMarkers(savedMarkers));
    setAxisStartPos(savedStartPos);
    setStartViewPosition(savedStartViewPosition);
    playCanvasAppRef.current?.setStartViewPosition(savedStartViewPosition);
    setSelectedMarkerIndex(null);
    playCanvasAppRef.current?.setSelectedMarkerIndex(null);
    playCanvasAppRef.current?.hideMarkerLabel();
    setSaveStatus("idle");
    setSaveMessage("");
  };

  useEffect(() => {
    setSaveStatus("idle");
    setSaveMessage("");
  }, [fieldId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (directUrl) {
        setMarkers([]);
        setSavedMarkers([]);
        setAxisStartPos(DEFAULT_START_POS);
        setSavedStartPos(DEFAULT_START_POS);
        const defaultViewPosition = deriveStartViewPosition(DEFAULT_START_POS);
        setStartViewPosition(defaultViewPosition);
        setSavedStartViewPosition(defaultViewPosition);
        setLoadState({
          status: "ready",
          splatUrl: normalizeSplatUrl(directUrl),
          sceneInfo: {
            title: searchParams.get("title") ?? "Local splat",
            location: searchParams.get("location") ?? undefined,
          },
          orientationX: orientation.x,
          orientationY: orientation.y,
          orientationZ: orientation.z,
          field: null,
          startPos: DEFAULT_START_POS,
          startViewPosition: defaultViewPosition,
        });
        return;
      }

      if (!fieldId) {
        setLoadState({
          status: "error",
          title: "Missing field id",
          message: "Open the editor from Admin (Manage Markers) or use ?fieldId={FieldID}.",
        });
        return;
      }

      setLoadState({
        status: "loading",
        message: `Loading field ${fieldId}…`,
      });

      try {
        const field = await getField(fieldId);
        if (cancelled) return;

        if (!field) {
          setLoadState({
            status: "error",
            title: "Field not found",
            message: `No field exists for FieldID "${fieldId}".`,
          });
          return;
        }

        const splatUrl = getFieldPlayCanvasSplatUrl(field);
        if (!splatUrl) {
          setLoadState({
            status: "error",
            title: "Missing PlayCanvas splat",
            message: `Field "${field.FieldID}" has no FilePlayCanvas URL. Use the legacy editor or backfill streamed LOD.`,
          });
          return;
        }

        const normalized = normalizeFieldItem(field);
        if (!normalized) {
          setLoadState({
            status: "error",
            title: "Invalid field record",
            message: `Field "${field.FieldID}" could not be parsed.`,
          });
          return;
        }

        const initialMarkers = backendMarkersToEditorMarkers(
          Array.isArray(field.markers) ? field.markers : undefined,
        );
        const initialStartPos = parseStartPos(normalized.start_pos) ?? DEFAULT_START_POS;
        const initialStartViewPosition =
          parseStartViewPosition(normalized.start_view_position) ??
          deriveStartViewPosition(initialStartPos);
        setMarkers(cloneEditorMarkers(initialMarkers));
        setSavedMarkers(cloneEditorMarkers(initialMarkers));
        setAxisStartPos(initialStartPos);
        setSavedStartPos(initialStartPos);
        setStartViewPosition(initialStartViewPosition);
        setSavedStartViewPosition(initialStartViewPosition);
        setSelectedMarkerIndex(null);
        setMode("preview");

        setLoadState({
          status: "ready",
          splatUrl: normalizeSplatUrl(splatUrl),
          sceneInfo: getFieldSceneInfo(normalized),
          orientationX: orientation.x,
          orientationY: orientation.y,
          orientationZ: orientation.z,
          field: normalized,
          startPos: initialStartPos,
          startViewPosition: initialStartViewPosition,
        });
      } catch (err) {
        if (cancelled) return;
        console.error("[PlayCanvasEditor] failed to load field", err);
        setLoadState({
          status: "error",
          title: "Failed to load field",
          message: "The field record could not be loaded. Check the FieldID and try again.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [directUrl, fieldId, orientation.x, orientation.y, orientation.z, searchParams.get("title"), searchParams.get("location")]);

  useEffect(() => {
    if (loadState.status !== "ready") return;

    const canvas = canvasRef.current;
    const overlayParent = wrapRef.current;
    if (!canvas || !overlayParent) return;

    let app: PlayCanvasApp | null = null;
    let cancelled = false;
    setSplatLoading(true);
    setOverlayHint("Downloading scene data...");
    setOverlayProgress(null);
    playCanvasAppRef.current = null;

    (async () => {
      try {
        app = await createPlayCanvasApp({
          canvas,
          splatUrl: loadState.splatUrl,
          orientationX: loadState.orientationX,
          orientationY: loadState.orientationY,
          orientationZ: loadState.orientationZ,
          markers: [],
          markerOverlayParent: overlayParent,
          defaultControlMode: controlModeRef.current,
          performancePreset: getDefaultPerformancePreset(),
          flyOnMarkerClick: false,
          startPos: loadState.startPos,
          startViewPosition: loadState.startViewPosition,
          showStartAxes: isFieldManagement,
          groundClamp: { enabled: false },
          flyZoom,
          onLoadProgress: ({ hint, progress }) => {
            if (cancelled) return;
            setOverlayHint(hint);
            setOverlayProgress(progress);
          },
        });
        if (cancelled) {
          app.destroy();
          return;
        }
        playCanvasAppRef.current = app;
        app.setControlMode(controlModeRef.current);
        app.setMarkerClickHandler(openMarker);
        setSplatLoading(false);
      } catch (err) {
        if (!cancelled) {
          setSplatLoading(false);
          console.error("[PlayCanvasEditor] splat load failed", err);
          setLoadState({
            status: "error",
            title: "Failed to load splat",
            message:
              err instanceof Error
                ? err.message
                : "The PlayCanvas splat could not be loaded.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      setSplatLoading(false);
      playCanvasAppRef.current = null;
      app?.destroy();
    };
  }, [loadState, openMarker, isFieldManagement, flyZoom]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading || !isFieldManagement) return;
    app.setStartPosEditing({
      onChange: applyStartPosEdit,
      onCommit: applyStartPosEdit,
    });
  }, [applyStartPosEdit, isFieldManagement, splatLoading]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading || !isFieldManagement) return;
    const markerGizmoActive = mode === "edit" && selectedMarkerIndex !== null;
    app.setStartPosInteractive(!markerGizmoActive);
  }, [isFieldManagement, mode, selectedMarkerIndex, splatLoading]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading) return;
    app.setStartViewPosition(startViewPosition);
  }, [splatLoading, startViewPosition]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading) return;
    app.setStartAxesPosition(axisStartPos);
  }, [axisStartPos, splatLoading]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading) return;

    if (mode !== "edit" || selectedMarkerIndex === null) {
      app.setMarkerEditing(null);
      return;
    }

    if (!markers[selectedMarkerIndex]) {
      app.setMarkerEditing(null);
      return;
    }

    app.setMarkerEditing(selectedMarkerIndex, {
      onChange: applyMarkerPositionEdit,
      onCommit: applyMarkerPositionEdit,
    });
  }, [applyMarkerPositionEdit, mode, selectedMarkerIndex, splatLoading]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading || mode !== "edit" || selectedMarkerIndex === null) return;
    const marker = markers[selectedMarkerIndex];
    if (!marker) return;
    app.setMarkerGizmoPosition(marker.position);
  }, [mode, selectedMarkerIndex, selectedMarkerPositionKey, splatLoading]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading || mode !== "edit" || selectedMarkerIndex === null) return;
    const marker = markers[selectedMarkerIndex];
    if (!marker) return;
    app.setMarkerGizmoRadius(marker.radius ?? 0.25);
  }, [mode, selectedMarkerIndex, selectedMarkerRadiusKey, splatLoading]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading) return;

    app.setMarkers(editorMarkersToNavigable(markers), {
      selectedIndex: selectedMarkerIndexRef.current,
    });
  }, [markersSyncKey, splatLoading]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading) return;
    app.setSelectedMarkerIndex(selectedMarkerIndex);
  }, [selectedMarkerIndex, splatLoading]);

  useEffect(() => {
    const app = playCanvasAppRef.current;
    if (!app || splatLoading) return;

    if (mode === "place") {
      app.setPlacementPreview({
        visible: true,
        distance: placementDistance,
        icon: MARKER_ICON_OPTIONS[placementIconIndex]?.value ?? MARKER_ICON_OPTIONS[0].value,
        radius: placementRadius,
      });
    } else {
      app.setPlacementPreview(null);
    }
  }, [mode, placementDistance, placementIconIndex, placementRadius, splatLoading]);

  const handleControlModeChange = (nextMode: ControlMode) => {
    setControlMode(nextMode);
    playCanvasAppRef.current?.setControlMode(nextMode);
  };

  const handleResetCamera = () => {
    playCanvasAppRef.current?.resetCamera();
  };

  const legacyEditorHref = fieldId
    ? `/editor?fieldId=${encodeURIComponent(fieldId)}&renderer=legacy`
    : "/editor?renderer=legacy";
  const viewerHref = fieldId ? `/viewer/?m=${encodeURIComponent(fieldId)}` : "/viewer/";

  const hasUnsavedChanges =
    markerSnapshot(markers) !== markerSnapshot(savedMarkers) ||
    axisStartPos.join(",") !== savedStartPos.join(",") ||
    startViewPosition.join(",") !== savedStartViewPosition.join(",");

  if (loadState.status === "loading") {
    return (
      <div className="playCanvasLoadingShell">
        <PlayCanvasLoadingOverlay hint={loadState.message} progress={null} title="Loading editor" />
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <main className="viewerStatusShell">
        <section className="viewerStatusCard" role="alert">
          <h1>{loadState.title}</h1>
          <p>{loadState.message}</p>
          {fieldId ? (
            <p className="viewerInstructionExample" style={{ marginTop: "1rem" }}>
              <Link to={legacyEditorHref}>Open legacy editor</Link>
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  const { sceneInfo, field } = loadState;
  const playCanvasUrl = field ? resolvePlayCanvasSceneUrl(field) : loadState.splatUrl;
  const navigableMarkers = editorMarkersToNavigable(markers);

  return (
    <div className="threeWrap markerEditorShell">
      <div className="markerEditorViewer" ref={wrapRef}>
        <div className="markerEditorCanvas">
          <canvas
            ref={canvasRef}
            className="playCanvasSurface"
            aria-label={sceneInfo.title ?? "Gaussian splat scene"}
          />
        </div>

        {splatLoading ? (
          <PlayCanvasLoadingOverlay hint={overlayHint} progress={overlayProgress} />
        ) : null}

        {showViewPositionNotice ? (
          <div className="markerViewPositionNotice" role="status" aria-live="polite">
            View Position Set
          </div>
        ) : null}
      </div>

      <aside
        ref={sidebarRef}
        className="markerEditorSidebar"
        onFocusCapture={handleSidebarFocusCapture}
        onBlurCapture={handleSidebarBlurCapture}
      >
        <div className="markerEditorScroll">
          <header className="markerEditorHeader">
            <div className="markerEditorTitleRow">
              <h1>Marker Editor</h1>
              <span className={`markerDirtyFlag ${hasUnsavedChanges ? "isDirty" : ""}`}>
                {hasUnsavedChanges ? "Unsaved changes" : "Saved"}
              </span>
            </div>

            <div className="markerFieldCard">
              <strong>{sceneInfo.title}</strong>
              {fieldId ? <span>FieldID: {fieldId}</span> : null}
              {sceneInfo.location ? <span>{sceneInfo.location}</span> : null}
              <span>
                Scene: {playCanvasUrl}
                {field?.FileFormat ? ` (${field.FileFormat})` : ""}
              </span>
              <Link to={legacyEditorHref}>Legacy editor</Link>
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

          <section className="markerEditorSection">
            <h2>Camera</h2>
            <div
              className="markerModeTabs markerModeTabs--two"
              role="tablist"
              aria-label="Camera control mode"
            >
              {([
                ["fly", "Fly", "WASD move, drag to look, scroll wheel to zoom (FOV)"],
                ["orbit", "Orbit", "Drag to orbit, right-drag to pan, wheel to dolly zoom"],
              ] as const).map(([nextMode, label, title]) => (
                <button
                  key={nextMode}
                  type="button"
                  role="tab"
                  aria-selected={controlMode === nextMode}
                  className={controlMode === nextMode ? "active" : ""}
                  title={title}
                  onClick={() => handleControlModeChange(nextMode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="markerSubtleButton" onClick={handleResetCamera}>
              Reset camera
            </button>
          </section>

          {isFieldManagement ? (
            <section className="markerEditorSection">
              <h2>Start position</h2>
              <p className="markerEditorHint">
                Drag the large RGB axes in the scene to move the orbit pivot. Capture the
                opening camera view (position and zoom) separately, then save to persist.
              </p>
              <label>
                <span>Orbit pivot (start_pos)</span>
              </label>
              <div className="markerEditorCallout">
                X {formatCoordinateForInput(axisStartPos[0])} · Y{" "}
                {formatCoordinateForInput(axisStartPos[1])} · Z{" "}
                {formatCoordinateForInput(axisStartPos[2])}
              </div>
              <label>
                <span>Opening view (start_view_position)</span>
              </label>
              <div className="markerPositionGrid">
                {(["x", "y", "z"] as const).map((axis, index) => (
                  <ScrubAxisInput
                    key={axis}
                    axis={axis}
                    value={startViewPositionDrafts[index]}
                    onChange={(value) => {
                      if (!isCoordinateDraft(value)) return;
                      setStartViewPositionDrafts((prev) => {
                        const next = [...prev] as [string, string, string];
                        next[index] = value;
                        return next;
                      });
                    }}
                    onScrubValue={(value) => setStartViewPositionAxisValue(index, value)}
                    onCommit={() => commitStartViewPositionDraft(index)}
                    onScrubActiveChange={handleAxisScrubActiveChange}
                  />
                ))}
              </div>
              <button
                type="button"
                className="markerSubtleButton"
                onClick={handleSetStartViewPosition}
              >
                Capture view from camera
              </button>
            </section>
          ) : null}

          {mode === "preview" ? (
            <section className="markerEditorSection">
              <div className="markerSectionTitle">
                <h2>Markers</h2>
                <span>{markers.length}</span>
              </div>
              <p className="markerEditorHint">
                Click a marker to fly the camera and show its title and description.
              </p>
              <div className="markerList">
                {markers.length === 0 ? (
                  <p className="markerEmptyState">No markers in this scene.</p>
                ) : (
                  navigableMarkers.map((marker, index) => (
                    <button
                      key={index}
                      type="button"
                      className={selectedMarkerIndex === index ? "active" : ""}
                      onClick={() => openMarker(index)}
                    >
                      {marker.icon ? (
                        <img src={resolveAssetUrl(marker.icon)} alt="" />
                      ) : null}
                      <span>{marker.title || `Marker ${index + 1}`}</span>
                    </button>
                  ))
                )}
              </div>
            </section>
          ) : null}

          {mode === "place" ? (
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
              <select
                value={placementIconIndex}
                onChange={(e) => setPlacementIconIndex(Number(e.target.value))}
              >
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
              {placementViewPosition ? (
                <small className="markerViewCaptured">
                  View position captured from the current camera.
                </small>
              ) : null}
              <button
                type="button"
                className="markerPrimaryButton"
                onClick={placeMarkerAtCurrentPreview}
              >
                Place Marker
              </button>
            </section>
          ) : null}

          {mode === "edit" ? (
            <>
              <section className="markerEditorSection markerForm">
                <h2>Select Marker</h2>
                <select
                  value={selectedMarkerIndex ?? ""}
                  onChange={(e) => handleEditMarkerSelect(e.target.value)}
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
                <p className="markerEditorHint">
                  Drag the RGB axes on the selected marker to reposition it in the scene, or
                  edit coordinates below.
                </p>
                {!selectedMarker ? (
                  <p className="markerEmptyState">Select a marker to edit its properties.</p>
                ) : (
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
                          updateSelectedMarker((marker) => ({
                            ...marker,
                            radius: Number(e.target.value),
                          }))
                        }
                      />
                      <input
                        type="number"
                        min={0.01}
                        max={1}
                        step={0.01}
                        value={selectedMarker.radius ?? 0.25}
                        onChange={(e) =>
                          updateSelectedMarker((marker) => ({
                            ...marker,
                            radius: Number(e.target.value),
                          }))
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
                        <ScrubAxisInput
                          key={axis}
                          axis={axis}
                          value={positionDrafts[index]}
                          onChange={(value) => handlePositionDraftChange(index, value)}
                          onScrubValue={(value) => setPositionAxisValue(index, value)}
                          onCommit={() => commitPositionDraft(index)}
                          onScrubActiveChange={handleAxisScrubActiveChange}
                        />
                      ))}
                    </div>
                    <label>
                      <span>View Position (Camera)</span>
                    </label>
                    <div className="markerPositionGrid">
                      {(["x", "y", "z"] as const).map((axis, index) => (
                        <ScrubAxisInput
                          key={axis}
                          axis={axis}
                          value={viewPositionDrafts[index]}
                          onChange={(value) => {
                            if (!isCoordinateDraft(value)) return;
                            setViewPositionDrafts((prev) => {
                              const next = [...prev] as [string, string, string];
                              next[index] = value;
                              return next;
                            });
                          }}
                          onScrubValue={(value) => setViewPositionAxisValue(index, value)}
                          onCommit={() => commitViewPositionDraft(index)}
                          onScrubActiveChange={handleAxisScrubActiveChange}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className="markerSubtleButton"
                      onClick={handleSetEditViewPosition}
                    >
                      Set View Position
                    </button>
                    <button
                      type="button"
                      className="markerDangerButton"
                      onClick={handleDeleteSelectedMarker}
                    >
                      Delete Marker
                    </button>
                  </>
                )}
              </section>
            </>
          ) : null}

          {saveStatus !== "idle" ? (
            <section className="markerEditorStatus" aria-live="polite">
              {saveStatus === "success" ? (
                <span className="success">
                  {saveMessage || "Saved."}{" "}
                  {isFieldManagement ? (
                    <Link to={viewerHref}>Open public viewer</Link>
                  ) : null}
                </span>
              ) : null}
              {saveStatus === "error" ? (
                <span className="error">{saveMessage || "Failed to save."}</span>
              ) : null}
            </section>
          ) : null}
        </div>

        <footer className="markerEditorActions">
          <span>{markers.length} markers</span>
          <button
            type="button"
            onClick={handleDiscardMarkers}
            disabled={!hasUnsavedChanges || saveStatus === "saving" || !isFieldManagement}
          >
            Discard Changes
          </button>
          <button
            type="button"
            className="save"
            onClick={handleSaveMarkers}
            disabled={
              !isFieldManagement ||
              loadState.status !== "ready" ||
              !hasUnsavedChanges ||
              saveStatus === "saving"
            }
          >
            {saveStatus === "saving" ? "Saving..." : "Save Changes"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
