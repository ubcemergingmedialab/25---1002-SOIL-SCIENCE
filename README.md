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

## AWS services (runtime dependencies)

Production runs entirely on AWS. The frontend apps are static sites; data and auth are backend services provisioned by Terraform.

| Service | Role |
|---------|------|
| **S3 + CloudFront** (×2) | Host viewer and admin SPAs (separate buckets and distributions) |
| **S3 + CloudFront** (assets) | Public splat/thumbnail files (`.ksplat`, images) |
| **API Gateway + Lambda** | REST API: public `/pins`, `/fields` and authenticated `/admin/api/*` |
| **DynamoDB** | Field/site records (locations, splat URLs, markers) |
| **Cognito** | Admin login only (Hosted UI + OAuth PKCE) |

Both apps call the **same API Gateway base URL** with different client env var names. Splats are loaded directly from the assets CDN, not through the API.

**Deploy runbook:** [`docs/DEPLOY-S3-CLOUDFRONT.md`](docs/DEPLOY-S3-CLOUDFRONT.md)  
**Splat CDN / caching:** [`docs/SPLAT-LOADING-AND-CACHING-RESOLUTION.md`](docs/SPLAT-LOADING-AND-CACHING-RESOLUTION.md)  
**Admin auth (aws-amplify client):** [`docs/AMPLIFY-AUTH.md`](docs/AMPLIFY-AUTH.md)

---

## Terraform / infrastructure

Infrastructure is **not defined in this repo**. It lives in the EML lab Terraform repo:

- **Project path:** `terraform-setup-template/projects/ubc-eml/virtual-soils/`
- **HCP Terraform workspace:** `ubc-eml-virtual-soils` (org **EML**)
- **Region / account:** `ca-central-1`, AWS account `940309384764`

Terraform provisions Cognito, DynamoDB, Lambda, API Gateway, assets bucket (+ CDN), and two static-site modules (viewer + admin S3/CloudFront). Application build env vars (`VITE_*`) come from HCP **outputs** after apply.

**HCP apply runbook:** `terraform-setup-template/docs/virtual-soils-hcp-deployment.md` (lab repo)  
**IAM policy templates:** `terraform-setup-template/docs/iam/` (lab repo)

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

Production deploy: build each app, `aws s3 sync` to the matching site bucket, CloudFront invalidation. See [`docs/DEPLOY-S3-CLOUDFRONT.md`](docs/DEPLOY-S3-CLOUDFRONT.md).

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

React 19, TypeScript, Vite 7, React Router 7, Three.js, `@mkkellogg/gaussian-splats-3d`, Leaflet. Admin auth uses the **`aws-amplify` npm client** against Cognito (not Amplify Hosting).
