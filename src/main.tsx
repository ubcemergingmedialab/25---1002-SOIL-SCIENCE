// src/main.tsx
import "leaflet/dist/leaflet.css";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import Viewer from "./Viewer";
import Editor from "./Editor";
import "./auth";
import Admin from "./Admin";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/viewer" element={<Viewer />} />
      <Route path="/editor" element={<Editor />} />
      <Route path="/admin" element={<Admin />} />
    </Routes>
  </BrowserRouter>
);
