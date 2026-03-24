import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import * as THREE from "three";
import { ThreeApp } from "./three/ThreeApp";
import "./index.css";

// narrows to objects that have setGaussianPath
function hasSetGaussianPath(
  o: unknown
): o is { setGaussianPath: (path: string) => void | Promise<void> } {
  return !!o && typeof o === "object" && "loadGaussianScene" in o;
}

type MarkerPayload = {
  icon?: string;
  scale?: number;
  position?: { x?: number; y?: number; z?: number };
  text?: string;
};

type StartPosPayload =
  | { x?: number; y?: number; z?: number }
  | [number, number, number];

export type ViewerProps = {
  gaussianPath?: string;
  markers?: Array<Record<string, unknown>>;
  startPos?: unknown;
  onBack?: () => void;
  embedded?: boolean;
};

const resolveAssetUrl = (raw: string) => {
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, window.location.origin).href;
  return new URL(`/${raw}`, window.location.origin).href;
};

const parseMarkers = (raw: string | null): MarkerPayload[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Failed to parse marker payload", err);
    return [];
  }
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

export default function Viewer({ gaussianPath, markers, startPos, onBack, embedded }: ViewerProps = {}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!wrapRef.current) return;
    const app = new ThreeApp(wrapRef.current);

    // Use props if provided, otherwise fall back to query params
    const params = new URLSearchParams(location.search);
    const raw = gaussianPath || params.get("gaussianPath");
    const markerParam = markers ? JSON.stringify(markers) : params.get("markers");
    const startPosParam = startPos ?? (() => {
      const value = params.get("startPos");
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch (err) {
        console.warn("Failed to parse start position payload", err);
        return null;
      }
    })();
    const parsedStartPos = parseStartPos(startPosParam);
    console.log("[Viewer start_pos debug] resolved viewer start position", {
      gaussianPath: raw,
      startPosProp: startPos,
      startPosParam,
      parsedStartPos,
      markersCount: Array.isArray(markers) ? markers.length : markerParam ? parseMarkers(markerParam).length : 0,
    });

    app.setWorldAxesPosition(parsedStartPos ?? [0, 0, 0]);
    app.setWorldAxesVisible(false);

    if (raw && hasSetGaussianPath(app)) {
      // resolve: support /assets from public, absolute urls, and relative fallbacks
      const resolved = raw.startsWith("/")
        ? new URL(raw, window.location.origin).href
        : /^(https?:|blob:|data:)/i.test(raw)
        ? raw
        : new URL(raw, window.location.href).href;

      app.loadGaussianScene(resolved);
    }

    if (markerParam !== null) {
      const markerPayloads = parseMarkers(markerParam);
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

      const worldMarkers = markerPayloads
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
  }, [location.search, gaussianPath, markers, startPos]);

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

  return (
    <div className={`threeWrap ${embedded ? "threeWrapEmbedded" : ""}`} ref={wrapRef}>
      <div
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
