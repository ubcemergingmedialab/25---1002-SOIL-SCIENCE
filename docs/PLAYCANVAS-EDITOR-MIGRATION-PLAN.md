# PlayCanvas editor migration — Phase 6 plan

Detailed plan for migrating the admin **marker editor** (`/editor`) from **Three.js + `ThreeApp`** to the same **PlayCanvas** stack used by the public viewer after Phase 5 cutover.

**Parent plan:** [`PLAYCANVAS-MIGRATION-PLAN.md`](./PLAYCANVAS-MIGRATION-PLAN.md) (Phase 6 summary)  
**Viewer reference:** [`packages/playcanvas-viewer/`](../packages/playcanvas-viewer/) — `createPlayCanvasApp`, markers, camera fly-to  
**Deploy smoke tests:** [`DEPLOY-S3-CLOUDFRONT.md`](./DEPLOY-S3-CLOUDFRONT.md)

---

## Goal

Make `/editor?fieldId={FieldID}` use PlayCanvas so that:

- Authors see the same splat orientation and marker positions as `/viewer/?m={FieldID}`
- Save continues through `updateField` with the existing marker tuple format
- `start_pos` (world axes / orbit interest point) continues to persist

### Exit criteria

- Full admin workflow on PlayCanvas: login → Admin → open editor → place/edit markers → save → verify on public viewer with **zero coordinate drift**
- No dependency on Three.js in the admin build (Phase 7 removes legacy packages)

---

## Current state

| Piece | Today |
|-------|--------|
| Entry | Admin → “Manage markers” opens `/editor?fieldId=…&controlMode=fly` ([`apps/admin/src/Admin.tsx`](../apps/admin/src/Admin.tsx)) |
| Renderer | [`apps/admin/src/Editor.tsx`](../apps/admin/src/Editor.tsx) → `ThreeApp` + `.ksplat` via `field.File` |
| Scene asset | `File` (legacy `.ksplat`), not `FilePlayCanvas` |
| Marker UI | React sidebar (preview / place / edit modes) + optional canvas overlay via `getViewerAddonHost()` |
| Save | `updateField(fieldId, { markers, start_pos })` — API unchanged |
| Viewer (done) | PlayCanvas + `FilePlayCanvas` + 180° X orientation at `/viewer/` |

The editor is tightly coupled to `ThreeApp` APIs. The PlayCanvas viewer package is **read-only**: load splat, show annotations, fly-to marker. It does not yet support placement preview, selection, picking, or transform editing.

---

## Gap analysis: `ThreeApp` → PlayCanvas

| Editor needs | Three.js today | PlayCanvas work needed |
|--------------|----------------|------------------------|
| Load scene | `loadGaussianScene(File)` | `createPlayCanvasApp({ splatUrl: FilePlayCanvas, orientationX: 180 })` |
| Show markers | `setWorldMarkers(input, preview, selectedIndex)` | Dynamic annotation entities; rebuild on state change |
| Placement preview | Preview sprite + `setPlacementPreviewPosition` each frame | Preview entity + `app.on('update')` using camera forward × distance |
| Place marker | `getPlacementPosition()` + sidebar “Place Marker” | `getCameraForward()` + distance math in editor app API |
| Capture view pose | `getCameraPosition()` on “Set View Position” | Read PlayCanvas camera entity position |
| Fly to marker | `moveCameraToMarkerView(pos, viewPos)` | Reuse [`markerCamera.ts`](../packages/playcanvas-viewer/src/markerCamera.ts) |
| Click marker in canvas | `setEditorCallbacks({ onMarkerClick })` | Picking on annotation entities (raycast or annotation events) |
| Edit marker position (3D drag) | `setMarkerEditing` + `TransformControls` | **Largest gap** — see Phase 6.5 options |
| Start position axes | `setWorldAxesPosition` / visible axes at `start_pos` | Debug axes entity at `start_pos`; saved on Save |
| Fly vs orbit | `controlMode=fly` from Admin URL | Reuse [`cameraControlMode.ts`](../packages/playcanvas-viewer/src/cameraControlMode.ts) |
| Custom icons | `THREE.TextureLoader` | Reuse [`markerIconTexture.ts`](../packages/playcanvas-viewer/src/markerIconTexture.ts) |
| Marker list overlay | `getViewerAddonHost()` portal | Keep React sidebar only; drop Three.js overlay host |

**Already unused:** `setInterestPointEditing` is always `false` in Editor — no UI for dragging the interest point. Axes position is loaded from `start_pos` but not interactively edited in the sidebar.

---

## Recommended architecture

Extend `packages/playcanvas-viewer` with an **editor layer** (parallel to the viewer facade):

```text
packages/playcanvas-viewer/src/
  createPlayCanvasApp.ts          # viewer (existing)
  createPlayCanvasEditorApp.ts    # NEW — editor facade
  setupEditorMarkers.ts           # dynamic markers, preview, selection highlight
  editorPicking.ts                # pointer → marker index
  editorPlacement.ts              # distance preview, getPlacementPosition
  editorStartAxes.ts              # start_pos visualization
  editorMarkerTransform.ts        # optional 3D translate (edit mode)
```

