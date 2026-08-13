# Deploy: two apps → two S3 buckets + CloudFront

This document describes how to deploy the **decoupled Virtual Soils frontend** (`apps/viewer` and `apps/admin`) to **separate S3 origin buckets**, each fronted by its **own CloudFront distribution**.

It replaces the previous single-app flow (one `dist/`, one site bucket, Amplify, or a combined build).

**Related docs**

- Production viewer URLs per field: [`VIEWER-SPLAT-LINKS.md`](./VIEWER-SPLAT-LINKS.md)
- App architecture: [`DECOUPLED-APPS.md`](./DECOUPLED-APPS.md)
- Terraform / HCP: use your Virtual Soils (or LSN) infrastructure repo — this app repo does not define AWS resources

---

## Target architecture

```text
                         ┌─────────────────────────────────────┐
                         │  API Gateway + Lambda (shared)      │
                         │  GET /pins, /fields, /admin/api/*   │
                         └──────────────┬──────────────────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          │                             │                             │
          ▼                             ▼                             ▼
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│ CloudFront       │         │ CloudFront       │         │ S3 assets bucket │
│ (viewer)         │         │ (admin)          │         │ (splats, public  │
│                  │         │                  │         │  read via policy)│
└────────┬─────────┘         └────────┬─────────┘         └────────▲─────────┘
         │ OAC                        │ OAC                         │
         ▼                            ▼                             │ GET (browser)
┌──────────────────┐         ┌──────────────────┐                    │
│ S3 viewer-site   │         │ S3 admin-site    │                    │
│ apps/viewer/dist │         │ apps/admin/dist  │                    │
└──────────────────┘         └──────────────────┘                    │
         │                            │                              │
         │  VITE_PUBLIC_API_URL       │  VITE_ADMIN_API_URL          │
         │  (no Cognito)                │  + Cognito Hosted UI         │
         └────────────────────────────┴──────────────────────────────┘
```

| Surface | App folder | S3 bucket (example name) | CloudFront URL role |
|---------|------------|--------------------------|---------------------|
| Public viewer | `apps/viewer` | `VIEWER_SITE_BUCKET` (your Terraform output) | Map / viewer experience |
| Admin + editor | `apps/admin` | `ADMIN_SITE_BUCKET` (your Terraform output) | Cognito login, CRUD, editor |

Both apps call the **same API Gateway base URL** today. They use different env var names (`VITE_PUBLIC_API_URL` vs `VITE_ADMIN_API_URL`) so CI can inject the same endpoint without sharing a single `.env` shape.

Splats and thumbnails stay in the **assets bucket** (separate from either site bucket). DynamoDB `File` / `Thumbnail` fields should use HTTPS object URLs from that bucket.

---

## Prerequisites

### 1. Terraform: two static-site modules

The lab stack currently provisions **one** `s3-static-site` module (`module.site`). For this deploy model, extend `projects/<your-project>/main.tf` with **two instances** of `modules/s3-static-site`:

```hcl
module "viewer_site" {
  count  = var.enable_static_site ? 1 : 0
  source = "../../../modules/s3-static-site"

  name_prefix          = local.name_prefix
  bucket_name_suffix   = "viewer"
  spa_routing          = true
  cors_allowed_origins = var.cors_allow_origins
}

module "admin_site" {
  count  = var.enable_static_site ? 1 : 0
  source = "../../../modules/s3-static-site"

  name_prefix          = local.name_prefix
  bucket_name_suffix   = "admin"
  spa_routing          = true
  cors_allowed_origins = var.cors_allow_origins
}
```

Add matching **outputs** (viewer and admin each need bucket name, distribution ID, and HTTPS URL). Example names:

| HCP output | Use |
|------------|-----|
| `viewer_site_url` | Public viewer URL |
| `viewer_site_bucket_name` | `aws s3 sync` target for viewer |
| `viewer_cloudfront_distribution_id` | Invalidation after viewer deploy |
| `admin_site_url` | Admin app URL; Cognito callback/logout |
| `admin_site_bucket_name` | `aws s3 sync` target for admin |
| `admin_cloudfront_distribution_id` | Invalidation after admin deploy |
| `api_endpoint` | Same API for both build env vars |

Apply in HCP after merge. Retire or repurpose the old single `module.site` once traffic moves (avoid two viewer distributions long term).

### 2. Cognito callback / logout URLs

Cognito Hosted UI URLs must list **only the admin CloudFront origin** (plus local dev), not the viewer.

Update `terraform.auto.tfvars` in the lab repo:

```hcl
cognito_callback_urls = [
  "http://localhost:5174/",           # admin dev (see below)
  "https://ADMIN_CLOUDFRONT_DOMAIN/", # trailing slash matches auth.ts default
]

cognito_logout_urls = [
  "http://localhost:5174/",
  "https://ADMIN_CLOUDFRONT_DOMAIN/",
]
```

Re-apply Terraform after the admin distribution exists.

### 3. API Gateway and assets CORS

`cors_allow_origins` in Terraform must include **both** CloudFront HTTPS origins and both localhost dev ports:

