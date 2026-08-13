# Production viewer links (splats)

Template for documenting public PlayCanvas viewer URLs after Virtual Soils hosting is provisioned. Use for smoke tests, LMS embeds, and sharing.

**Warning:** This fork does not ship baked-in CloudFront or API hostnames. Set the variables below from your Terraform / hosting outputs before building this list. Running tools against unset URLs will fail.

---

## Domains (required)

Export these (or substitute manually) before generating links:

| Role | Env var | Production (Virtual Soils) |
|------|---------|----------------------------|
| Viewer | `VIEWER_SITE_URL` | `https://d2npz8tam2i8fl.cloudfront.net` |
| Assets (splats / LOD) | `ASSETS_CDN_URL` | `https://d3sni13yu1e7cb.cloudfront.net` |
| API | `VITE_PUBLIC_API_URL` | `https://5yfm4yfcq6.execute-api.ca-central-1.amazonaws.com` |

```bash
: "${VIEWER_SITE_URL:?error: set VIEWER_SITE_URL (viewer CloudFront HTTPS origin)}"
: "${ASSETS_CDN_URL:?error: set ASSETS_CDN_URL (assets CloudFront HTTPS origin)}"
: "${VITE_PUBLIC_API_URL:?error: set VITE_PUBLIC_API_URL (API Gateway base URL)}"
```

## URL pattern

```text
{VIEWER_SITE_URL}/viewer/?m={FieldID}
```

- `FieldID` comes from DynamoDB / `GET /fields` (not the splat file basename).
- `/?m={FieldID}` on the viewer root redirects to `/viewer/?m=…`.
- Disable ground height clamp on noisy scenes: append `&groundClamp=0`.
- Fly-mode scroll-wheel zoom (FOV) is **on** by default in desktop Fly mode; disable with `&flyZoom=0` if needed.

---

## Query parameters

All parameters below are read from the viewer URL query string (`?key=value`, chained with `&`). Only `m` (or `url`) is required — everything else is an optional override. Boolean-style flags accept common truthy/falsey tokens; unknown values fall back to the default. Parameters are parsed in `apps/viewer/src/PlayCanvasViewer.tsx` and the `packages/playcanvas-viewer/src/parse*.ts` helpers.

| Parameter | Possible values | Explanation |
|-----------|-----------------|-------------|
| `m` | Field ID string (e.g. `AW1`, `StsAiles_001`) | Selects the field to load from `GET /fields`. Primary way to open a scene. |
| `url` | Splat URL or path | Loads a splat directly, bypassing the field lookup. Used for local/ad-hoc previews. |
| `title` | Any string | Scene title shown in the UI. Only meaningful with `url` (fields supply their own title). |
| `location` | Any string | Scene location/subtitle shown in the UI. Only meaningful with `url`. |
| `startPos` | JSON array `[x,y,z]` (URL-encoded) | Overrides the initial camera/start position. Falls back to the field's `start_pos`, then the built-in default. |
| `orientation` | Number (degrees) — default `180` | Rotation applied about the X axis to align the splat. Non-numeric values fall back to `180`. |
| `groundClamp` / `heightClamp` | `0`, `false`, `off`, `no`, `disable`, `disabled` disable it | Ground height clamp is **on** by default; set either param to a falsey token to disable it on noisy heightmaps. |
| `flyZoom` | `0`, `false`, `off`, `no`, `disable`, `disabled` disable it | Scroll-wheel FOV zoom in **Fly** mode (changes lens FOV without moving the camera). **On** by default on desktop; Orbit-mode wheel dolly is unaffected. |
| `skybox` | `default` / `horizon` / `legacy` (default), `blue` / `solid` / `solidblue`, `infinite` / `cubemap` / `wrap` / `old` | Sky background mode. `default` = horizon fade, `blue` = solid blue surround, `infinite` = legacy wraparound cubemap. |
| `budget` | Number of millions (e.g. `5`, `5m`), or `0` / `off` / `none` / `unlimited` | Overrides the global splat budget (max Gaussians). `0`/`off`/etc. removes the cap (distance-LOD only). When set, the Quality preset no longer changes the budget. |
| `lod` | Integer ≥ 0 (e.g. `0`) | Locks streamed LOD to a single detail level for debugging. `0` = finest level only. |
| `fullSplat` | `1`, `true`, `yes`, `on` | Loads the legacy full `field.File` PLY through PlayCanvas (single splat, no streamed SOG) for A/B testing. |
| `heightmapDebug` | `1` / `true` / `yes` / `on` / `surface` / `mesh`, or `wire` / `wireframe` / `lines` | Shows the heightmap debug overlay — a translucent height-colored surface, or a wireframe. Off when absent/unknown. |
| `heightmapDebugOpacity` | Number in `(0, 1]` (e.g. `0.4`) | Overrides the surface opacity of the heightmap debug overlay. Ignored for wireframe mode. |
| `coordReadout` / `pickCoords` | `1`, `true`, `yes`, `on` | Enables the click-to-read world coordinate picker. |
| `renderer` | `legacy` | Loads the legacy Three.js viewer instead of PlayCanvas. Any other value keeps the default PlayCanvas renderer. |

**Legacy renderer only (`renderer=legacy`)** — the Three.js viewer additionally reads:

