import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as THREE from "three";
import { fetchFieldById, type Field, type ViewerMarkerPayload } from "./fieldApi";
import { ThreeApp } from "./three/ThreeApp";
import type { SphericalHarmonicsDegree } from "./three/GaussianViewer";
import type { SceneInfo } from "./three/ScreenSpace";
import "./index.css";

// narrows to objects that have setGaussianPath
function hasSetGaussianPath(
  o: unknown
): o is { setGaussianPath: (path: string) => void | Promise<void> } {
  return !!o && typeof o === "object" && "loadGaussianScene" in o;
}

type StartPosPayload =
  | { x?: number; y?: number; z?: number }
  | [number, number, number];

export type ViewerProps = {
  gaussianPath?: string;
  markers?: ViewerMarkerPayload[];
  startPos?: unknown;
  sceneInfo?: SceneInfo;
  onBack?: () => void;
  embedded?: boolean;
};

const resolveAssetUrl = (raw: string) => {
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, window.location.origin).href;
  return new URL(`/${raw}`, window.location.origin).href;
};

const parseMarkerQueryParam = (raw: string | null): ViewerMarkerPayload[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Failed to parse marker payload", err);
    return [];
  }
};

const parseSphericalHarmonicsDegree = (
  raw: string | null
): SphericalHarmonicsDegree | null => {
  if (raw === null) return 0;
  if (raw === "0" || raw === "1" || raw === "2") {
    return Number(raw) as SphericalHarmonicsDegree;
  }
  return null;
};

