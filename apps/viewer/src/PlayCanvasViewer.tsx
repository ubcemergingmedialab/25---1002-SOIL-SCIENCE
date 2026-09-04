import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Field } from "./publicApi";
import { getFieldById } from "./publicApi";
import {
  createPlayCanvasApp,
  getDefaultPerformancePreset,
  normalizeSplatUrl,
  parseFullSplatMode,
  parseOrientation,
  parseGroundClampEnabled,
  parseGroundOccluder,
  parseFlyZoomEnabled,
  parseAlphaClipForwardOverride,
  parseHeightmapDebug,
  parseCoordReadout,
  parseSkyboxMode,
  parseSplatBudgetOverrideM,
  parseSplatLodLock,
  PLAYCANVAS_PERF_PRESET_LABELS,
  resolveFullSplatPlayCanvasUrl,
  type PlayCanvasApp,
} from "@soil/playcanvas-viewer";
import { getFieldLegacySplatUrl } from "@soil/shared/utils/splatUrls";
import type { NavigableMarker } from "@soil/shared/markers/navigableMarkers";
import { getNavigableMarkersFromField } from "@soil/shared/markers/navigableMarkers";
import {
  DEFAULT_START_POS,
  deriveStartViewPosition,
  parseStartPos,
  parseStartViewPosition,
} from "@soil/shared/utils/startPos";
import type { ControlMode, PerformancePreset, SceneInfo } from "@soil/shared/three/ScreenSpace";
import "@soil/shared/styles.css";
import PlayCanvasMobileChrome from "./PlayCanvasMobileChrome";
import PlayCanvasLoadingOverlay from "./PlayCanvasLoadingOverlay";

type LoadState =
  | { status: "loading"; message: string }
  | { status: "error"; title: string; message: string }
  | {
      status: "ready";
      splatUrl: string;
      fullSplatMode: boolean;
      fullSplatSource?: string;
      sceneInfo: SceneInfo;
      orientationX: number;
      orientationY: number;
      orientationZ: number;
      startPos: [number, number, number];
      startViewPosition: [number, number, number];
      markers: NavigableMarker[];
    };

const parseStartPosQueryParam = (raw: string | null): [number, number, number] | null => {
  if (!raw) return null;
  try {
    return parseStartPos(JSON.parse(raw));
  } catch (err) {
    console.warn("[PlayCanvasViewer] failed to parse startPos query param", err);
    return null;
  }
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

const resolveAssetUrl = (raw: string) => {
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, window.location.origin).href;
  return new URL(`/${raw}`, window.location.origin).href;
};

const controlButtonStyle: React.CSSProperties = {
  padding: "0.58rem 0.9rem",
  borderRadius: "6px",
  border: "1px solid rgba(0, 0, 0, 0.14)",
  cursor: "pointer",
  background: "rgba(228, 228, 232, 0.92)",
  backdropFilter: "blur(6px)",
  color: "#1f1f1f",
  fontSize: "0.9rem",
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  transition: "background 0.2s, transform 0.15s",
  boxShadow: "0 3px 10px rgba(0, 0, 0, 0.2)",
  textDecoration: "none",
};

const fullscreenButtonStyle: React.CSSProperties = {
  ...controlButtonStyle,
  width: "40px",
  height: "40px",
  padding: 0,
  justifyContent: "center",
};

