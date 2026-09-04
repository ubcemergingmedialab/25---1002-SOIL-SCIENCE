# Virtual Soils

Web application for exploring 3D Gaussian splat reconstructions of soil and landscape sites. Users browse locations on an interactive map (Leaflet), open an embedded 3D viewer, and (for authorized users) manage sites and in-scene markers via an admin panel and editor.

---

## Repository layout

This monorepo contains **two decoupled frontend apps** and one shared package. They build and deploy independently but share Three.js viewer code and types.

```text
apps/
  viewer/    Public map + 3D viewer (no auth)
  admin/     Admin panel + marker editor (Cognito)

packages/
  shared/    Types, utils, Three.js / splat runtime

backend/     Legacy Node server (not used in current AWS deployment)
```

| App | URL (local) | Auth | API env var |
|-----|-------------|------|-------------|
| Viewer | `http://localhost:5173` | None | `VITE_PUBLIC_API_URL` |
| Admin | `http://localhost:5174` | Cognito Hosted UI | `VITE_ADMIN_API_URL` + `VITE_COGNITO_*` |

**Architecture details:** [`docs/DECOUPLED-APPS.md`](docs/DECOUPLED-APPS.md)

---

## PlayCanvas migration (in progress)

We are moving the splat renderer from **`@mkkellogg/gaussian-splats-3d` + Three.js** to the **[PlayCanvas Engine](https://developer.playcanvas.com/user-manual/gaussian-splatting/)** (`@playcanvas/engine`) for better mobile performance (WebGPU, streamed LOD). This is a **client renderer swap only** — hosting stays **S3 + CloudFront**, data stays **DynamoDB + Lambda**, auth unchanged.

**Approach:** Engine-first (PlayCanvas inside our Vite apps), not the SuperSplat Viewer embed.

### URL stability (external integrations)

**Viewer links and asset URLs must stay stable** unless a deliberate migration replaces them. A class site and other partners embed:

- **Viewer:** `https://{viewer_domain}/viewer/?m={FieldID}` (also supported: `/?m={FieldID}` → redirects to `/viewer/`)
- **Assets:** DynamoDB `File` URLs on the assets CDN (`.ksplat` / `.splat` today)

During PlayCanvas migration:

- Keep **`FieldID`** values unchanged (`AW2`, `UM_05`, etc.).
- Keep **assets CDN hostname and `File` paths** serving legacy splats until an agreed cutover (Phase 7).
- Add **`FilePlayCanvas`** under new prefixes (`splats/lod/…`) without breaking existing `File` links.
- Do **not** rename S3 keys, change CloudFront domains, or repoint `File` without coordinating embed owners.

| | Today (production) | Target |
|--|-------------------|--------|
| Viewer / editor renderer | PlayCanvas Engine (viewer + editor) | PlayCanvas Engine |
| Splat format | Streamed LOD (`lod-meta.json` + chunks) | Streamed LOD |
| DynamoDB `File` | Legacy `.ksplat` URL (legacy viewer only) | PlayCanvas URL at cutover (Phase 7) |
| DynamoDB `FilePlayCanvas` | Populated for migrated fields | All fields; default viewer reads this |

### Done so far

- **Evaluation & plan** — tradeoffs, phased migration, engine-first decision ([`docs/PLAYCANVAS-SPLAT-EVALUATION.md`](docs/PLAYCANVAS-SPLAT-EVALUATION.md), [`docs/PLAYCANVAS-MIGRATION-PLAN.md`](docs/PLAYCANVAS-MIGRATION-PLAN.md))
- **Conversion tooling** — [`scripts/splat/README.md`](scripts/splat/README.md) (`@playcanvas/splat-transform`: `.ksplat` → streamed LOD)
- **Assets on CDN** — production splats converted to streamed LOD and uploaded to the assets bucket (alongside existing `.ksplat` files)
- **DynamoDB** — `FilePlayCanvas` and `FileFormat` added on field records (e.g. `streamed-lod` manifest URL)
- **API (code)** — Lambda `/pins` exposes `FilePlayCanvas` / `FileFormat`; `/fields` and `/fields/{id}` pass them through from DynamoDB ([`lambda-handler.mjs`](lambda-handler.mjs) + lab repo `lambda/handler.mjs`)
- **App types** — `Field`, `Pin`, and `publicApi.ts` updated to carry PlayCanvas fields
- **PlayCanvas viewer** — `/viewer/` loads `FilePlayCanvas` via `@soil/playcanvas-viewer` ([`apps/viewer/src/PlayCanvasViewer.tsx`](apps/viewer/src/PlayCanvasViewer.tsx))
- **Dev harness** — `/viewer-pc-dev/` field picker + local `?url=` testing ([`apps/viewer/src/PlayCanvasSmoke.tsx`](apps/viewer/src/PlayCanvasSmoke.tsx))
- **Viewer cutover (Phase 5)** — `/viewer/?m=` is PlayCanvas by default; `?renderer=legacy` for Three.js fallback; `/viewer-pc/` redirects to `/viewer/`
- **Editor cutover (Phase 6.8)** — `/editor?fieldId=` is PlayCanvas by default; `?renderer=legacy` for Three.js fallback

### PlayCanvas viewer

1. Ensure repo root `.env` has `VITE_PUBLIC_API_URL` (same as legacy viewer).
2. `npm install` then `npm run dev:viewer`
3. **Production route:** **http://localhost:5173/viewer/?m={FieldID}**
4. **Dev harness** (field picker, local bundles): **http://localhost:5173/viewer-pc-dev/**
5. **Local LOD bundle** (dev server only): `http://localhost:5173/viewer/?url=/work-out/{basename}/lod-meta.json`
6. **Legacy fallback:** `http://localhost:5173/viewer/?m={FieldID}&renderer=legacy`
7. **Orientation:** viewer applies **180° X by default** (matches legacy mkkellogg flip). Override with `?orientationX=0` (and optionally `orientationY` / `orientationZ`) for raw LOD testing.
8. **Markers:** loaded from the same `/fields/{id}` API as legacy viewer; sidebar list + 3D hotspots (click hotspot for title/description tooltip).

### PlayCanvas editor

1. `npm run dev:admin` → **http://localhost:5174/editor?fieldId={FieldID}**
2. **Legacy fallback:** `http://localhost:5174/editor?fieldId={FieldID}&renderer=legacy`
3. Requires `FilePlayCanvas` on the field (streamed LOD). Fields missing it show an error with a link to the legacy editor.

**Batch conversion** runs PlayCanvas-safe cleanup automatically (invalid scales + distant position outliers). See [`scripts/splat/README.md`](scripts/splat/README.md).

**What to verify per field:** manifest and chunks load (no CORS/network errors), splat appears, orbit/pan works, orientation matches legacy, acceptable quality on mobile.

### Still needed (Phase 1 close-out)

- [ ] **Deploy Lambda** — HCP Terraform apply so live `/pins` returns the new fields
- [ ] **Backfill** — confirm every production field has `FilePlayCanvas` + `FileFormat` in DynamoDB
- [ ] **CDN checks** — `Cache-Control` on LOD chunk objects; CORS from viewer/admin origins ([`docs/SPLAT-CACHING.md`](docs/SPLAT-CACHING.md))
- [ ] **Smoke all fields** — run harness for each `FieldID`; record orientation fixes and any broken manifests
- [ ] **Regression** — current `/viewer` and admin editor still work on `.ksplat` / `File`

### Next up (Phase 2+)

- [x] **`packages/playcanvas-viewer`** — `createPlayCanvasApp` wrapper (`loadScene`, camera, dispose)
- [x] **Parallel `/viewer-pc` route** — now redirects to `/viewer/` (bookmark compatibility)
- [x] **Markers (Phase 3)** — DynamoDB markers → PlayCanvas annotations + sidebar fly-to
- [x] **Viewer cutover (Phase 5)** — `/viewer/` default PlayCanvas; `?renderer=legacy` fallback
- [x] **Editor cutover (Phase 6.8)** — `/editor` default PlayCanvas; `?renderer=legacy` fallback
- [ ] **Deploy viewer + admin** to CloudFront and QA all fields on mobile
- [ ] **Retire mkkellogg** — remove Three.js splat stack and `.ksplat` URLs (Phase 7)

**Checklist:** [`docs/PLAYCANVAS-PHASE-0-1-TODOS.md`](docs/PLAYCANVAS-PHASE-0-1-TODOS.md)

---

## AWS services (runtime dependencies)

Production runs entirely on AWS. The frontend apps are static sites; data and auth are backend services provisioned by Terraform.

| Service | Role |
|---------|------|
| **S3 + CloudFront** (×2) | Host viewer and admin SPAs (separate buckets and distributions) |
| **S3 + CloudFront** (assets) | Splat/thumbnail files (`.ksplat` today; streamed PlayCanvas LOD on same CDN) |
| **API Gateway + Lambda** | REST API: public `/pins`, `/fields` and authenticated `/admin/api/*` |
| **DynamoDB** | Field/site records (locations, splat URLs, markers) |
| **Cognito** | Admin login only (Hosted UI + OAuth PKCE) |

Both apps call the **same API Gateway base URL** with different client env var names. Splats are loaded directly from the assets CDN, not through the API.

**Deploy runbook:** [`docs/DEPLOY-S3-CLOUDFRONT.md`](docs/DEPLOY-S3-CLOUDFRONT.md)  
**Splat CDN / caching:** [`docs/SPLAT-LOADING-AND-CACHING-RESOLUTION.md`](docs/SPLAT-LOADING-AND-CACHING-RESOLUTION.md)  
**Admin auth (aws-amplify client):** [`docs/AMPLIFY-AUTH.md`](docs/AMPLIFY-AUTH.md)

---

## Terraform / infrastructure

Infrastructure is **not defined in this repo**. Provision Cognito, DynamoDB, Lambda, API Gateway, an assets bucket (+ CDN), and two static-site modules (viewer + admin S3/CloudFront) under **your** AWS account / Terraform workspace. Application build env vars (`VITE_*`) and deploy env vars (`VIEWER_SITE_BUCKET`, `ADMIN_SITE_BUCKET`, distribution IDs, `ASSETS_BUCKET`) must be supplied from those outputs — this fork ships with **no** baked-in legacy hosting IDs.

If a required variable is missing, deploy and upload scripts **exit with an error** naming the variable.

Typical outputs used by this app:

| HCP output | Used for |
|------------|----------|
| `api_endpoint` | `VITE_PUBLIC_API_URL`, `VITE_ADMIN_API_URL` |
| `viewer_site_url`, `viewer_site_bucket_name`, `viewer_cloudfront_distribution_id` | Viewer deploy |
| `admin_site_url`, `admin_site_bucket_name`, `admin_cloudfront_distribution_id` | Admin deploy + Cognito URLs |
| `assets_cdn_url`, `assets_bucket_name` | Splats in DynamoDB `File` / `Thumbnail` |
| `cognito_user_pool_id`, `cognito_user_pool_client_id`, `cognito_hosted_ui_domain` | Admin build |

---

## Local development

```bash
npm install
cp .env.example .env   # fill from HCP Terraform outputs
```

Run one or both apps:

```bash
npm run dev:viewer   # http://localhost:5173
npm run dev:admin    # http://localhost:5174
```

Vite loads env from the **repo root** (`.env`). See [`.env.example`](.env.example) for required variables.

| Variable | App | HCP output |
|----------|-----|------------|
| `VITE_PUBLIC_API_URL` | Viewer | `api_endpoint` |
| `VITE_ADMIN_API_URL` | Admin | `api_endpoint` |
| `VITE_COGNITO_USER_POOL_ID` | Admin | `cognito_user_pool_id` |
| `VITE_COGNITO_CLIENT_ID` | Admin | `cognito_user_pool_client_id` |
| `VITE_COGNITO_OAUTH_DOMAIN` | Admin | `cognito_hosted_ui_domain` |

Cognito callback/logout URLs in Terraform must include `http://localhost:5174/` (admin dev) and the admin CloudFront URL with a trailing slash.

---

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev:viewer` | Viewer dev server (port 5173) |
| `npm run dev:admin` | Admin dev server (port 5174) |
| `npm run dev` | Alias for `dev:viewer` |
| `npm run build` | Build both apps |
| `npm run build:viewer` | Build viewer → `apps/viewer/dist` |
| `npm run build:admin` | Build admin → `apps/admin/dist` |
| `npm run typecheck` | TypeScript project references |
| `npm run lint` | ESLint |

Production deploy reads deploy targets from repo-root `.env` (see [`.env.example`](.env.example)):

```bash
# In .env:
# VIEWER_SITE_BUCKET=...
# VIEWER_CLOUDFRONT_DISTRIBUTION_ID=...

./deploy_viewer.sh
./deploy_admin.sh
```

Shell exports still override `.env` when both are set.

See [`docs/DEPLOY-S3-CLOUDFRONT.md`](docs/DEPLOY-S3-CLOUDFRONT.md).

---

## Documentation

| Doc | Contents |
|-----|----------|
| [`docs/DECOUPLED-APPS.md`](docs/DECOUPLED-APPS.md) | Two-app architecture, routes, API clients, deploy overview |
| [`docs/DEPLOY-S3-CLOUDFRONT.md`](docs/DEPLOY-S3-CLOUDFRONT.md) | S3/CloudFront deploy, Cognito/CORS checklist, CI/CD |
| [`docs/AMPLIFY-AUTH.md`](docs/AMPLIFY-AUTH.md) | Cognito OAuth via `aws-amplify` (admin only) |
| [`docs/PLAYCANVAS-SPLAT-EVALUATION.md`](docs/PLAYCANVAS-SPLAT-EVALUATION.md) | PlayCanvas vs current splat viewer (mobile, annotations, tradeoffs) |
| [`docs/PLAYCANVAS-MIGRATION-PLAN.md`](docs/PLAYCANVAS-MIGRATION-PLAN.md) | Phased plan to transition to PlayCanvas |
| [`docs/PLAYCANVAS-PHASE-0-1-TODOS.md`](docs/PLAYCANVAS-PHASE-0-1-TODOS.md) | Phase 0 & 1 checklist |
| [`scripts/splat/README.md`](scripts/splat/README.md) | Convert `.ksplat` → SOG / streamed LOD |
| [`docs/PROJECT.md`](docs/PROJECT.md) | Feature-level app behavior (some sections predate decoupling) |
| [`docs/SPLAT-CACHING.md`](docs/SPLAT-CACHING.md) | S3 `Cache-Control` for splat objects |
| [`docs/virtual-soils-scope.md`](docs/virtual-soils-scope.md) | Product scope and roadmap |
| [`docs/eml-context.md`](docs/eml-context.md) | EML project context |

---

## Tech stack (summary)

React 19, TypeScript, Vite 7, React Router 7, Leaflet. **Splat rendering:** production uses Three.js + `@mkkellogg/gaussian-splats-3d`; **in migration** to `@playcanvas/engine` (see above). Admin auth uses the **`aws-amplify` npm client** against Cognito (not Amplify Hosting).