const parseStartPos = (raw: unknown): [number, number, number] | null => {
  if (Array.isArray(raw) && raw.length >= 3) {
    const [x, y, z] = raw;
    if ([x, y, z].every((value) => typeof value === "number" && Number.isFinite(value))) {
      return [x, y, z];
    }
  }

  if (raw && typeof raw === "object") {
    const pos = raw as StartPosPayload;
    if (!Array.isArray(pos)) {
      const { x, y, z } = pos;
      if (
        typeof x === "number" &&
        Number.isFinite(x) &&
        typeof y === "number" &&
        Number.isFinite(y) &&
        typeof z === "number" &&
        Number.isFinite(z)
      ) {
        return [x, y, z];
      }
    }
  }

  return null;
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

const getFieldMarkers = (field: Field) => field.markers ?? field.Markers ?? [];

type ViewerLoadState =
  | {
      status: "ready";
      gaussianPath?: string;
      markers: ViewerMarkerPayload[];
      startPos?: unknown;
      sceneInfo: SceneInfo;
      sphericalHarmonicsDegree: SphericalHarmonicsDegree;
    }
  | { status: "loading" }
  | { status: "error"; title: string; message: string };

export default function Viewer({ gaussianPath, markers, startPos, sceneInfo, onBack, embedded }: ViewerProps = {}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [searchParams] = useSearchParams();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadState, setLoadState] = useState<ViewerLoadState>({ status: "loading" });

  useEffect(() => {
    const sphericalHarmonicsDegree = parseSphericalHarmonicsDegree(searchParams.get("sh"));
    if (sphericalHarmonicsDegree === null) {
      setLoadState({
        status: "error",
        title: "Invalid spherical harmonics degree",
        message: 'The "sh" query parameter must be a number in the range 0-2.',
      });
      return;
    }

    if (gaussianPath) {
      setLoadState({
        status: "ready",
        gaussianPath,
        markers: markers ?? parseMarkerQueryParam(searchParams.get("markers")),
        startPos:
          startPos ??
          (() => {
            const value = searchParams.get("startPos");
            if (!value) return undefined;
            try {
              return JSON.parse(value);
            } catch (err) {
              console.warn("Failed to parse start position payload", err);
              return undefined;
            }
          })(),
        sceneInfo: sceneInfo ?? {
          title: searchParams.get("title") ?? undefined,
          location: searchParams.get("sceneLocation") ?? searchParams.get("location") ?? undefined,
          description: searchParams.get("description") ?? undefined,
        },
        sphericalHarmonicsDegree,
      });
      return;
    }

    const fieldId = searchParams.get("m")?.trim();
    if (!fieldId) {
      setLoadState({
        status: "error",
        title: "Missing field id",
        message: "Expected URL format: /viewer/?m={FieldID}",
      });
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    (async () => {
      try {
        const field = await fetchFieldById(fieldId);
        if (cancelled) return;

        if (!field) {
          setLoadState({
            status: "error",
            title: "Field not found",
            message: `No field exists for FieldID "${fieldId}".`,
          });
          return;
        }

        if (!field.File?.trim()) {
          console.error("[Viewer] field is missing File/splat path", field);
          setLoadState({
            status: "error",
            title: "Missing splat file",
            message: `Field "${field.FieldID}" does not have a Gaussian splat file configured.`,
          });
          return;
        }

        setLoadState({
          status: "ready",
          gaussianPath: field.File,
          markers: getFieldMarkers(field),
          startPos: field.start_pos,
          sceneInfo: getFieldSceneInfo(field),
          sphericalHarmonicsDegree,
        });
      } catch (err) {
        if (cancelled) return;
        console.error("[Viewer] failed to load field", err);
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
  }, [gaussianPath, markers, sceneInfo, searchParams, startPos]);

  useEffect(() => {
    if (!wrapRef.current || loadState.status !== "ready") return;
    const app = new ThreeApp(wrapRef.current, {
      onBack,
      sceneInfo: loadState.sceneInfo,
      sphericalHarmonicsDegree: loadState.sphericalHarmonicsDegree,
    });
    const parsedStartPos = parseStartPos(loadState.startPos);
    console.log("[Viewer start_pos debug] resolved viewer start position", {
      gaussianPath: loadState.gaussianPath,
      startPosParam: loadState.startPos,
      parsedStartPos,
      markersCount: loadState.markers.length,
    });

    app.setWorldAxesPosition(parsedStartPos ?? [0, 0, 0]);
    app.setWorldAxesVisible(false);

    if (loadState.gaussianPath && hasSetGaussianPath(app)) {
      // resolve: support /assets from public, absolute urls, and relative fallbacks
      const resolved = loadState.gaussianPath.startsWith("/")
        ? new URL(loadState.gaussianPath, window.location.origin).href
        : /^(https?:|blob:|data:)/i.test(loadState.gaussianPath)
        ? loadState.gaussianPath
        : new URL(loadState.gaussianPath, window.location.href).href;

      app.loadGaussianScene(resolved);
    }

    if (loadState.markers.length > 0) {
      const loader = new THREE.TextureLoader();
      const textureCache = new Map<string, THREE.Texture>();

      const toTexture = (icon?: string) => {
        if (!icon) return undefined;
        const resolved = resolveAssetUrl(icon);
        const cached = textureCache.get(resolved);
        if (cached) return cached;
        const texture = loader.load(resolved);
        textureCache.set(resolved, texture);
        return texture;
      };

      const worldMarkers = loadState.markers
        .map((marker) => {
          const pos = marker.position;
          const x = pos?.x;
          const y = pos?.y;
          const z = pos?.z;
          if (![x, y, z].every((v) => typeof v === "number" && Number.isFinite(v))) {
            return null;
          }
          const radius =
            typeof marker.scale === "number" && Number.isFinite(marker.scale)
              ? marker.scale
              : undefined;
          return {
            position: [x, y, z] as [number, number, number],
            radius,
            texture: toTexture(marker.icon),
            label: typeof marker.text === "string" ? marker.text : "",
          };
        })
        .filter(Boolean) as Array<{
          position: [number, number, number];
          radius?: number;
          texture?: THREE.Texture;
          label?: string;
        }>;

      app.setWorldMarkers(worldMarkers);
    }

    return () => app.dispose();
  }, [loadState, onBack]);

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
  };

  const fullscreenButtonStyle: React.CSSProperties = {
    ...controlButtonStyle,
    width: "40px",
    height: "40px",
    padding: 0,
    justifyContent: "center",
  };

  if (loadState.status === "loading") {
    return (
      <div className="viewerStatusShell">
        <div className="viewerStatusCard">
          <h1>Loading field...</h1>
          <p>Fetching the field record and preparing the viewer.</p>
        </div>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="viewerStatusShell">
        <div className="viewerStatusCard" role="alert">
          <h1>{loadState.title}</h1>
          <p>{loadState.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`threeWrap ${embedded ? "threeWrapEmbedded" : ""}`} ref={wrapRef}>
      <div
        className="viewerDesktopControls"
        style={{
          position: "absolute",
          top: "1rem",
          right: "1rem",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "0.55rem",
        }}
      >
        <button
          onClick={toggleFullscreen}
          style={fullscreenButtonStyle}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(236, 236, 240, 0.96)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(228, 228, 232, 0.92)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          {isFullscreen ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 2H2V6M10 2H14V6M2 10V14H6M14 10V14H10"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
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

        {onBack && (
          <button
            onClick={onBack}
            style={controlButtonStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(236, 236, 240, 0.96)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(228, 228, 232, 0.92)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10 12L6 8L10 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back to Map
          </button>
        )}
      </div>
    </div>
  );
}
