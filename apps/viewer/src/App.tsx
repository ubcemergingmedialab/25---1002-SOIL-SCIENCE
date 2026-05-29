import "@soil/shared/styles.css";

export default function App() {
  return (
    <main className="viewerInstructionShell">
      <section className="viewerInstructionCard">
        <h1>Virtual Soil Viewer</h1>
        <p>Open a field directly with a shareable viewer URL.</p>
        <code>/viewer/?m={"{"}FieldID{"}"}</code>
        <p className="viewerInstructionExample">
          Example: <a href="/viewer/?m=UBC_Farm_Agricultural">/viewer/?m=UBC_Farm_Agricultural</a>
        </p>
      </section>
    </main>
  );
}
