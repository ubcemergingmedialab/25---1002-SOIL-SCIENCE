import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ThreeApp } from "./three/ThreeApp";
import "./index.css";

// narrows to objects that have setGaussianPath
function hasSetGaussianPath(
  o: unknown
): o is { setGaussianPath: (path: string) => void | Promise<void> } {
  return !!o && typeof o === "object" && "setGaussianPath" in o;
}

export default function Viewer() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    if (!wrapRef.current) return;
    const app = new ThreeApp(wrapRef.current);

    // read gaussianPath from query and load
    const params = new URLSearchParams(location.search);
    const raw = params.get("gaussianPath");

    if (raw && hasSetGaussianPath(app)) {
      // resolve: support /assets from public, absolute urls, and relative fallbacks
      const resolved = raw.startsWith("/")
        ? new URL(raw, window.location.origin).href
        : /^(https?:|blob:|data:)/i.test(raw)
        ? raw
        : new URL(raw, window.location.href).href;

      app.setGaussianPath(resolved);
    }

    return () => app.dispose();
  }, [location.search]);

  return <div className="threeWrap" ref={wrapRef} />;
}
