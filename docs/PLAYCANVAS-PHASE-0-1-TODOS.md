# PlayCanvas migration — Phase 0 & 1 todos

Actionable checklist for **Validate** and **Asset pipeline**. Parent plan: [`PLAYCANVAS-MIGRATION-PLAN.md`](./PLAYCANVAS-MIGRATION-PLAN.md).

**Note:** Phase 0 must complete (go decision) before Phase 1 batch work. Some Phase 0 items (CDN upload of test assets) overlap with early Phase 1 infrastructure.

---

## Phase 0 — Validate (~3–5 days)

### Scene selection

- [ ] Export list of production fields from DynamoDB (`FieldID`, `Name`, `File`, approximate size if known)
- [ ] Pick **small** scene (fast load, low splat count)
- [ ] Pick **medium** scene (typical production site)
- [ ] Pick **large** scene (worst-case mobile performance)
- [ ] Record current `.ksplat` URLs and download sizes for each

### Tooling setup

- [ ] Install `@playcanvas/splat-transform` locally (`npm install -g @playcanvas/splat-transform`)
- [ ] Verify CLI runs: `splat-transform --help`
- [ ] Download 3 test `.ksplat` files from assets CDN (or copy from S3)

### Conversion (test assets only)

- [ ] Convert small scene → `.sog`
- [ ] Convert medium scene → `.sog`
- [ ] Convert large scene → `.sog`
- [ ] Convert large scene → **streamed LOD** bundle (`lod-meta.json` + chunks) if above ~2M splats
- [ ] Visually inspect SOG output in SuperSplat viewer or PlayCanvas example (no app code yet)
- [ ] Document any orientation/scale issues vs current viewer (coordinate flip, upside-down, etc.)

### Host test assets on CDN

- [ ] Choose dev prefix (e.g. `splats-pc/` or `splats/sog/` on assets bucket)
- [ ] Upload converted SOG files to assets S3 / CloudFront
- [ ] Upload streamed LOD folder for large scene (if applicable)
- [ ] Set `Cache-Control: public, max-age=31536000, immutable` on uploaded test objects
- [ ] Confirm CORS: fetch from viewer CloudFront origin succeeds (`curl -I` + browser DevTools)
- [ ] Record public HTTPS URLs for each test asset

### Benchmark harness

- [ ] Create benchmark spreadsheet (columns: device, browser, scene, stack, time-to-interactive, FPS/feel, network MB, notes)
- [ ] Build minimal SuperSplat viewer page **or** use hosted SuperSplat embed pointing at test SOG/LOD URLs
- [ ] Document exact URLs for side-by-side:
  - [ ] Legacy: `https://{viewer_cloudfront}/viewer/?m={FieldID}`
  - [ ] PlayCanvas POC: static page URL + asset URL

### Device testing

- [ ] Desktop Chrome — legacy viewer (3 scenes)
- [ ] Desktop Chrome — PlayCanvas POC (3 scenes)
- [ ] iPhone Safari — legacy viewer (3 scenes)
- [ ] iPhone Safari — PlayCanvas POC (3 scenes)
- [ ] Android Chrome — legacy viewer (at least large scene)
- [ ] Android Chrome — PlayCanvas POC (at least large scene)
- [ ] One WebGL2-only / no-WebGPU device — PlayCanvas POC fallback acceptable?

### Record metrics

- [ ] Time to first interactive frame (each device × scene × stack)
- [ ] Subjective or measured FPS while orbiting
- [ ] Total network transfer on cold load
- [ ] Visual quality notes (blur, holes, color shift vs `.ksplat`)

### Go / no-go & decision

- [ ] Compare results against exit criteria (≥30% mobile improvement on 2/3 scenes, or stakeholder waiver)
- [ ] Confirm visual quality acceptable post-SOG compression
- [ ] Write short **go / no-go** note (ticket or doc)
- [ ] Choose integration path for Phases 2–6:
  - [ ] **Path A — Engine-first** (recommended: custom Editor + Leaflet inline viewer)
  - [ ] **Path B — Embed-first** (SuperSplat viewer embed, defer engine)
- [ ] Share benchmark summary + decision with stakeholders

### Phase 0 deliverables

- [ ] Benchmark spreadsheet committed or linked (internal)
- [ ] Go/no-go note published
- [ ] Path A/B recorded in migration ticket

---

## Phase 1 — Asset pipeline (~1–2 weeks)

**Prerequisite:** Phase 0 go decision.