export default function PlayCanvasViewer() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playCanvasAppRef = useRef<PlayCanvasApp | null>(null);
  const [searchParams] = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusedMarkerIndex, setFocusedMarkerIndex] = useState<number | null>(null);
  const [isMobileMarkerListOpen, setIsMobileMarkerListOpen] = useState(false);
  const [controlMode, setControlMode] = useState<ControlMode>("orbit");
  const controlModeRef = useRef<ControlMode>("orbit");
  const [performancePreset, setPerformancePreset] = useState<PerformancePreset>(
    () => getDefaultPerformancePreset(),
  );
  const performancePresetRef = useRef<PerformancePreset>(getDefaultPerformancePreset());
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
    message: "Preparing viewer…",
  });
  const [splatLoading, setSplatLoading] = useState(false);
  const [overlayHint, setOverlayHint] = useState("Preparing scene...");
  const [overlayProgress, setOverlayProgress] = useState<number | null>(0);

  const fieldId = searchParams.get("m")?.trim() ?? "";
  const directUrl = searchParams.get("url")?.trim() ?? "";
  const fullSplatMode = parseFullSplatMode(searchParams);
  const orientation = parseOrientation(searchParams);
  const skyboxMode = parseSkyboxMode(searchParams);
  const splatBudgetOverrideM = parseSplatBudgetOverrideM(searchParams);
  const lockLodLevel = parseSplatLodLock(searchParams);
  const heightmapDebug = parseHeightmapDebug(searchParams);
  const groundOccluder = parseGroundOccluder(searchParams);
  const alphaClipForwardOverride = parseAlphaClipForwardOverride(searchParams);
  const coordReadout = parseCoordReadout(searchParams);
  const flyZoom = parseFlyZoomEnabled(searchParams);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const resolveSplat = async (legacyUrl: string) => {
        if (!fullSplatMode) {
          return { url: normalizeSplatUrl(legacyUrl), fullSplatSource: undefined as string | undefined };
        }
        const resolved = await resolveFullSplatPlayCanvasUrl(legacyUrl);
        if (!resolved.ok) {
          throw new Error(resolved.message);
        }
        return { url: normalizeSplatUrl(resolved.url), fullSplatSource: resolved.source };
      };

      if (directUrl) {
        const startPos =
          parseStartPosQueryParam(searchParams.get("startPos")) ?? DEFAULT_START_POS;
        try {
          const { url, fullSplatSource } = await resolveSplat(directUrl);
          setLoadState({
            status: "ready",
            splatUrl: url,
            fullSplatMode,
            fullSplatSource,
            sceneInfo: {
              title: searchParams.get("title") ?? "Local splat",
              location: searchParams.get("location") ?? undefined,
            },
            orientationX: orientation.x,
            orientationY: orientation.y,
            orientationZ: orientation.z,
            startPos,
            startViewPosition: deriveStartViewPosition(startPos),
            markers: [],
          });
        } catch (err) {
          if (cancelled) return;
          setLoadState({
            status: "error",
            title: fullSplatMode ? "Full splat load failed" : "Failed to load URL",
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (!fieldId) {
        setLoadState({
          status: "error",
          title: "Missing field id",
          message: "Expected URL format: /viewer/?m={FieldID}",
        });
        return;
      }

      setLoadState({
        status: "loading",
        message: `Loading field ${fieldId}…`,
      });

      try {
        const field = await getFieldById(fieldId);
        if (cancelled) return;

        if (!field) {
          setLoadState({
            status: "error",
            title: "Field not found",
            message: `No field exists for FieldID "${fieldId}".`,
          });
          return;
        }

        const splatUrl = fullSplatMode
          ? getFieldLegacySplatUrl(field)
          : field.FilePlayCanvas?.trim() ?? "";
        if (!splatUrl) {
          setLoadState({
            status: "error",
            title: fullSplatMode ? "Missing legacy splat" : "Missing PlayCanvas splat",
            message: fullSplatMode
              ? `Field "${field.FieldID}" has no File URL (.ksplat/.splat/.ply).`
              : `Field "${field.FieldID}" has no FilePlayCanvas URL configured.`,
          });
          return;
        }

        const { url: resolvedUrl, fullSplatSource } = await resolveSplat(splatUrl);

        const startPos =
          parseStartPosQueryParam(searchParams.get("startPos")) ??
          parseStartPos(field.start_pos) ??
          DEFAULT_START_POS;
        const startViewPosition =
          parseStartViewPosition(field.start_view_position) ??
          deriveStartViewPosition(startPos);

        setLoadState({
          status: "ready",
          splatUrl: resolvedUrl,
          fullSplatMode,
          fullSplatSource,
          sceneInfo: getFieldSceneInfo(field),
          orientationX: orientation.x,
          orientationY: orientation.y,
          orientationZ: orientation.z,
          startPos,
          startViewPosition,
          markers: getNavigableMarkersFromField(field),
        });
      } catch (err) {
        if (cancelled) return;
        console.error("[PlayCanvasViewer] failed to load field", err);
        setLoadState({
          status: "error",
          title: fullSplatMode ? "Full splat load failed" : "Failed to load field",
          message:
            err instanceof Error
              ? err.message
              : "The field record could not be loaded. Check the FieldID and try again.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [directUrl, fieldId, fullSplatMode, orientation.x, orientation.y, orientation.z, searchParams.get("title"), searchParams.get("location")]);

  controlModeRef.current = controlMode;
  performancePresetRef.current = performancePreset;

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
          startPos: loadState.startPos,
          startViewPosition: loadState.startViewPosition,
          markers: loadState.markers,
          markerOverlayParent: overlayParent,
          defaultControlMode: controlModeRef.current,
          performancePreset: performancePresetRef.current,
          ...(splatBudgetOverrideM !== undefined
            ? { splatBudgetM: splatBudgetOverrideM }
            : {}),
          ...(lockLodLevel !== undefined ? { lockLodLevel } : {}),
          skyboxMode,
          groundClamp: {
            enabled: loadState.fullSplatMode
              ? ["1", "true", "yes"].includes(
                  searchParams.get("groundClamp")?.trim().toLowerCase() ?? "",
                )
              : parseGroundClampEnabled(searchParams),
          },
          heightmapDebug: {
            enabled: heightmapDebug.enabled,
            mode: heightmapDebug.mode,
            opacity: heightmapDebug.opacity,
          },
          groundOccluder: {
            enabled: groundOccluder.enabled,
            yOffset: groundOccluder.yOffset,
          },
          coordReadout,
          flyZoom,
          ...(alphaClipForwardOverride !== undefined
            ? { alphaClipForward: alphaClipForwardOverride }
            : {}),
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
        app.setPerformancePreset(performancePresetRef.current);
        setSplatLoading(false);
      } catch (err) {
        if (!cancelled) {
          setSplatLoading(false);
          console.error("[PlayCanvasViewer] splat load failed", err);
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
  }, [
    loadState,
    splatBudgetOverrideM,
    lockLodLevel,
    skyboxMode,
    heightmapDebug.enabled,
    heightmapDebug.mode,
    heightmapDebug.opacity,
    groundOccluder.enabled,
    groundOccluder.yOffset,
    alphaClipForwardOverride,
    coordReadout,
    flyZoom,
  ]);

  function handlePerformancePresetChange(preset: PerformancePreset) {
    setPerformancePreset(preset);
    playCanvasAppRef.current?.setPerformancePreset(preset);
  }

  function handleControlModeChange(mode: ControlMode) {
    setControlMode(mode);
    playCanvasAppRef.current?.setControlMode(mode);
  }

  function handleMobileReset() {
    playCanvasAppRef.current?.resetCamera();
  }

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === wrapRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === wrapRef.current) {
        await document.exitFullscreen();
        return;
      }
      if (wrapRef.current) {
        await wrapRef.current.requestFullscreen();
      }
    } catch (err) {
      console.warn("Failed to toggle fullscreen", err);
    }
  };

  const moveToMarker = (index: number) => {
    setFocusedMarkerIndex(index);
    playCanvasAppRef.current?.flyToMarker(index);
    setIsMobileMarkerListOpen(false);
  };

  if (loadState.status === "loading") {
    return (
      <div className="playCanvasLoadingShell">
        <PlayCanvasLoadingOverlay hint={loadState.message} progress={null} />
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="viewerStatusShell">
        <div className="viewerStatusCard" role="alert">
          <h1>{loadState.title}</h1>
          <p>{loadState.message}</p>
          {fieldId ? (
            <p className="viewerInstructionExample" style={{ marginTop: "1rem" }}>
              <Link to={`/viewer/?m=${encodeURIComponent(fieldId)}&renderer=legacy`}>
                Open legacy viewer
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const { sceneInfo, markers } = loadState;
  const legacyHref = fieldId
    ? `/viewer/?m=${encodeURIComponent(fieldId)}&renderer=legacy`
    : "/viewer/?renderer=legacy";

  const markerList = (
    <>
      <h2>Markers</h2>
      <div className="viewerMarkerList">
        {markers.map((marker, index) => (
          <button
            key={index}
            type="button"
            className={focusedMarkerIndex === index ? "active" : ""}
            onClick={() => moveToMarker(index)}
          >
            {marker.icon ? <img src={resolveAssetUrl(marker.icon)} alt="" /> : null}
            <span>{marker.title || `Marker ${index + 1}`}</span>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="playCanvasWrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="playCanvasSurface"
        aria-label={sceneInfo.title ?? "Gaussian splat scene"}
      />

      {splatLoading ? (
        <PlayCanvasLoadingOverlay hint={overlayHint} progress={overlayProgress} />
      ) : null}

      {markers.length > 0 ? (
        <aside className="viewerMarkerSidebar playCanvasMarkerSidebar" aria-label="Scene markers">
          {markerList}
        </aside>
      ) : null}

      {markers.length > 0 ? (
        <>
          <aside
            id="playcanvas-mobile-marker-sidebar"
            className={`viewerMarkerSidebar viewerMarkerSidebarMobile ${
              isMobileMarkerListOpen ? "isOpen" : ""
            }`}
            aria-label="Scene markers"
            aria-hidden={!isMobileMarkerListOpen}
          >
            {markerList}
          </aside>
          <button
            type="button"
            className={`viewerMarkerSidebarToggle ${isMobileMarkerListOpen ? "isOpen" : ""}`}
            aria-controls="playcanvas-mobile-marker-sidebar"
            aria-expanded={isMobileMarkerListOpen}
            aria-label={isMobileMarkerListOpen ? "Close markers list" : "Open markers list"}
            onClick={() => setIsMobileMarkerListOpen((open) => !open)}
          >
            <span>Markers</span>
            {isMobileMarkerListOpen ? "\u2039" : "\u203a"}
          </button>
        </>
      ) : null}

      <PlayCanvasMobileChrome
        sceneInfo={sceneInfo}
        performancePreset={performancePreset}
        onPerformancePresetChange={handlePerformancePresetChange}
        onReset={handleMobileReset}
      />

      <header className="playCanvasHeader playCanvasHeaderDesktop" aria-label="Scene information">
        <div className="playCanvasHeaderText">
          <h1>{sceneInfo.title ?? "Untitled field"}</h1>
          {sceneInfo.location ? <p>{sceneInfo.location}</p> : null}
        </div>
      </header>

      <div className="playCanvasControls">
        <div className="playCanvasControlMode" role="group" aria-label="Camera control mode">
          <span className="playCanvasControlModeLabel">Controls</span>
          <button
            type="button"
            className={`playCanvasControlModeBtn${controlMode === "fly" ? " isActive" : ""}`}
            aria-pressed={controlMode === "fly"}
            title="WASD move, drag to look, scroll wheel to zoom (FOV)"
            onClick={() => handleControlModeChange("fly")}
          >
            Fly
          </button>
          <button
            type="button"
            className={`playCanvasControlModeBtn${controlMode === "orbit" ? " isActive" : ""}`}
            aria-pressed={controlMode === "orbit"}
            title="Drag to orbit, right-drag to pan, wheel to dolly zoom"
            onClick={() => handleControlModeChange("orbit")}
          >
            Orbit
          </button>
        </div>

        <div className="playCanvasPerfControl">
          <label className="playCanvasPerfLabel" htmlFor="playcanvas-perf-preset">
            Quality
          </label>
          <select
            id="playcanvas-perf-preset"
            className="playCanvasPerfSelect"
            value={performancePreset}
            onChange={(e) => handlePerformancePresetChange(e.target.value as PerformancePreset)}
          >
            {(Object.keys(PLAYCANVAS_PERF_PRESET_LABELS) as PerformancePreset[]).map((key) => (
              <option key={key} value={key}>
                {PLAYCANVAS_PERF_PRESET_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          style={fullscreenButtonStyle}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {isFullscreen ? (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6 2H2V6M10 2H14V6M2 10V14H6M14 10V14H10"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M5 2H2V5M11 2H14V5M2 11V14H5M14 11V14H11"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <Link to="/" style={controlButtonStyle}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M10 12L6 8L10 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Home
        </Link>

        <Link to={legacyHref} style={controlButtonStyle}>
          Legacy viewer
        </Link>
      </div>
    </div>
  );
}
