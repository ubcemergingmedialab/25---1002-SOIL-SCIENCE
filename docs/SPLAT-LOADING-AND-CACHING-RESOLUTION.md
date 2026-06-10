# Splat loading and caching — how we fixed it

This document records the **problem**, **diagnosis**, and **resolution** for Virtual Soils splat performance after migrating assets to AWS (`ubc-eml-virtual-soils-prod-assets-*`). It is the team runbook for “we fixed slow loads and refresh re-downloads” — not a generic caching tutorial.

**Related**

- [`SPLAT-CACHING.md`](./SPLAT-CACHING.md) — ongoing reference (headers, invalidation, troubleshooting)
- [`DEPLOY-S3-CLOUDFRONT.md`](./DEPLOY-S3-CLOUDFRONT.md) — viewer/admin site deploy
- Lab Terraform: `terraform-setup-template/projects/ubc-eml/virtual-soils/` + `modules/s3-assets-bucket`

---

## Symptoms we saw

| Symptom | When |
|---------|------|
| Splats took **~60s+** to become usable | After moving files to S3 (`…s3.ca-central-1.amazonaws.com/splats/…`) |
| Previously **&lt;30s** on legacy CDN (`virtualsoils.ca/cdn/…`) | Same scenes, older hosting |
| **Full re-download** on every browser refresh | Network tab showed large transfers again, not `(disk cache)` |
| Confusion with **CloudFront invalidation** | `arguments are required: paths` when running the wrong CLI command |

The viewer UI **always** shows a loading state on refresh (GPU re-processes the scene). The fix targets **network** time and **edge/browser cache**, not eliminating the overlay.

---

## Root causes (confirmed)

1. **Direct S3 regional URLs** — No CloudFront edge cache; every client hit `ca-central-1` only. Legacy URLs used a CDN hostname.

2. **Missing or weak `Cache-Control`** on objects — Browsers did not retain splat bytes across refreshes, especially with progressive loading.

3. **Progressive `.ksplat` loading** — `GaussianViewer` uses `progressiveLoad: true` (many **Range** requests). Range responses cache poorly on raw S3 compared to a single full GET or a CDN in front.

4. **Cross-origin fetches** — App on viewer CloudFront, splats on S3 → CORS + cache behavior both matter.

5. **Optional contributors** — Large `.splat` vs compressed `.ksplat`; parallel downloads (4K HDR skybox from the app origin) competing for bandwidth.

---

## What fixed it (production shape)

The working stack combines **infrastructure** and **object metadata**:

| Step | What | Why it mattered |
|------|------|-----------------|
| 1 | **Assets CloudFront CDN** (`enable_assets_cdn = true` on `module.assets`) | Edge caching, better Range handling, same pattern as site bucket |
| 2 | **`Cache-Control` on splat objects** | Browser and CloudFront can cache bytes between visits |
| 3 | **DynamoDB URLs use CDN hostname** | `File` / `Thumbnail` point at `assets_cdn_url`, not direct S3 |
| 4 | (Later) **`assets_enable_public_read = false`** | Lock down direct S3 after all URLs migrated |

**Example URL change**

```text
Before: https://ubc-eml-virtual-soils-prod-assets-078d04.s3.ca-central-1.amazonaws.com/splats/UBC_TotemField.ksplat
After:  https://{assets_cloudfront_domain}/splats/UBC_TotemField.ksplat
```

Path stays the same (`/splats/…`); only the hostname changes. No app code change required.

---

## Process we followed (repeatable)

### Phase A — Diagnose

1. Open **DevTools → Network** on a slow load; filter by splat filename.
2. Note **total MB transferred** on second normal refresh (not hard refresh).
3. Check whether time is spent on **Downloading** vs **Processing** in the viewer overlay.
4. Run `curl -I` on the splat URL — confirm presence of `Cache-Control`.

**Interpretation**

- Large transfer every refresh → HTTP/cache/origin problem (this doc).
- `(disk cache)` but slow UI → decode/GPU only (expected on full page reload).

### Phase B — Quick wins on S3 (can do before CDN)

Set long-lived cache headers on existing objects (PowerShell, one line):

```powershell
aws s3 cp s3://ubc-eml-virtual-soils-prod-assets-078d04/splats/ s3://ubc-eml-virtual-soils-prod-assets-078d04/splats/ --recursive --metadata-directive REPLACE --cache-control "public, max-age=31536000, immutable" --region ca-central-1
```

**Do not** use `aws cloudfront create-invalidation` for this — that command needs `--paths` and only affects CloudFront distributions, not S3 metadata.

See [`SPLAT-CACHING.md`](./SPLAT-CACHING.md) for single-file uploads and verification.

### Phase C — Terraform: assets CloudFront (main fix)

Implemented in lab repo `modules/s3-assets-bucket`:

- CloudFront distribution + **OAC** on the existing assets bucket
- Bucket policy: CloudFront read (+ optional public read during migration)
- Managed policies (hardcoded IDs — no plan-time `ListCachePolicies`):
  - Cache: `Managed-CachingOptimized` → `658327ea-f89d-4fab-a63d-7e88639e58f6`
  - Origin request: `Managed-AllViewerExceptHostHeader` → `b689b0a8-53d0-40ab-baf2-68738e2966ac` (forwards `Origin` and `Range` for CORS + progressive `.ksplat`)

