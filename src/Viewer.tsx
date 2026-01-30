import { useEffect, useRef } from "react";
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

export type ViewerProps = {
  gaussianPath?: string;
  markers?: Array<Record<string, unknown>>;
  onBack?: () => void;
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

export default function Viewer({ gaussianPath, markers, onBack }: ViewerProps = {}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    if (!wrapRef.current) return;
    const app = new ThreeApp(wrapRef.current);

    // Use props if provided, otherwise fall back to query params
    const params = new URLSearchParams(location.search);
    const raw = gaussianPath || params.get("gaussianPath");
    const markerParam = markers ? JSON.stringify(markers) : params.get("markers");

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
  }, [location.search]);

  return (
    <div className="threeWrap" ref={wrapRef}>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            position: "absolute",
            top: "1rem",
            right: "1rem",
            zIndex: 100,
            padding: "0.6rem 1.25rem",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            background: "rgba(26, 31, 46, 0.9)",
            backdropFilter: "blur(8px)",
            color: "#e6edf3",
            fontSize: "0.9rem",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            transition: "background 0.2s, transform 0.15s",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(26, 31, 46, 1)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(26, 31, 46, 0.9)";
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
  );
}
