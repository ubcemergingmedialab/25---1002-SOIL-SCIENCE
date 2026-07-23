# Virtual Soils – Project Documentation

## Overview

**Virtual Soils** is a web application for exploring 3D Gaussian splat (radiance field) reconstructions of soil and landscape sites. Users browse locations on an **interactive map** (Leaflet + OpenStreetMap), then open an embedded **3D viewer** for a chosen site. The project includes an **About** section with project copy, an **admin** area for managing locations, and an **editor** for placing and editing in-scene markers.

The viewer instruction shell title in the UI is **Virtual Soil Viewer**.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite 7 |
| Routing | React Router v7 |
| 3D / Splats | Three.js, `@mkkellogg/gaussian-splats-3d` |
| Map | **Leaflet** with **OpenStreetMap** tiles (no Google Maps API or API key) |
| Auth | AWS Amplify (Cognito OAuth) |
| API / Data | AWS (API Gateway, Lambda, DynamoDB), `aws4fetch` for signed requests |

For implementation notes on the map migration, see `docs/MIGRATION-GOOGLE-MAPS-TO-LEAFLET.md`.

---

## Application Structure

### Routes

| Path | Component | Purpose |
|------|-----------|---------|
| `/` | `App` | Home: **Map** tab (`UBCMap`) or **Info** tab (long-form About content); 3D viewer opens **inline** over the map when a location is chosen |
| `/viewer` | `Viewer` | Standalone 3D viewer (e.g. direct URL with `gaussianPath` and optional `markers`) |
| `/editor` | `Editor` | Marker editor: place, edit, delete markers in a splat scene; choose scene from pins |
| `/admin` | `Admin` | Authenticated CRUD for “fields” (locations); Cognito-gated |

### High-Level Data Flow

1. **Map (home, Map tab)**  
   - Loads **pins** from `GET ${VITE_API_URL}/pins` (AWS-signed via `awsClient`).  
   - Each pin: `title`, `position` (lat/lng), `path` (splat URL), `description`, `thumbnail`, `thumbnailAlt`, `markers`.  
   - The map loads **on demand** (“Click to load map”). Pins appear as Leaflet markers; popups show thumbnail, title, coordinates, and **→ Enter** to open the viewer.  
   - Choosing **→ Enter** opens the **Viewer** embedded in the map pane with that `path` and `markers`.

2. **Viewer**  
   - Renders a single Gaussian splat scene in a **ThreeApp** canvas.  
   - Can be driven by props (`gaussianPath`, `markers`) or by URL query (`gaussianPath`, `markers`).  
   - Optional world-space markers (icons + labels) are rendered by **WorldMarkers** and can be clicked to show labels.

3. **Editor**  
   - Uses the same **ThreeApp** plus Editor-only UI (scene selector, place/edit/delete markers).  
   - Loads pins from the same `/pins` endpoint; selecting a pin loads that scene and its markers.  
   - Marker edits are local state only (no save to backend in current flow; Admin is the source of truth for stored markers).

4. **Admin**  
   - Uses **adminApi** (Cognito token) to call `/admin/api/fields` for list/create/update/delete.  
   - Manages “fields” (backend entity) with FieldID, Name, Description, File, Lat/Lng, Thumbnail, and **markers** (array of icon, scale, position, text).  
   - Backend stores fields in DynamoDB; the public **pins** API is a separate contract that maps fields → pin shape (see `lambda-handler.mjs`).

---

## Key Directories and Files

### Frontend (React)

- **`src/main.tsx`** – Router setup; global `import "leaflet/dist/leaflet.css"`; mounts `App`, `Viewer`, `Editor`, `Admin`; loads `./auth`.
- **`src/App.tsx`** – Shell: **icon rail** (collapse sidebar, Info, Map), title **Virtual Soils**, tab content for Map vs About (`UBCMap` vs long-form article with anchors).
- **`src/UBCMap.tsx`** – Leaflet map (OSM tiles), searchable sidebar list, markers with DOM-built popups; **→ Enter** calls `openViewer(path, markers)`; embedded `Viewer` when `activeViewer` is set.
- **`src/Viewer.tsx`** – Creates `ThreeApp`, resolves `gaussianPath` (props or query), parses `markers`, calls `loadGaussianScene` and `setWorldMarkers`; optional “Back to Map” when used from home.
- **`src/Editor.tsx`** – Creates `ThreeApp`, scene dropdown from pins, mode (preview / place / edit), marker list and form; syncs marker state to `ThreeApp` and handles placement/selection via `MarkerPickingController`.
- **`src/Admin.tsx`** – Cognito auth gate; table of fields with expand/edit/delete; “Add Entry” modal and inline edit form; marker array editing (icon, scale, position, text).

### Three.js / 3D Layer (`src/three/`)

- **`ThreeApp.ts`** – Central 3D app: WebGL renderer, camera, resize, render loop. Composes:
  - **GaussianViewer** – Loads and renders one Gaussian splat scene via `@mkkellogg/gaussian-splats-3d`.
  - **WorldMarkers** – Sprites for world-space markers and labels; placement preview sprite when in editor “place” mode.
  - **Skybox** – HDR skybox (e.g. `citrus_orchard_puresky_4k.hdr`).
  - **FlyControls** – WASD + mouse look + optional bounds.
  - **ScreenSpaceUI** – FPS, position, speed, quality preset.
  - **LoadingOverlay** – “Loading splats…” overlay.
  - **MarkerPickingController** – Raycasting for marker/label clicks and “place” clicks; drives editor callbacks.
