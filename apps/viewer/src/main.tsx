import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import App from "./App";
import Viewer from "./Viewer";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/viewer/*" element={<Viewer />} />
      <Route path="*" element={<Navigate to="/viewer/" replace />} />
    </Routes>
  </BrowserRouter>
);