```hcl
cors_allow_origins = [
  "http://localhost:5173",              # viewer dev
  "http://localhost:5174",              # admin dev
  "https://VIEWER_CLOUDFRONT_DOMAIN",
  "https://ADMIN_CLOUDFRONT_DOMAIN",
]
```

The assets bucket module uses the same list for splat fetches from the browser.

### 4. GitHub / CI deploy IAM role

Use a **narrow deploy role** (not `HCPTerraform`). Extend the lab policy template `docs/iam/github-deploy-policy.json` to cover **both** site bucket name patterns, for example:

- `arn:aws:s3:::your-virtual-soils-viewer-site-*`
- `arn:aws:s3:::your-virtual-soils-admin-site-*`
- `cloudfront:CreateInvalidation` on both distribution ARNs (or scoped `distribution/*` in account)

Wire GitHub Actions OIDC to this role per org/repo conventions.

---

## Build-time environment variables

Vite bakes env vars into the bundle at **build** time. Set them in CI (or a local `.env` in each app directory) before `npm run build`.

### Viewer (`apps/viewer`)

| Variable | Value |
|----------|--------|
| `VITE_PUBLIC_API_URL` | HCP `api_endpoint` (no trailing slash) |

No Cognito variables on the viewer build.

### Admin (`apps/admin`)

| Variable | Value |
|----------|--------|
| `VITE_ADMIN_API_URL` | HCP `api_endpoint` |
| `VITE_COGNITO_USER_POOL_ID` | HCP `cognito_user_pool_id` |
| `VITE_COGNITO_CLIENT_ID` | HCP `cognito_user_pool_client_id` |
| `VITE_COGNITO_DOMAIN` | HCP `cognito_hosted_ui_domain` (hostname only) |
| `VITE_COGNITO_OAUTH_DOMAIN` | Same hostname (used by logout URL helper in `@soil/shared/lib/env`) |

Optional:

| Variable | When |
|----------|------|
| `VITE_APP_ORIGIN` | Fixed OAuth logout redirect when not using `window.location.origin` |
| `VITE_COGNITO_REDIRECT_SIGN_IN` | Extra callback URLs (comma-separated full URLs) |
| `VITE_COGNITO_REDIRECT_SIGN_OUT` | Extra logout URLs |

---

## Local development (mirrors production split)

Run from repo root after `npm install`:

```bash
npm run dev:viewer   # http://localhost:5173
npm run dev:admin    # http://localhost:5174  (recommended; set in vite if still 5173)
```

Use separate env files so each app picks up the right variables:

- `apps/viewer/.env`
- `apps/admin/.env`

Alternatively, set `envDir` in both `vite.config.ts` files to the repo root and maintain one `.env` with all keys.

---

## Manual deploy (first time or debugging)

Run from the **repository root** so workspaces resolve `@soil/shared`. Preferred: use the root deploy scripts. They load deploy targets from repo-root `.env` (see `.env.example`) and **fail fast** if required variables are still missing:

```bash
# Build-time (Vite) + deploy targets — set in .env at repo root
# VITE_PUBLIC_API_URL=...
# VIEWER_SITE_BUCKET=...
# VIEWER_CLOUDFRONT_DISTRIBUTION_ID=...
# ADMIN_SITE_BUCKET=...
# ADMIN_CLOUDFRONT_DISTRIBUTION_ID=...

./deploy_viewer.sh
./deploy_admin.sh
```

Exported shell variables override `.env` when both are set.

### Viewer (explicit commands)

```bash
export VITE_PUBLIC_API_URL="https://YOUR_API.execute-api.ca-central-1.amazonaws.com"
: "${VIEWER_SITE_BUCKET:?error: set VIEWER_SITE_BUCKET}"
: "${VIEWER_CLOUDFRONT_DISTRIBUTION_ID:?error: set VIEWER_CLOUDFRONT_DISTRIBUTION_ID}"

npm ci
npm run build:viewer

aws s3 sync apps/viewer/dist/ "s3://${VIEWER_SITE_BUCKET}/" --delete

aws cloudfront create-invalidation \
  --distribution-id "$VIEWER_CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*"
```

### Admin (explicit commands)

```bash
export VITE_ADMIN_API_URL="https://YOUR_API.execute-api.ca-central-1.amazonaws.com"
export VITE_COGNITO_USER_POOL_ID="ca-central-1_..."
export VITE_COGNITO_CLIENT_ID="..."
export VITE_COGNITO_DOMAIN="....auth.ca-central-1.amazoncognito.com"
export VITE_COGNITO_OAUTH_DOMAIN="$VITE_COGNITO_DOMAIN"
: "${ADMIN_SITE_BUCKET:?error: set ADMIN_SITE_BUCKET}"
: "${ADMIN_CLOUDFRONT_DISTRIBUTION_ID:?error: set ADMIN_CLOUDFRONT_DISTRIBUTION_ID}"

npm ci
npm run build:admin

aws s3 sync apps/admin/dist/ "s3://${ADMIN_SITE_BUCKET}/" --delete

aws cloudfront create-invalidation \
  --distribution-id "$ADMIN_CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*"
```

**Notes**