**Integration path:** **Engine-first** (`@playcanvas/engine` in Vite apps). Phase 1 still does **not** ship PlayCanvas to production users — it builds the asset + API layer the engine will load in Phase 2+. See [Phase 1 (engine-first)](#phase-1-engine-first--what-it-looks-like) below.

### 1.1 Conversion workflow

- [ ] Create `scripts/splat/` (or document lab-repo location)
- [ ] Add conversion script: `.ksplat` → `.sog` (single file output)
- [ ] Add conversion script: `.ksplat` → streamed LOD bundle (for scenes above splat threshold)
- [ ] Define splat threshold for LOD vs SOG-only (e.g. 2M Gaussians)
- [ ] Document script usage in `scripts/splat/README.md` (inputs, outputs, examples)
- [ ] Test script on all 3 Phase 0 scenes — output matches manual conversion
- [ ] Decide CDN path convention:
  ```text
  /splats/*.ksplat              ← keep existing (unchanged)
  /splats/sog/{name}.sog        ← new
  /splats/lod/{fieldId}/        ← streamed LOD manifest + chunks
  ```

### 1.2 Batch convert production assets

- [ ] List all production `File` URLs from DynamoDB
- [ ] Run batch conversion for every field
- [ ] Upload all SOG / LOD outputs to assets bucket
- [ ] Apply `Cache-Control` to all new objects (see [`SPLAT-CACHING.md`](./SPLAT-CACHING.md))
- [ ] Verify each asset loads via **engine smoke test** (dev harness or PlayCanvas LOD example — not SuperSplat embed)
- [ ] Log failures / scenes needing manual fix (orientation, corrupt source, etc.)

### 1.3 DynamoDB & API schema

- [ ] Decide schema approach:
  - [ ] **Option A:** New attributes `FilePlayCanvas`, `FileFormat` on field records
  - [ ] **Option B:** Derive PlayCanvas URL from `FieldID` + path convention in Lambda
- [ ] Update Lambda handler to read/write new fields (lab repo)
- [ ] Extend `/fields` and `/pins` responses to include PlayCanvas URL (non-breaking additive fields)
- [ ] Backfill DynamoDB: set `FilePlayCanvas` for every existing field
- [ ] Keep `File` pointing at `.ksplat` until Phase 7 (no change to current viewer behavior)
- [ ] Deploy Lambda + verify API responses in dev/prod

### 1.4 App repo (optional, non-breaking)

- [ ] Extend shared field/pin TypeScript types with `FilePlayCanvas?`, `FileFormat?`
- [ ] Extend `publicApi.ts` to pass through new fields (viewer still uses `File` only)
- [ ] **Do not** replace `GaussianViewer` or change default viewer routes in Phase 1

### 1.5 CDN & infrastructure

- [ ] Confirm assets CloudFront CORS still allows viewer + admin origins (no regression)
- [ ] Test Range requests on SOG / LOD chunks if viewer uses progressive fetch
- [ ] Document invalidation procedure when a scene is re-exported (LOD = many files)
- [ ] Estimate storage delta (SOG + LOD vs `.ksplat` only) — note in ticket

### 1.6 Upload process (content ops)

- [ ] Document end-to-end flow for **new** sites:
  1. Upload source to staging prefix
  2. Run conversion script
  3. Upload to final CDN prefix
  4. Set DynamoDB `File` + `FilePlayCanvas`
- [ ] Assign owner (dev vs content team)
- [ ] (Optional) Draft CI job for convert-on-upload — defer if manual is fine for now
- [ ] (Optional) Decide whether SuperSplat Studio is used for polish — default **no** if Editor stays source of truth

### 1.7 Regression check

- [ ] Smoke test **current** viewer on all fields (`/viewer/?m={FieldID}`) — must be unchanged
- [ ] Smoke test admin editor still loads `.ksplat` from `File`
- [ ] Confirm no accidental DynamoDB overwrite of `File` URLs

### Phase 1 exit criteria

- [ ] All production fields have `FilePlayCanvas` populated
- [ ] Every `FilePlayCanvas` URL loads via engine smoke test (GSplat asset from URL)
- [ ] Conversion script documented and repeatable
- [ ] Current `.ksplat` viewer and editor — no regression

### Phase 1 deliverables

- [ ] `scripts/splat/README.md` (+ scripts)
- [ ] Lambda/API deployed with new fields
- [ ] All CDN objects uploaded with cache headers
- [ ] Backfill complete in DynamoDB
- [ ] Ready to start **Phase 2** (parallel `/viewer-pc` route)

---

## Quick reference

| Phase | Viewer code changes? | Production viewer behavior |
|-------|----------------------|----------------------------|
| 0 | None | Unchanged (`.ksplat`) |
| 1 | Optional types/API passthrough only | Unchanged (`.ksplat`) |

See [`PLAYCANVAS-MIGRATION-PLAN.md`](./PLAYCANVAS-MIGRATION-PLAN.md) Phase 2 for first PlayCanvas viewer route.

---

## Phase 1 (engine-first) — what it looks like

**Decision locked:** Path A — `@playcanvas/engine` inside our Vite apps (not `@playcanvas/supersplat-viewer` embed).

Phase 1 is **backend + assets + API only**. Production viewer and editor still use Three.js + `.ksplat`. You are building the **inputs** the engine will consume starting in Phase 2.

### What Phase 1 is

```text
┌─────────────────────────────────────────────────────────────┐
│  Phase 1 deliverables (no public viewer change)              │
├─────────────────────────────────────────────────────────────┤
│  splat-transform pipeline  →  SOG + streamed LOD on assets CDN │
│  DynamoDB FilePlayCanvas   →  URL engine will load           │
│  Lambda /pins /fields      →  expose new fields              │
│  Dev-only engine smoke     →  confirm each URL loads         │
│  Content ops runbook       →  new sites get both formats     │
└─────────────────────────────────────────────────────────────┘

Production today (unchanged through Phase 1):
  Viewer/Editor → File (.ksplat) → GaussianViewer → Three.js
```

### What `FilePlayCanvas` points to (engine contract)

The engine loads splats as **`gsplat` assets from a URL** — no embed, no PlayCanvas hosting:

| `FileFormat` | `FilePlayCanvas` URL | When to use |
|--------------|----------------------|-------------|
| `sog` | `https://{assets_cdn}/splats/sog/{name}.sog` | Smaller scenes (under splat threshold) |
| `streamed-lod` | `https://{assets_cdn}/splats/lod/{fieldId}/lod-meta.json` | Larger scenes; mobile-first default for big sites |

Engine API (Phase 2+) will look like:

```javascript
const asset = new pc.Asset('scene', 'gsplat', { url: filePlayCanvasUrl });
app.assets.load(asset);
entity.addComponent('gsplat', { asset });
```

Streamed LOD **must** be a folder on CDN: manifest + chunk files co-located under `/splats/lod/{fieldId}/`.

Keep `File` as `.ksplat` until Phase 7 so legacy viewer/editor keep working.

### Week-by-week shape (~1–2 weeks)

**Week 1 — Pipeline + conventions**

| Day | Work |
|-----|------|
| 1–2 | `scripts/splat/` — convert `.ksplat` → SOG; document `splat-transform` flags; pick splat threshold for LOD |
| 2–3 | Add streamed LOD export to script; define CDN layout; test on Phase 0’s three scenes |
| 3–4 | Upload to assets bucket; cache headers + CORS check; record orientation (compare to current viewer — fix transform in script if needed) |
| 4–5 | Minimal **dev-only** engine page in repo (e.g. `apps/viewer/dev/playcanvas-smoke.html` or script) that loads one URL via `@playcanvas/engine` — validates assets, not product UI |

**Week 2 — Production scale + API**

| Day | Work |
|-----|------|
| 1–2 | Batch convert all DynamoDB fields; upload; engine smoke test each `FilePlayCanvas` |
| 2–3 | Lambda: add `FilePlayCanvas`, `FileFormat`; deploy; backfill DynamoDB |
| 3 | App repo: types + `publicApi` passthrough (viewer still ignores new fields) |
| 4 | Content ops runbook: upload → convert → CDN → DynamoDB |
| 5 | Regression: all fields on **current** `/viewer` + admin editor; Phase 1 sign-off |

### What Phase 1 explicitly does **not** include

- No `@playcanvas/engine` in production viewer/admin bundles yet (optional dev dependency for smoke test only)
- No `PlayCanvasApp`, no `/viewer-pc` route (Phase 2)
- No marker / annotation port (Phase 3)
- No removal of `GaussianViewer` or Three.js
- No SuperSplat Studio or superspl.at dependency

### Engine-first priorities in Phase 1

Because mobile perf drove the switch, bias conversion toward **streamed LOD** for any scene that struggled on phones in Phase 0 — not SOG-only for large sites. Document recommended **global splat budget** targets for Phase 4 (e.g. 1M mobile / 3M desktop) in the runbook.

Validate **coordinate alignment** during Phase 1 smoke tests (engine vs current viewer for the same field). Fixing rotation/scale in the conversion script now avoids rework in Phase 4–6 editor.

### Phase 1 done when

1. Every field has `FilePlayCanvas` + `FileFormat` in DynamoDB and API  
2. Every URL loads in the dev engine smoke harness  
3. Conversion is scripted and documented for new content  
4. Current production viewer is unchanged and regression-clean  

→ Hand off to **Phase 2**: add `packages/playcanvas-viewer`, `@playcanvas/engine`, parallel route loading `FilePlayCanvas`.