Project settings (`terraform.auto.tfvars`):

```hcl
enable_assets_cdn          = true
assets_enable_public_read  = true   # set false after DynamoDB URLs use CDN only
```

**HCP outputs after apply**

| Output | Use |
|--------|-----|
| `assets_cdn_url` | Base URL for DynamoDB `File` / `Thumbnail` |
| `assets_cloudfront_domain` | Hostname only |
| `assets_cloudfront_distribution_id` | Invalidation after bulk metadata changes |

### Phase D — Cut over data

1. Copy `assets_cdn_url` from HCP.
2. Update each field’s `File` (and `Thumbnail` if applicable) in Admin or DynamoDB.
3. Smoke test viewer: `/viewer/?m={FieldID}` — Network tab should show **CloudFront** hostname for the splat.
4. Second refresh: look for **cache hits** (see Phase E).

### Phase E — Verify success

```powershell
curl -I "https://YOUR_ASSETS_CF_DOMAIN/splats/UBC_TotemField.ksplat"
curl -I -H "Range: bytes=0-1023" "https://YOUR_ASSETS_CF_DOMAIN/splats/UBC_TotemField.ksplat"
```

Expect `200` and `206 Partial Content` for Range.

In the browser: second refresh should show substantially less splat download (often `(disk cache)` or CloudFront `Hit`).

---

## Terraform pitfalls we hit (and fixes)

| Error | Cause | Fix |
|-------|--------|-----|
| `NoSuchOriginRequestPolicy` | Wrong managed policy UUID (`…b5566785506` vs `…b4c650ea3fcf`) | Use AWS-documented IDs; see module `main.tf` locals |
| `cloudfront:ListCachePolicies` AccessDenied on **plan** | `data.aws_cloudfront_*_policy` data sources at plan time | **Removed data sources**; use hardcoded managed IDs (Fix 1) |
| `arguments are required: paths` | Ran `create-invalidation` without `--paths` | Use `aws s3 cp … --cache-control` for S3; invalidation is ` --paths "/*"` only for distributions |

Optional IAM (Fix 2): add `ListCachePolicies`, `GetCachePolicy`, `ListOriginRequestPolicies`, `GetOriginRequestPolicy` to `HCPTerraform` if you reintroduce data sources — see `docs/iam/hcp-terraform-virtual-soils-policy.json` in the lab repo.

---

## Other issues encountered in the same migration (context)

These were **separate** from splat CDN but showed up in the same period:

| Issue | Resolution |
|-------|------------|
| `GET /pins` returned 0 items | Lambda `PINS_FIELD_IDS`: `*` = all fields (not literal `FieldID`) |
| Splats 403 from S3 | `enable_public_read` bucket policy on assets bucket |
| Admin local CORS | Add `http://localhost:5174` to `cors_allow_origins` in Terraform |
| Admin splat fetch CORS (`ACAO` = viewer origin) | Assets CDN used `CachingOptimized` without a response headers policy — S3 CORS was cached per object. Attach `aws_cloudfront_response_headers_policy` with `origin_override = true` and the same `cors_allow_origins` list (Terraform `s3-assets-bucket` module). |
| Viewer deploy `VITE_PUBLIC_API_URL` | Build-time env in `apps/viewer/.env` or repo root `.env` with `envDir` |

---

## Current recommended settings

**Terraform (prod)**

```hcl
enable_assets_bucket       = true
enable_assets_cdn          = true
assets_enable_public_read  = true   # → false when all URLs use assets_cdn_url
```

**DynamoDB**

- `File`: `https://{assets_cloudfront_domain}/splats/{name}.ksplat`
- Prefer **`.ksplat`** over raw `.splat` where possible.

**S3 objects**

- `Cache-Control: public, max-age=31536000, immutable` when keys are versioned by filename.

**App**

- `packages/shared/src/three/GaussianViewer.ts` — `progressiveLoad: true` (kept; CDN + headers made this acceptable).

---

## Checklist for future environments

- [ ] HCP apply with `enable_assets_cdn = true`
- [ ] Note `assets_cdn_url` output
- [ ] Apply `Cache-Control` on `splats/` prefix (new uploads + recursive replace on existing)
- [ ] Update all DynamoDB `File` / `Thumbnail` hostnames to assets CloudFront
- [ ] Verify Range (`206`) and repeat-visit cache in DevTools
- [ ] Set `assets_enable_public_read = false` and re-apply when cutover complete
- [ ] Ensure `cors_allow_origins` includes viewer (and admin) CloudFront URLs + localhost dev ports
- [ ] Assets CDN: response headers policy for CORS (`origin_override`) when both viewer and admin load splats cross-origin

---

## Summary

**Problem:** Slow first loads and full re-download on refresh while serving large splats from direct S3 without CDN or cache headers.

**Solution:** Assets **CloudFront distribution** (Terraform `enable_assets_cdn`) + **`Cache-Control` on objects** + **DynamoDB URLs pointing at `assets_cdn_url`**, with correct CloudFront managed policy IDs and no plan-time policy list calls on `HCPTerraform`.

After apply and URL cutover, loading time and caching behavior matched expectations again.
