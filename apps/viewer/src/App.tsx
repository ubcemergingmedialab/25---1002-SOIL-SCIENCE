import { Navigate, useSearchParams } from "react-router-dom";
import "@soil/shared/styles.css";

export default function App() {
  const [searchParams] = useSearchParams();
  const fieldId = searchParams.get("m")?.trim();

  // Allow share links like /?m=AW2 — canonical viewer route is /viewer/?m=…
  if (fieldId) {
    return <Navigate to={`/viewer/?${searchParams.toString()}`} replace />;
  }

  return (
    <main className="viewerInstructionShell">
      <section className="viewerInstructionCard">
        <h1>Virtual Soil Viewer</h1>
        <p>Open a field directly with a shareable viewer URL.</p>
        <code>/viewer/?m={"{"}FieldID{"}"}</code>
        <p className="viewerInstructionExample">
          Example: <a href="/viewer/?m=AW2">/viewer/?m=AW2</a>
          {" "}
          (also works as <a href="/?m=AW2">/?m=AW2</a>)
        </p>
      </section>
    </main>
  );
}