`createPlayCanvasEditorApp` should share init with the viewer (device, splat, skybox, camera, controls) but expose an editor API shaped like what `Editor.tsx` expects today:

```ts
type PlayCanvasEditorApp = PlayCanvasApp & {
  getCameraPosition(): [number, number, number];
  getPlacementPosition(): [number, number, number];
  setPlacementDistance(m: number): void;
  setMarkers(markers, preview?, selectedIndex?): void;
  setEditorCallbacks(cb: { onMarkerClick? }): void;
  setMarkerEditing(index, onCommit?): void;
  setStartAxesPosition(pos): void;
  moveCameraToMarkerView(pos, viewPos): void;
  showMarkerLabel(index): void;
};
```

Keep **marker conversion logic** (`EditorMarker` ↔ backend tuple) in `Editor.tsx` or move to `@soil/shared` — that layer is renderer-agnostic.

---

## Implementation phases

### Phase 6.0 — Prerequisites (~½ day)

- [x] Shared splat URL helpers — [`packages/shared/src/utils/splatUrls.ts`](../packages/shared/src/utils/splatUrls.ts)
- [x] Admin `Field` types use shared `AdminField` (`FilePlayCanvas`, `FileFormat`); read-only display in Admin UI
- [x] `openMarkerManager` opens `/editor?fieldId=…` only (editor resolves scene from API)
- [x] Editor pin list includes `FilePlayCanvas` / `FileFormat` via `fieldToEditorPin` (legacy `path` = `File` for Three.js until 6.2)
- [ ] **Ops:** Confirm every production field has `FilePlayCanvas` + `FileFormat` in DynamoDB — run `npm run verify:fileplaycanvas`

### Phase 6.1 — Wire admin to PlayCanvas package (~½ day)

- [x] `@soil/playcanvas-viewer` dependency in `apps/admin/package.json`
- [x] Vite alias + `/work-out` dev middleware (matches viewer)
- [x] `/editor` routing: PlayCanvas default; `?renderer=legacy` fallback; lazy `EditorLegacy` + `PlayCanvasEditor`
- [x] PlayCanvas module shims in `apps/admin/src/playcanvas/`

### Phase 6.2 — Scene load parity (~1 day)

- [x] `PlayCanvasEditor` loads `FilePlayCanvas` via `createPlayCanvasApp`
- [x] `orientationX: 180` default (override with `?orientationX=` / `orientationY` / `orientationZ`)
- [x] Fly/orbit camera controls (`controlMode` query param, default fly)
- [x] Loading overlay while LOD becomes interactive
- [x] Read-only marker fly-to (preview until Phase 6.3 editing)
- [x] Clear errors + link to legacy editor when `FilePlayCanvas` missing

### Phase 6.3 — Read-only markers (~1–2 days)

- [x] Dynamic `setMarkers` on PlayCanvas marker handle (rebuild annotations + icons)
- [x] Selection highlight (`#3b82f6`) on selected hotspot
- [x] Sidebar + scene hotspot click → fly camera; second click → title/description tooltip
- [x] Marker list in editor sidebar only (no Three.js overlay host)

### Phase 6.4 — Place mode (~1–2 days)

- [x] `setPlacementPreview` + per-frame preview entity (icon follows camera at placement distance)
- [x] `getPlacementPosition()` for “Place Marker”
- [x] “Set View Position” captures camera pose into `viewPosition`
- [x] New markers append to React state; `setMarkers` syncs to scene
- [x] Shared `EditorMarker` helpers — [`packages/shared/src/markers/editorMarkers.ts`](../packages/shared/src/markers/editorMarkers.ts)
- [x] Placement preview module — [`packages/playcanvas-viewer/src/editorPlacement.ts`](../packages/playcanvas-viewer/src/editorPlacement.ts)

**Verify (local):** Place mode preview follows camera; Place Marker adds hotspot; fly-to uses captured view position. **Save → viewer parity** deferred to Phase 6.6.

### Phase 6.5 — Edit mode (~2–3 days)

Shipped **6.5a** (numeric + fly-to; no in-scene 3D drag).

- [x] Edit mode tab with marker selector and “+ New Marker” → Place
- [x] Icon / radius / title / description edits (React state → `setMarkers` sync)
- [x] Numeric position and view-position inputs (world / camera)
- [x] Set view position from current camera in edit mode
- [x] Delete marker
- [x] Shared coordinate helpers — [`packages/shared/src/markers/editorCoordinates.ts`](../packages/shared/src/markers/editorCoordinates.ts)

**Deferred from 6.5:** numeric-only edit shipped first; 3D drag completed in 6.7.

### Phase 6.6 — Save workflow & `start_pos` (~½ day)

- [x] Save / discard footer (`updateField` with `markers` + `start_pos`)
- [x] Reload persisted markers after save via `getField`
- [x] Read-only `start_pos` axes in scene — [`packages/playcanvas-viewer/src/editorStartAxes.ts`](../packages/playcanvas-viewer/src/editorStartAxes.ts)
- [x] `parseStartPos` helper — [`packages/shared/src/utils/startPos.ts`](../packages/shared/src/utils/startPos.ts)
- [x] Orbit focus point synced to `start_pos` on axes update

