# Code Structure Improvements – Prioritised

Suggested improvements to the Virtual Soils codebase, ordered by impact and effort. Priorities are **P0 (high)** → **P3 (nice-to-have)**.

---

## P0 – High priority (correctness, security, maintainability)

### 1. Fix Viewer type guard and align naming

**File**: `src/Viewer.tsx`

The type guard checks for `loadGaussianScene` but the comment says `setGaussianPath`:

```ts
function hasSetGaussianPath(o: unknown): o is { setGaussianPath: (path: string) => void } {
  return !!o && typeof o === "object" && "loadGaussianScene" in o;
}
```

- Rename the function to e.g. `hasLoadGaussianScene` and type the return as `{ loadGaussianScene: (path: string) => void | Promise<void> }`, **or**
- Keep the name and fix the implementation to check for the method that actually exists (`loadGaussianScene`). The comment is wrong; the implementation is correct.

**Action**: Rename function to `hasLoadGaussianScene` and fix the type so call sites and types stay consistent.

---

### 2. Remove or secure hardcoded secrets and env assumptions

**Files**: `src/auth.ts`, `src/Admin.tsx`, `src/lib/awsClient.ts`

- **auth.ts**: Cognito user pool ID, client ID, and OAuth domain are hardcoded. Prefer `import.meta.env.VITE_COGNITO_*` (or similar) so production and staging can differ.
- **Admin.tsx**: Logout builds a URL with hardcoded `domain`, `clientId`, `logoutUri` (e.g. `http://localhost:5173/`). These should come from env or from Amplify config.
- **awsClient.ts**: Assumes `VITE_AWS_ACCESS_KEY_ID`, `VITE_AWS_SECRET_ACCESS_KEY` are set; frontend AWS keys are sensitive. Prefer:
  - Backend-only signing (e.g. a small backend that signs requests or proxies to DynamoDB/API), or
  - Cognito Identity Pool + temporary credentials so long-lived IAM keys are not in the client.

**Action**: Move Cognito and logout URLs to env; document that AWS keys in the client are a risk and plan for a proxy or Identity Pool.

---

### 3. Single source of truth for “pin” vs “field” and marker shape

**Context**: Map/Editor use “pins” from `GET /pins`; Admin uses “fields” from `/admin/api/fields`. The lambda maps DynamoDB fields → pins. Marker shape differs:

- **Pins**: `markers` as array of `{ icon, scale?, position: { x,y,z }, text? }`.
- **Admin/API**: `markers` as array of tuples `[icon, scale, [x,y,z], text]`.
- **Editor**: `EditorMarker` with `position`, `radius`, `label`, `icon`; conversion in multiple places.

**Action**:

- Introduce shared types (e.g. `src/types/api.ts` or `src/types/markers.ts`): `Pin`, `Field`, `MarkerPayload` (API tuple), `MarkerInput` (viewer/editor).
- Centralise conversion in one module (e.g. `api/pins.ts` or `lib/markers.ts`): API tuple ↔ `MarkerInput` / `EditorMarker`.
- Use these types in UBCMap, Viewer, Editor, Admin, and adminApi so the contract is explicit and consistent.

---

## P1 – Structure and duplication

### 4. Extract pin/field API and data fetching

**Context**: UBCMap and Editor both fetch pins with similar logic; Admin uses adminApi for fields. There is no shared “pins” client.

**Action**:

- Add e.g. `src/api/pins.ts` (or `src/lib/pinsApi.ts`):
  - `fetchPins(): Promise<Pin[]>` using `awsClient` and `VITE_API_URL`.
- Use it in `UBCMap.tsx` and `Editor.tsx` instead of inline `awsClient.fetch(.../pins)`.
- Optionally add a small React hook `usePins()` that returns `{ pins, loading, error, refetch }` and use it in both UBCMap and Editor.

---

### 5. Share marker parsing and URL resolution

**Context**: `resolveAssetUrl` and marker parsing (API → position/radius/texture/label) are duplicated in `Viewer.tsx` and `Editor.tsx`. Editor also has `parseApiMarkers`, `editorMarkersToInput`, `getTextureForIcon`.

**Action**:

- Create `src/lib/markers.ts` (or `src/utils/markerUtils.ts`):
  - `resolveAssetUrl(raw: string): string`
  - `parseMarkersFromApi(raw: unknown): MarkerInput[]` (or a shared `MarkerPayload` → `MarkerInput` type and function)
  - Optionally a small texture cache (or pass cache from caller) for icon URLs.
