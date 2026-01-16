import "./index.css";
import UBCMap from "./UBCMap";

export default function App() {
  const openViewer = (path?: string, markers?: Array<Record<string, unknown>>) => {
    if (!path) return;
    const url = new URL("/viewer", window.location.href);
    url.searchParams.set("gaussianPath", path);
    if (markers && markers.length > 0) {
      url.searchParams.set("markers", JSON.stringify(markers));
    }
    window.open(url.href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="app" style={{ minHeight: "100dvh" }}>
      <section style={{ display: "grid", placeItems: "center", padding: "3rem 1rem" }}>
        <div style={{ textAlign: "center", maxWidth: 520 }}>
          <h1 style={{ marginBottom: "1rem" }}>Virtual Soils</h1>
          <p style={{ margin: 0, lineHeight: 1.6, color: "#9aa4b5" }}>
            Browse the map below and select a field pin to launch its interactive 3D capture in
            a new tab.
          </p>
        </div>
      </section>

      <section style={{ padding: "0 1rem 2rem" }}>
        <UBCMap openViewer={openViewer} />
      </section>
    </div>
  );
}
