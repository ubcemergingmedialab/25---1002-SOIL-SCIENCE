import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getFieldById, getFields } from "./publicApi";
import {
  createPlayCanvasApp,
  normalizeSplatUrl,
  parseOrientation,
} from "@soil/playcanvas-viewer";

export default function PlayCanvasSmoke() {
  const [searchParams, setSearchParams] = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("Initializing…");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<{ FieldID: string; Name: string }[]>([]);

  const fieldId = searchParams.get("m") ?? "";
  const directUrl = searchParams.get("url") ?? "";
  const orientation = parseOrientation(searchParams);

  useEffect(() => {
    let cancelled = false;
    getFields()
      .then((items) => {
        if (cancelled) return;
        setFields(
          items.map((f) => ({ FieldID: f.FieldID, Name: f.Name || f.FieldID })),
        );
      })
      .catch(() => {
        if (!cancelled) setFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let app: { destroy: () => void } | null = null;
    let cancelled = false;

    (async () => {
      setError("");
      try {
        let splatUrl = normalizeSplatUrl(directUrl);
        let label = splatUrl;

        if (!splatUrl) {
          if (!fieldId.trim()) {
            setStatus("Select a field or pass ?url=…");
            return;
          }
          setStatus(`Loading field ${fieldId}…`);
          const field = await getFieldById(fieldId.trim());
          if (!field) throw new Error(`Field not found: ${fieldId}`);
          splatUrl = field.FilePlayCanvas?.trim() ?? "";
          if (!splatUrl) {
            throw new Error(
              `Field ${fieldId} has no FilePlayCanvas (format: ${field.FileFormat ?? "unknown"})`,
            );
          }
          label = `${field.Name} (${field.FileFormat ?? "playcanvas"})`;
        }

        if (cancelled) return;
        setStatus(`Loading splat: ${label}`);

        app = await createPlayCanvasApp({
          canvas,
          splatUrl,
          orientationX: orientation.x,
          orientationY: orientation.y,
          orientationZ: orientation.z,
        });

        if (cancelled) {
          app.destroy();
          return;
        }
        setStatus(`Loaded — ${label}`);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(String(e));
          setStatus("Failed to load");
        }
      }
    })();

    return () => {
      cancelled = true;
      app?.destroy();
    };
  }, [fieldId, directUrl, orientation.x, orientation.y, orientation.z]);

  function onFieldChange(nextId: string) {
    const next = new URLSearchParams(searchParams);
    if (nextId) next.set("m", nextId);
    else next.delete("m");
    next.delete("url");
    setSearchParams(next, { replace: true });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0a0a0a", color: "#eee" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
      />

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: 12,
          maxWidth: 420,
          padding: "10px 12px",
          background: "rgba(0,0,0,0.72)",
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.45,
          pointerEvents: "auto",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6 }}>PlayCanvas dev harness</div>
        <label style={{ display: "block", marginBottom: 8 }}>
          Field (from API `FilePlayCanvas`)
          <select
            value={fieldId}
            onChange={(e) => onFieldChange(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          >
            <option value="">— select —</option>
            {fields.map((f) => (
              <option key={f.FieldID} value={f.FieldID}>
                {f.Name} ({f.FieldID})
              </option>
            ))}
          </select>
        </label>
        <div style={{ opacity: 0.85, marginBottom: 4 }}>{status}</div>
        {error ? (
          <div style={{ color: "#f87171", whiteSpace: "pre-wrap" }}>{error}</div>
        ) : null}
        <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
          Or: <code>{"?url=/work-out/{basename}/lod-meta.json"}</code> (local dev)
          {" · "}
          <code>?url=https://…/lod-meta.json</code>
          {" · "}
          <code>?orientationX=0</code> to disable default 180° X flip
          {" · "}
          <code>?orientationY=</code> / <code>orientationZ=</code> for other axes
          {" · "}
          <a href="/viewer/" style={{ color: "#93c5fd" }}>
            production viewer
          </a>
        </div>
      </div>
    </div>
  );
}
