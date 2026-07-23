# PlayCanvas Gaussian Splat — evaluation for Virtual Soils

Stakeholder suggestion: switch from the current **`@mkkellogg/gaussian-splats-3d` + Three.js** stack to **PlayCanvas** for better mobile performance, and explore PlayCanvas **annotations**.

This document compares tradeoffs against the **current implementation** in this repo. It is an investigation, not a decision or implementation plan.

**Related docs**

- Current splat stack: [`packages/shared/src/three/GaussianViewer.ts`](../packages/shared/src/three/GaussianViewer.ts), [`ThreeApp.ts`](../packages/shared/src/three/ThreeApp.ts)
- Asset delivery: [`SPLAT-LOADING-AND-CACHING-RESOLUTION.md`](./SPLAT-LOADING-AND-CACHING-RESOLUTION.md)
- App architecture: [`DECOUPLED-APPS.md`](./DECOUPLED-APPS.md)

---

## Executive summary

| Question | Answer |
|----------|--------|
| Is PlayCanvas likely faster on mobile? | **Yes, potentially by a large margin** — especially with **WebGPU**, **SOG compression**, and **streamed LOD**. Published benchmarks show ~2× FPS on iPhone-class hardware at multi-million splat counts vs WebGL2. |
| Is it a drop-in replacement? | **No.** PlayCanvas is a full engine (or a separate embeddable viewer product). Virtual Soils has deep custom integration: React shell, marker editor, DynamoDB-backed markers, fly/orbit controls, mobile UI, and `.ksplat` assets on S3. |
| Do PlayCanvas annotations replace our markers? | **Partially.** They cover **guided-tour hotspots** (position + title + body + camera pose) similar to viewer markers, but **not** the admin **Editor** workflow (place/edit/save icons to DynamoDB). |
| Recommended next step if exploring | **Benchmark** one production scene on a target phone (current stack vs PlayCanvas SuperSplat viewer with SOG/streamed LOD export). Then follow [`PLAYCANVAS-MIGRATION-PLAN.md`](./PLAYCANVAS-MIGRATION-PLAN.md). |

---

## What we use today

### Renderer

- Library: **`@mkkellogg/gaussian-splats-3d`** (Three.js WebGL2)
- Wrapper: `GaussianViewer` → used by `ThreeApp`
- Format in production: **`.ksplat`** on assets CloudFront (`/splats/*.ksplat`)
- Sorting: **CPU worker thread** (`gpuAcceleratedSort: false` in our config)
- Quality/perf knobs: `splatAlphaRemovalThreshold`, pixel ratio presets, optional low-res composite render path

### Custom features built on Three.js (not from the splat library)

| Feature | Location | Notes |
|---------|----------|-------|
| Fly + orbit camera | `ThreeApp`, `FlyControls`, OrbitControls | Fly disabled on mobile |
| Mobile toolbar | `ScreenSpace.ts` | Rotate / pan / zoom / reset, place info card |
| World markers | `WorldMarkers.ts` | Sprite icons, labels, picking |
| Marker → camera transition | `ThreeApp` | Animated move to `viewPosition` when marker clicked |
| Marker editor | `apps/admin/src/Editor.tsx` | Place, edit, delete; 4 icon choices; saves to DynamoDB |
| Performance UI | `ScreenSpace.ts` | Low / medium / high presets |
| Skybox, loading overlay | `Skybox.ts`, `LoadingOverlay.ts` | HDR environment |
| Map + inline viewer | `apps/viewer` | Leaflet + embedded `ThreeApp` |

### Marker data model (DynamoDB)

Each marker stores: **icon URL**, **radius**, **world position**, **view position** (camera pose), **label text**. This is richer than a simple pin and is authored in the **admin Editor**, not in an external splat tool.

---

## What PlayCanvas offers

PlayCanvas is several related products:

| Layer | What it is | Relevance to Virtual Soils |
|-------|------------|----------------------------|
| **PlayCanvas Engine** (open source) | Full WebGL/WebGPU game engine with GSplat rendering | Replace Three.js entirely; maximum control |
| **SuperSplat Viewer** (`@playcanvas/supersplat-viewer`) | Embeddable static viewer + Experience Settings JSON | Fast path for **read-only** viewing |
| **SuperSplat Studio** (hosted) | Authoring: annotations, camera paths, publish | Overlap with markers/tours; separate from our admin |
| **splat-transform** (CLI) | Convert/filter/LOD splat files | **Required** for SOG / streamed LOD pipeline |

Official docs: [PlayCanvas Gaussian Splatting](https://developer.playcanvas.com/user-manual/gaussian-splatting/), [Performance](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/performance/), [Annotations](https://developer.playcanvas.com/user-manual/supersplat/studio/annotations/).

---

## Why PlayCanvas may perform better on mobile

### 1. WebGPU compute pipeline

PlayCanvas has invested heavily in a **WebGPU** splat path: GPU sorting, frustum culling, half-precision spherical harmonics. Public benchmarks (PlayCanvas / SuperSplat announcements, 2025–2026) cite:

- Large scenes (10–35M splats): **multi× speedup** vs WebGL2 on desktop
- **iPhone 13 Pro Max**: roughly **2× FPS** at 1–4M splats (e.g. ~38 → ~78 fps in one cited test)
- Automatic **fallback to WebGL2** where WebGPU is unavailable (~85% browser support claimed)

Our stack is **WebGL2 + CPU sort** only. On thermally constrained phones, CPU sorting and fill-rate heavy alpha blending are common bottlenecks.

### 2. Streamed LOD + global splat budget

PlayCanvas **Streamed LOD** splits scenes into chunks with a manifest. The viewer loads coarse detail first, then refines. A **global splat budget** (e.g. ~1M on mobile) caps total Gaussians rendered regardless of scene size.

Virtual Soils loads a **single `.ksplat` file** per site (full scene into memory/GPU). We mitigate with alpha culling and lower DPR, not true LOD streaming.

### 3. SOG compression

PlayCanvas **SOG** is the recommended runtime format (~15–20× smaller than PLY, faster decode). Smaller downloads help mobile networks and time-to-first-frame.

We serve **`.ksplat`** (Kevin Kwok / mkkellogg format). It is compressed relative to raw `.splat`/PLY but is not the same as SOG or streamed LOD bundles.

### 4. Engine-level mobile guidance

PlayCanvas documents mobile-oriented defaults: disable AA, manage device pixel ratio, set splat budgets, prefer streamed assets for multi-million-Gaussian scenes.

We already cap DPR and offer mobile orbit UI, but the **renderer core** is less mobile-specialized.

---

## Why PlayCanvas might *not* be better (or not yet)

| Risk | Detail |
|------|--------|
| **Benchmark may not transfer** | Gains depend on splat count, SOG/streaming setup, and device WebGPU support. Small scenes or WebGL2-only fallback may show smaller wins. |
| **Asset pipeline migration** | Engine runtime expects **SOG** or **streamed LOD** (`lod-meta.json` + chunks), not `.ksplat`. `splat-transform` reads `.ksplat` but does **not** write it — conversion is one-way. All DynamoDB `File` URLs and upload workflows change. |
| **Integration cost** | Replacing `ThreeApp` touches viewer, editor, shared package, marker picking, and React lifecycle. High regression risk. |
| **Dual-stack period** | During migration, you may run two formats, two viewers, or re-export every scene. |
| **WebGPU variance** | Older phones / browsers fall back to WebGL2; benefit profile becomes closer to “well-tuned WebGL engine” vs “our Three.js stack.” |
| **Vendor concentration** | PlayCanvas SOG/streaming is powerful but more **platform-specific** than open PLY/ksplat + generic Three.js. |

---

## Customizability comparison

### Where PlayCanvas is stronger

- **Production-grade splat rendering** as a first-class engine feature (LOD, budgets, post effects, unified rendering)
- **SuperSplat Viewer** embed: URL params + **Experience Settings v2** JSON (tonemapping, bloom, cameras, animations, annotations) without building a renderer
- **Walk mode / collision / WebXR** (engine + SuperSplat ecosystem) if product roadmap needs them
- **Tooling**: SuperSplat Studio, `splat-transform`, HTML export, self-hosted viewer bundle

### Where Virtual Soils is stronger today

- **Tight integration with our product**: Leaflet map → inline viewer → same marker schema as admin
- **Custom admin Editor**: interactive marker placement, icon picker, persistence to **DynamoDB** via Lambda
- **Full UI ownership**: mobile toolbar, fly/orbit modes, sidebar, performance presets, back-to-map — all in our React/Three code
- **No dependency on SuperSplat Studio** for content updates

### Integration options (increasing effort)

```text
Option A — Embed SuperSplat Viewer (viewer app only)
  Pros: Fastest path to PlayCanvas perf + built-in annotation UI
  Cons: Hard to embed inside Leaflet inline viewer; limited Editor; separate settings.json contract

Option B — PlayCanvas Engine + custom scripts (full rewrite of ThreeApp)
  Pros: Keep React admin/viewer shells; use engine GSplat + annotation.mjs; best long-term perf
  Cons: Rebuild markers, controls, editor interaction; largest dev cost

Option C — Hybrid (PlayCanvas viewer route + keep Three.js editor temporarily)
  Pros: Phased migration; validate mobile on public viewer first
  Cons: Two render stacks to maintain; marker format may diverge

Option D — Stay on mkkellogg; optimize asset pipeline only
  Pros: Minimal code change; keep .ksplat
  Cons: Unlikely to match PlayCanvas WebGPU + streamed LOD ceiling on mobile
```

---

## Annotations vs Virtual Soils markers

### PlayCanvas annotations (SuperSplat / Experience Settings)

From [Annotations docs](https://developer.playcanvas.com/user-manual/supersplat/studio/annotations/):

| Field | Purpose |
|-------|---------|
| **Position** | 3D hotspot location |
| **Title / Text** | Short heading + body (HTML sanitized) |
| **Camera** | Pose the viewer animates to when selected |
| **Extras** | Optional metadata |

Visitor UX: markers on scene, **Previous / Next** tour navigator, click → camera fly + text overlay. Can set `startMode: "annotation"` for guided tour on load.

**Authoring:** SuperSplat Studio (hosted) or hand-edited Experience Settings JSON bundled with the viewer.

### PlayCanvas Engine annotations (custom apps)

The engine provides an [`annotation.mjs`](https://github.com/playcanvas/engine/pull/8202) script pattern: 3D hotspots, screen-space tooltips, click events, `worldToScreen` projection. Suitable if we rebuild on the engine and want **custom** UI while keeping hotspot behavior.

### Virtual Soils markers today

| Capability | Virtual Soils | PlayCanvas annotations |
|------------|---------------|------------------------|
| 3D position | ✅ | ✅ |
| Label / description | ✅ (`MarkerLabel`) | ✅ (title + text) |
| Camera pose on click | ✅ (`viewPosition`) | ✅ (camera field) |
| Custom icon per marker | ✅ (4 PNG icons) | ❌ (default hotspot UI) |
| Authored in admin Editor | ✅ | ❌ (Studio or JSON) |
| Stored in DynamoDB | ✅ | ❌ (settings file / Studio) |
| Guided prev/next tour | ❌ (individual click) | ✅ built-in |
| Saves with field CRUD | ✅ | ❌ |

**Conclusion:** PlayCanvas annotations are a good fit for **curated, publish-time tours** on static splat experiences. They do **not** replace the **admin marker editor + API persistence** without significant custom work (engine scripts + backend schema mapping).

Possible convergence: map DynamoDB markers → Experience Settings `annotations[]` at **build or publish time** for the viewer, while keeping the Editor as source of truth. That adds a transform layer and loses per-marker custom icons unless extended.

---

## File format impact

| Format | Virtual Soils today | PlayCanvas runtime |
|--------|---------------------|-------------------|
| `.ksplat` | ✅ primary CDN format | Input only via `splat-transform`; **not** native engine asset |
| `.ply` | supported by library | ✅ source / interchange |
| `.sog` | — | ✅ **recommended** runtime |
| Streamed LOD (`lod-meta.json` + chunks) | — | ✅ **recommended for mobile** at multi-M splats |

Example migration command (conceptual):

```bash
npm install -g @playcanvas/splat-transform
splat-transform input.ksplat output.sog
# For large mobile scenes: export streamed LOD folder + manifest
```

Implications:

- Re-export or batch-convert existing assets
- Update DynamoDB `File` URLs or add parallel SOG URLs
- CDN caching strategy applies to new file shapes (see [`SPLAT-CACHING.md`](./SPLAT-CACHING.md))
- Admin upload workflow may need SOG generation step

---

## Effort estimate (rough)

| Scope | Effort | Outcome |
|-------|--------|---------|
| **Proof of concept** — one scene in SuperSplat viewer, mobile side-by-side | 1–3 days | Data-driven go/no-go on perf claim |
| **Viewer-only embed** — replace public viewer splat canvas | 1–2 weeks | Better mobile view; editor unchanged; marker story incomplete |
| **Full engine migration** — replace `ThreeApp`, port editor | 4–8+ weeks | Maximum perf + custom features; highest risk |
| **Asset pipeline only** — SOG/streamed LOD, keep mkkellogg if compatible | N/A for PlayCanvas renderer | Would not use PlayCanvas renderer |

---

## Recommendation for stakeholders

1. **Validate the claim** before committing to a platform switch: pick one representative field (multi-million splat), convert to **SOG or streamed LOD**, host on assets CDN, compare on **target phones** against current viewer with the same scene.

2. **Separate two questions:**
   - *Renderer performance* → PlayCanvas is a credible upgrade path on mobile **if** you adopt SOG/streaming/WebGPU, not just swap npm packages.
   - *Annotations* → PlayCanvas offers polished **tour-style** annotations; Virtual Soils needs **admin-authored, database-backed** markers — overlap in UX, different in workflow. A hybrid (DynamoDB → settings export) is possible but not free.

3. **If mobile is the primary driver**, a phased approach is lowest risk:
   - Phase 1: SuperSplat viewer POC on `/viewer` standalone route
   - Phase 2: Asset pipeline to SOG/streamed LOD
   - Phase 3: Decide whether to port Editor or generate annotations from existing marker schema

4. **If customizability and editor workflow are primary**, staying on Three.js while adopting **PlayCanvas splat-transform for delivery formats** only is inconsistent (mkkellogg cannot consume SOG). The real choice is **full viewer stack** vs **incremental perf tuning** (budget: alpha threshold, DPR, scene size, CDN — already partially done).

---

## References

- [PlayCanvas — Gaussian Splatting](https://developer.playcanvas.com/user-manual/gaussian-splatting/)
- [PlayCanvas — Performance (splat budget, LOD)](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/performance/)
- [PlayCanvas — LOD streaming](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/unified-rendering/lod-streaming/)
- [PlayCanvas — Splat file formats](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/)
- [PlayCanvas — Annotations (SuperSplat)](https://developer.playcanvas.com/user-manual/supersplat/studio/annotations/)
- [PlayCanvas — Embedding SuperSplat Viewer](https://developer.playcanvas.com/user-manual/supersplat/viewer/embedding/)
- [splat-transform (GitHub)](https://github.com/playcanvas/splat-transform)
- [mkkellogg GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) — current library