- **`GaussianViewer.ts`** – Wraps the library `Viewer`: `loadScene(path)`, single scene at a time; options for alpha threshold, SharedArrayBuffer, etc.
- **`WorldMarkers.ts`** – Marker sprites (texture/color/radius), optional placement preview, label texture (canvas); `setMarkers`, `setPlacementPreviewPosition`, `render`.
- **`FlyControls.ts`** – Keyboard + pointer + wheel; optional `Box3` play area.
- **`ScreenSpace.ts`** – Performance presets (low/medium/high), pixel ratio and alpha culling; UI for quality and speed.
- **`Interaction.ts`** – `MarkerPickingController`: pointer down/up, move threshold, raycast to markers/label; `onMarkerClick`, `onPlaceClick`.
- **`Skybox.ts`** – Equirectangular HDR skybox.
- **`LoadingOverlay.ts`** – Full-screen loading spinner and message.

### Lib and API

- **`src/lib/awsClient.ts`** – `aws4fetch` client for signing requests to `VITE_API_URL` (used for `/pins` and Editor’s pin list).
- **`src/auth.ts`** – Amplify config (Cognito user pool, OAuth domain, redirects).
- **`src/adminApi.ts`** – Authenticated fetch to `VITE_API_URL` for `/admin/api/fields`: `listFields`, `createField`, `updateField`, `deleteField`.

### Styling (map)

- **`src/index.css`** – Includes Leaflet-specific rules for `.mapFrame.leaflet-container` and `.leaflet-popup.pin-popup` (custom popup card without default Leaflet chrome).

### Backend

- **`lambda-handler.mjs`** – Lambda entry (example / deployed shape may vary):
  - `GET /pins` – Reads DynamoDB table `eml_fields`, returns pin-shaped JSON (`title`, `position`, `path`, `description`, `thumbnail`, `thumbnailAlt`, `markers`). The sample handler filters to specific `FieldID` values; production may differ.
  - `GET /fields` – Returns scanned items from the table.
  - `GET /fields/:id` – Get one field by id.
- **`backend/README.md`** – Describes a separate Google OAuth backend (session-based); the live app uses Cognito for Admin and Lambda for pins/fields.

### Types and Config

- **`src/types/gaussian-splats-3d.d.ts`** – Type declarations for the Gaussian splat library.
- **`src/types/shaders.d.ts`**, **`src/global.d.ts`** – Shader/global typings (`global.d.ts` notes Leaflet; no Google Maps).
- **`vite.config.ts`** – GLSL plugin; `assetsInclude` for `*.ksplat`; **dev proxy** `'/pins' → http://localhost:3000` for local API during development.

---

## Data Contracts

### Pin (map / viewer / editor)

- **Source**: `GET /pins` (signed with AWS).
- **Shape**: `{ title, position: { lat, lng }, path, description, thumbnail, thumbnailAlt, markers? }`.
- **markers**: array of `{ icon?, scale?, position: { x, y, z }, text? }` (or equivalent); Editor and Viewer normalize to `MarkerInput` (position, radius, texture, label).

### Field (admin)

- **Source**: `GET/POST/PUT/DELETE /admin/api/fields` (Cognito token).
- **Shape**: `FieldID`, `Name`, `Description`, `File`, `Latitude`, `Longitude`, `Thumbnail`, `ThumbnailAlt`, `markers`.
- **markers** in API: array of `[icon, scale, [x,y,z], text]` (tuple); Admin form uses `MarkerForm` (icon, scale, posX/Y/Z, text) and converts to/from that tuple.

### Viewer URL

- **Query**: `?gaussianPath=<url>&markers=<json array>`.
- **gaussianPath**: full URL or path to `.ply` / splat data.
- **markers**: JSON string of marker payloads (same logical shape as pin markers).

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Base URL for API (pins and admin); requests may be signed (pins) or Bearer (admin) |
| `VITE_AWS_ACCESS_KEY_ID` | AWS signing (e.g. for `/pins`) |
| `VITE_AWS_SECRET_ACCESS_KEY` | AWS signing |
| `VITE_AWS_REGION` | AWS region |

There is **no** `VITE_GOOGLE_MAPS_API_KEY`; the map does not use Google.

Cognito is configured in code (`auth.ts`, `Admin.tsx` redirects); user pool and client ids are in `auth.ts`.

---

## User Flows

1. **Browse and view**  
   Open `/` → **Map** tab → (optional) **Click to load map** → pick a location from the list or map → **→ Enter** in the popup → Viewer shows splat + markers over the map; closing returns to the map.

2. **About**  
   Open `/` → **Info** tab → scroll long-form About content (anchors: Why, Radiance Fields, Next Steps).

3. **Direct viewer link**  
   Open `/viewer?gaussianPath=...&markers=...` → same Viewer without the home shell map.

4. **Edit markers**  
   Open `/editor` (optionally `?gaussianPath=...&markers=...`) → select scene from dropdown → “place” or “edit” → add or edit markers (editor state only; persisted only via Admin).

5. **Manage locations**  
   Open `/admin` → sign in with Cognito → add/edit/delete fields (name, file, thumbnail, lat/lng, markers). Stored in DynamoDB; map and editor consume the derived **pins** API.

---

## Build and Run

- **Install**: `npm install`
- **Dev**: `npm run dev` (Vite dev server; optional `/pins` proxy to `localhost:3000` if you run a local API there)
- **Build**: `npm run build` (TypeScript + Vite)
- **Preview**: `npm run preview`
- **Lint**: `npm run lint`

Backend (Lambda, API Gateway, DynamoDB) and Cognito are assumed to be deployed and configured separately; see `backend/README.md` and AWS setup for the API and auth.