| Parameter | Possible values | Explanation |
|-----------|-----------------|-------------|
| `sh` | `0` (default), `1`, `2` | Spherical-harmonics degree used when rendering. Other values are treated as an error. |
| `markers` | JSON array (URL-encoded) | Marker definitions to render in the scene. |
| `sceneLocation` | Any string | Scene location; `location` is used as a fallback. |
| `description` | Any string | Scene description shown in the UI. |

---

## Admin editor query parameters

These parameters apply to the **admin editor** (marker manager / start-position tool), not the public viewer. They are parsed in `apps/admin/src/PlayCanvasEditor.tsx` and the legacy `apps/admin/src/EditorLegacy.tsx`. The editor opens either a saved field (`fieldId`) for management, or an ad-hoc splat (`url` / `gaussianPath` / `path`).

| Parameter | Possible values | Explanation |
|-----------|-----------------|-------------|
| `fieldId` | Field ID string (e.g. `AW1`) | Opens that field in management mode (loads and lets you edit its markers and start position). |
| `url` / `gaussianPath` / `path` | Splat URL or path | Opens an ad-hoc splat directly (checked in that order). Used when there's no saved field. |
| `controlMode` | `fly`, `orbit` | Initial camera control scheme. Default is `fly` in the PlayCanvas editor and `orbit` in the legacy editor; other values fall back to that default. |
| `flyZoom` | `0`, `false`, `off`, `no`, `disable`, `disabled` disable it | Scroll-wheel FOV zoom in **Fly** mode (changes lens FOV without moving the camera). **On** by default on desktop. |
| `orientation` | Number (degrees) — default `180` | Rotation about the X axis to align the splat. Non-numeric values fall back to `180`. |
| `title` | Any string | Scene title shown in the editor. Only meaningful with an ad-hoc `url`. |
| `location` | Any string | Scene location shown in the editor. Only meaningful with an ad-hoc `url`. |
| `markers` | JSON array (URL-encoded) | Pre-populates the editor with a set of markers (legacy editor, ad-hoc mode). |
| `marker` | JSON object (URL-encoded) | Pre-populates the editor with a single marker (legacy editor, ad-hoc mode). |
| `renderer` | `legacy` | Loads the legacy Three.js admin editor instead of the PlayCanvas editor. Any other value keeps the default. |

---

## Fields and viewer links

Production fields from `GET /fields` (refreshed 2026-07-23):

| Field ID | Name | Splat bundle (LOD) | Viewer |
|----------|------|--------------------|--------|
| AW1 | UBC Farm Agricultural Fields | `UBC_Farm_Agricultural` | https://d2npz8tam2i8fl.cloudfront.net/viewer/?m=AW1 |
| AW2 | UBC Farm Agricultural Fields 2 | `UBC_Farm_Agricultural` | https://d2npz8tam2i8fl.cloudfront.net/viewer/?m=AW2 |
| AW_3 | UBC Totem Field | `UBC_TotemField` | https://d2npz8tam2i8fl.cloudfront.net/viewer/?m=AW_3 |
| StsAiles_001 | Sts'Ailes Territory — Philips Arm Forest Garden | `PhilipsForestGarden_HighQuality_3SH` | https://d2npz8tam2i8fl.cloudfront.net/viewer/?m=StsAiles_001 |
| UM02 | University Manitoba Embankment | `UM02` | https://d2npz8tam2i8fl.cloudfront.net/viewer/?m=UM02 |
| UM_01 | Badger | `UM_ResearchStation_01_WebHigh` | https://d2npz8tam2i8fl.cloudfront.net/viewer/?m=UM_01 |
| UM_05 | University of Manitoba — Weather Station | `UM05_HighQuality_0SH_clean_2` | https://d2npz8tam2i8fl.cloudfront.net/viewer/?m=UM_05 |
| UM_05_old | University of Manitoba — Weather Station (legacy splat) | `UM05_HighQuality_0SH` | https://d2npz8tam2i8fl.cloudfront.net/viewer/?m=UM_05_old |

---

## Refresh this list

After adding fields in admin or changing CloudFront domains, re-fetch from the API:

```bash
: "${VIEWER_SITE_URL:?error: set VIEWER_SITE_URL}"
: "${VITE_PUBLIC_API_URL:?error: set VITE_PUBLIC_API_URL}"
node -e "const a=process.env.VITE_PUBLIC_API_URL.replace(/\\/\$/,''),v=process.env.VIEWER_SITE_URL.replace(/\\/\$/,'');fetch(a+'/fields').then(r=>r.json()).then(raw=>{(Array.isArray(raw)?raw:raw.items||[]).sort((x,y)=>String(x.FieldID).localeCompare(String(y.FieldID))).forEach(f=>console.log(f.FieldID,'|',f.Name,'|',v+'/viewer/?m='+encodeURIComponent(f.FieldID)));})"
```

Or run `npm run verify:fileplaycanvas` to confirm which fields have PlayCanvas LOD configured (API URL must be set in `.env`).

**Related:** [`DECOUPLED-APPS.md`](./DECOUPLED-APPS.md) (URL stability), [`DEPLOY-S3-CLOUDFRONT.md`](./DEPLOY-S3-CLOUDFRONT.md) (deploy / smoke test).