- `--delete` removes stale hashed assets from prior deploys; required for correct caching behavior.
- Both buckets are **private**; CloudFront OAC is the only public read path (same as the existing `s3-static-site` module).
- Site buckets are for HTML/JS/CSS only. Do not sync splats into site buckets; keep them in `assets_bucket_name`.

---

## Recommended CI/CD (GitHub Actions)

Use **two jobs** (or a matrix) so viewer and admin deploy independently when their paths change.

```text
on: push to main (paths: apps/viewer/**, apps/admin/**, packages/shared/**)

job deploy-viewer:
  - checkout
  - npm ci
  - build viewer with VITE_PUBLIC_API_URL from GitHub Environment secrets
  - aws s3 sync apps/viewer/dist → viewer bucket
  - cloudfront invalidation (viewer distribution id)

job deploy-admin:
  - checkout
  - npm ci
  - build admin with Cognito + VITE_ADMIN_API_URL secrets
  - aws s3 sync apps/admin/dist → admin bucket
  - cloudfront invalidation (admin distribution id)
```

**Path filters:** Changes under `packages/shared` should trigger **both** jobs because both apps import it.

**Credentials:** Prefer OIDC (`aws-actions/configure-aws-credentials`) with the deploy IAM role. Do not store long-lived access keys in the repo.

**GitHub Environments:** Use a `production` environment with required reviewers if desired. Store HCP-derived values as environment variables or secrets once after each infra apply.

---

### Post-deploy smoke test

### Viewer CloudFront URL

1. Open `https://VIEWER_DOMAIN/viewer/?m=KNOWN_FIELD_ID`.
2. Confirm PlayCanvas splat loads (Network: `lod-meta.json` and LOD chunks return 200 from assets CDN).
3. Confirm markers appear and fly-to works from the sidebar.
4. Optional legacy check: same URL with `&renderer=legacy` loads `.ksplat` via Three.js.
5. Confirm `GET {api}/pins` succeeds (no Cognito).
6. Bookmark alias: `/viewer-pc/?m=…` redirects to `/viewer/?m=…`.

### Admin CloudFront URL

1. Open `https://ADMIN_DOMAIN/` → redirect to Cognito → return logged in.
2. List fields in Admin UI (`GET {api}/admin/api/fields` with Bearer token).
3. Open **Manage markers** for a field with `FilePlayCanvas` → `/editor?fieldId=…` loads PlayCanvas LOD (`lod-meta.json` + chunks).
4. **Place mode:** set placement distance, icon, title → place marker → **Set View Position** → save.
5. **Edit mode:** select marker → drag RGB gizmo or edit coordinates → save.
6. **Start position:** drag the large scene axes → save → open public viewer and confirm orbit pivot / reset camera.
7. Reload editor → markers and `start_pos` persist; open `/viewer/?m={FieldID}` and confirm no coordinate drift.
8. Optional legacy check: same field with `&renderer=legacy` loads `.ksplat` via Three.js editor.

### Cognito

- Callback URL in the browser after login must exactly match an entry in `cognito_callback_urls`.
- Logout must return to an entry in `cognito_logout_urls`.

---

## Migration checklist (from single site / Amplify)

1. [ ] Add second `s3-static-site` module + outputs in lab Terraform; apply in HCP.
2. [ ] Update `cors_allow_origins` and Cognito URLs for **two** CloudFront domains.
3. [ ] Create GitHub deploy IAM role with access to both buckets + invalidations.
4. [ ] Add GitHub Actions workflows (or run manual deploy once).
5. [ ] Deploy **admin** first; verify Cognito login on admin URL.
6. [ ] Deploy **viewer**; verify public routes and splats.
7. [ ] Update any bookmarks / DNS from old single CloudFront URL or Amplify.
8. [ ] Remove or disable old Amplify app(s) and unused `module.site` after cutover.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| 403 on splat URL | Assets bucket missing public-read policy or wrong bucket URL in DynamoDB |
| CORS error on API | Viewer or admin CloudFront origin missing from `cors_allow_origins` |
| Cognito `redirect_mismatch` | Admin URL not in `cognito_callback_urls`, or wrong path/trailing slash |
| Admin loads but API 401 | Wrong pool/client IDs in build env, or token not sent (check `adminApi.ts`) |
| Viewer shows blank after deploy | Forgot CloudFront invalidation, or synced to wrong bucket |
| Old UI after deploy | Invalidation pending, or browser cache; hard refresh or wait ~1–2 min |
| `VITE_*` undefined in prod | Built without env vars in CI; rebuild with secrets set |

---

## Summary

| Step | Owner | Action |
|------|--------|--------|
| Infra | Lab Terraform / HCP | Two `s3-static-site` modules, outputs, Cognito + CORS URLs |
| Build | App repo CI | `npm run build:viewer` / `build:admin` with per-app `VITE_*` |
| Publish | App repo CI | `aws s3 sync` to respective bucket + CloudFront invalidation |
| Assets | Manual / separate process | Splats in assets bucket; URLs in DynamoDB |

The viewer and admin apps share code via `@soil/shared` but deploy as **independent static sites** on **independent S3 + CloudFront pairs**, both talking to the same backend API.