- Use these in Viewer and Editor so parsing and URL rules live in one place.

---

### 6. Reduce UBCMap size: extract InfoWindow and list UI

**File**: `src/UBCMap.tsx`

The component is large: pins fetch, map init, marker creation, and a big inline InfoWindow content builder (DOM creation, styles, button logic).

**Action**:

- Extract “build pin InfoWindow content” into a helper (e.g. `createPinInfoContent(pin, onOpenViewer) => HTMLElement`) in the same file or in `src/components/` (e.g. `MapPinInfoWindow.ts`).
- Optionally extract the sidebar (search input + list of location buttons) into a presentational component that receives `pins`, `searchQuery`, `selectedPinIndex`, `onSearch`, `onSelectPin`, so UBCMap focuses on map + markers + wiring.

---

## P2 – Consistency and robustness

### 7. Align Editor with backend: save markers

**Context**: Editor loads pins and their markers and allows add/edit/delete, but changes stay in local state. Persisted markers are only changed via Admin.

**Action** (product decision):

- If editors should persist markers: add “Save” in Editor that calls an update endpoint (e.g. same as Admin’s update field with new markers), with auth. Then Editor becomes a “marker-only” editor that writes back to the same field.
- If Editor is preview-only: add a short note in the UI (“Marker changes are not saved”) and optionally a “Copy marker JSON” for pasting into Admin.

---

### 8. Error and loading states

**Context**: Pins fetch in UBCMap and Editor only log errors; Loading Overlay is only in the 3D viewer. Map has “Loading locations…” but no explicit error state.

**Action**:

- In UBCMap (and Editor): surface `loading` and `error` from pin fetch (e.g. from `usePins()` if introduced); show a small message or retry when fetch fails.
- Ensure ThreeApp/Viewer loading overlay is shown for the full duration of `loadGaussianScene` (already the case; keep it when refactoring).

---

### 9. Lambda pins filter and API surface

**File**: `lambda-handler.mjs`

`getPins()` filters with a hardcoded list: `["TestA", "TestB", "TestC"]`. That’s suitable only for dev.

**Action**:

- Move filter to config (env or config object), or remove it and control visibility via a “published” flag on fields; document the intended behaviour.
- Consider whether GET /pins should be public (no auth) while GET /fields and mutations stay protected; if so, keep signing only where needed and document.

---

## P3 – Nice-to-have

### 10. Route-based viewer state

**Context**: When opening the viewer from the map, App switches to `<Viewer>` in the same route `/`. Back button clears React state; there is no URL change.

**Action**: Consider pushing a route (e.g. `/view?path=...&markers=...`) when opening the viewer so “Back” can be browser back and the link is shareable. Viewer already supports query params; only the “open viewer” action would need to use the router.

---

### 11. Centralise viewer/editor container styling

**Context**: Viewer’s “Back to Map” button and Editor’s sidebar use inline styles. Some layout (e.g. `.threeWrap`) is in CSS.

**Action**: Move repeated styles into `index.css` or a small set of classes (e.g. `.viewerToolbar`, `.editorSidebar`) so theme and layout are consistent and easier to change.

---

### 12. Type backend responses

**Context**: adminApi uses `any` for list/create/update responses; UBCMap and Editor cast pin response to ad-hoc types.

**Action**: Define `ListFieldsResponse`, `CreateFieldResponse`, and use `Pin` from the shared types; type the return values of `listFields`, `createField`, `updateField` and the pin fetch so mismatches are caught at compile time.

---

## Summary table

| Priority | Item | Main benefit |
|----------|------|--------------|
| P0 | 1. Viewer type guard | Correct types and naming |
| P0 | 2. Secrets / env | Security and multi-environment |
| P0 | 3. Pin/field/marker types | Consistency, fewer bugs |
| P1 | 4. Pin API module | DRY, single place for pins |
| P1 | 5. Shared marker utils | DRY, consistent parsing |
| P1 | 6. Split UBCMap | Readability, testability |
| P2 | 7. Editor save (or clarify) | Clear product behaviour |
| P2 | 8. Error/loading UI | Better UX |
| P2 | 9. Lambda filter config | Flexible production data |
| P3 | 10. Viewer URL state | Shareable links, back nav |
| P3 | 11. Shared styles | Consistency |
| P3 | 12. Type API responses | Safer refactors |

Implementing P0 and P1 items will give the largest gain in structure and maintainability with reasonable effort.