**Verify:** Save → reload editor → markers persist; open `/viewer/?m=…` to confirm parity.

### Phase 6.7 — Draggable marker axes (~2–3 days)

Legacy **edit mode** uses `setMarkerEditing` + `TransformControls` on the selected marker sprite. PlayCanvas equivalent:

- [x] RGB translate gizmo at selected marker in **Edit** mode
- [x] Drag center (view plane) or individual X/Y/Z axes to reposition
- [x] Camera controls paused while dragging; numeric sidebar fields stay in sync
- [x] Shared axis visuals — [`packages/playcanvas-viewer/src/editorAxisVisual.ts`](../packages/playcanvas-viewer/src/editorAxisVisual.ts)
- [x] Gizmo module — [`packages/playcanvas-viewer/src/editorMarkerGizmo.ts`](../packages/playcanvas-viewer/src/editorMarkerGizmo.ts)

**Verify:** Edit mode → select marker → drag axes → position updates in sidebar and hotspot; save → viewer parity.

### Phase 6.8 — Cutover & cleanup (~1 day)

1. [x] Default `/editor` → PlayCanvas.
2. [x] Keep `?renderer=legacy` for one release cycle.
3. [x] Update [`DEPLOY-S3-CLOUDFRONT.md`](./DEPLOY-S3-CLOUDFRONT.md) admin smoke test: editor loads LOD, save marker, verify on viewer URL.
4. [ ] After stable period (Phase 7): remove `three`, `@mkkellogg/gaussian-splats-3d` from admin.

---

## Coordinate system validation (critical)

Main risk for editor → viewer regression.

1. **Golden field test:** Pick one field with known markers (e.g. `AW2`). Record `position` / `viewPosition` from DB. After migration, place a new marker at an obvious landmark; save; compare viewer vs editor visually and numerically (±0.01).
2. **Same transforms as viewer:** `orientationX: 180` on splat entity; marker positions in **world space** (not splat-local).
3. **Optional unit test:** `editorMarkersToBackend` → `toNavigableMarkers` round-trip with fixed vectors.
4. **Regression:** Legacy editor (`?renderer=legacy`) on same field for side-by-side during QA.

---

## Testing checklist

| Step | Desktop | Notes |
|------|---------|-------|
| Login → Admin → Manage markers | ✓ | Cognito unchanged |
| Scene loads (`FilePlayCanvas`) | ✓ | Network: `lod-meta.json` + chunks 200 |
| Preview mode: list + fly-to | ✓ | |
| Place mode: preview distance, icon, radius | ✓ | |
| Set view position + place | ✓ | |
| Edit mode: numeric position/view | ✓ | |
| Save → reload editor | ✓ | Markers persist |
| Open `/viewer/?m=…` | ✓ | No drift |
| Fly mode camera | ✓ | Default from Admin |
| Legacy fallback `?renderer=legacy` | ✓ | Temporary |
| Field missing `FilePlayCanvas` | ✓ | Clear error |

Mobile editor is optional (see testing matrix in parent migration plan).

---

## Rollback

Same pattern as viewer Phase 5:

- Redeploy previous admin build, or
- Use `/editor?fieldId=…&renderer=legacy` while PlayCanvas editor is fixed

Do not remove `.ksplat` / `File` until Phase 7.

---

## Effort estimate

| Slice | Estimate |
|-------|----------|
| 6.0–6.2 (wire + load) | 2 days |
| 6.3–6.4 (markers + place) | 3 days |
| 6.5 (numeric edit) | 1–2 days |
| 6.6 (save + start_pos axes) | ½ day |
| 6.7 (draggable marker gizmo) | 2–3 days |
| 6.8 (cutover, docs) | 1 day |
| QA across fields | 1–2 days |
| **Total** | **~2 weeks** |

---

## Suggested first PR

Keep the first PR small and reviewable:

1. Add `createPlayCanvasEditorApp` with scene load + read-only markers only.
2. Behind `?renderer=pc` flag on `/editor` (opt-in before flipping default).

Validate **coordinate alignment** before investing in place/edit UX.

---

## What stays unchanged

- `/editor` route and `fieldId` query param
- Cognito auth (`RequireAuth`)
- `updateField` / marker tuple format `[icon, radius, position, viewPosition, label]`
- DynamoDB `File` URLs (until Phase 7)
- React sidebar UI structure and CSS (`markerEditorShell`, etc.)

---

## Related links

- [`PLAYCANVAS-MIGRATION-PLAN.md`](./PLAYCANVAS-MIGRATION-PLAN.md) — full phased migration
- [`PLAYCANVAS-SPLAT-EVALUATION.md`](./PLAYCANVAS-SPLAT-EVALUATION.md) — engine vs embed decision
- [`apps/admin/src/Editor.tsx`](../apps/admin/src/Editor.tsx) — current Three.js editor
- [`packages/playcanvas-viewer/src/createPlayCanvasApp.ts`](../packages/playcanvas-viewer/src/createPlayCanvasApp.ts) — viewer app factory
