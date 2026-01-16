import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import * as THREE from "three";
import { ThreeApp } from "./three/ThreeApp";
import "./index.css";

// narrows to objects that have setGaussianPath
function hasSetGaussianPath(
  o: unknown
): o is { setGaussianPath: (path: string) => void | Promise<void> } {
  return !!o && typeof o === "object" && "setGaussianPath" in o;
}

type MarkerPayload = {
  icon?: string;
  scale?: number;
  position?: { x?: number; y?: number; z?: number };
  text?: string;
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

export default function Viewer() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    if (!wrapRef.current) return;
    const app = new ThreeApp(wrapRef.current);

    // read gaussianPath from query and load
    const params = new URLSearchParams(location.search);
    const raw = params.get("gaussianPath");
    const markerParam = params.get("markers");

    if (raw && hasSetGaussianPath(app)) {
      // resolve: support /assets from public, absolute urls, and relative fallbacks
      const resolved = raw.startsWith("/")
        ? new URL(raw, window.location.origin).href
        : /^(https?:|blob:|data:)/i.test(raw)
        ? raw
        : new URL(raw, window.location.href).href;

      app.setGaussianPath(resolved);
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

  return <div className="threeWrap" ref={wrapRef} />;
}
