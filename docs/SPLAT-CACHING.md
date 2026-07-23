# Splat file caching

How to reduce repeated downloads and improve repeat-load performance for Gaussian splat assets served from S3.

**Related:** [`SPLAT-LOADING-AND-CACHING-RESOLUTION.md`](./SPLAT-LOADING-AND-CACHING-RESOLUTION.md) (how we fixed prod slow loads + refresh re-downloads), [`DEPLOY-S3-CLOUDFRONT.md`](./DEPLOY-S3-CLOUDFRONT.md) (assets bucket, CloudFront), [`DECOUPLED-APPS.md`](./DECOUPLED-APPS.md) (viewer app).

---

## Two different “caches”

| Layer | What it is | Survives page refresh? |
|-------|------------|------------------------|
| **HTTP / browser cache** | Stores the raw splat file bytes from S3 (or CDN) | Yes — if headers and request pattern allow it |
| **In-app / GPU state** | Decoded splats, sort buffers, WebGL scene | No — full reload always re-initializes the viewer |

On refresh, users will **always** see the loading overlay and some re-processing work. The goal is to avoid **re-downloading hundreds of MB** from S3 every time.

---

## Why splats often re-download today

Current setup:

- Splats are loaded from **direct S3 URLs** (`…s3.ca-central-1.amazonaws.com/…`).
- The viewer app runs on **CloudFront** (different origin).
- `GaussianViewer` uses **`progressiveLoad: true`**, which issues many **HTTP Range** requests (especially for `.ksplat`).
- S3 objects may have **no `Cache-Control`** metadata → weak or no browser caching.
- **Range requests** are cached less reliably than a single full-file GET.

Loader code: `packages/shared/src/three/GaussianViewer.ts`.

---

## Diagnose first

Open **DevTools → Network**, filter by the splat filename, refresh the page.

| What you see | Meaning |
|--------------|---------|
| Many **`206 Partial Content`** requests, full MB transferred again | HTTP cache not helping (common with progressive + S3) |
| **`(disk cache)`** or **`(memory cache)`**, ~0 B transferred | File is cached; remaining slowness is decode/GPU processing |
| **`200`** with full size every time | Check response headers (missing `Cache-Control`) or hard refresh |

Also run:

```bash
curl -I "https://YOUR-BUCKET.s3.ca-central-1.amazonaws.com/splats/YOUR_FILE.ksplat"
```

Look for `Cache-Control`. If absent, browsers will not cache aggressively.

---

## Solutions (recommended order)

### 1. Set `Cache-Control` on S3 objects (quick win)

Tell browsers and CDNs they may cache splats for a long time. Use **`immutable`** only when you change content by **uploading a new key** (e.g. `field_v2.ksplat`), not overwriting in place.

**New uploads:**

```bash
aws s3 cp ./MyScene.ksplat s3://BUCKET/splats/MyScene.ksplat \
  --cache-control "public, max-age=31536000, immutable"
```

**Fix existing objects in place:**

```bash
# Bash / macOS / Linux (one line)
aws s3 cp s3://BUCKET/splats/ s3://BUCKET/splats/ --recursive --metadata-directive REPLACE --cache-control "public, max-age=31536000, immutable"
```

```powershell
# Windows PowerShell (replace BUCKET with your assets bucket name)
aws s3 cp s3://BUCKET/splats/ s3://BUCKET/splats/ --recursive --metadata-directive REPLACE --cache-control "public, max-age=31536000, immutable"
```

Example for this project:

```powershell
aws s3 cp s3://YOUR_ASSETS_BUCKET/splats/ s3://YOUR_ASSETS_BUCKET/splats/ --recursive --metadata-directive REPLACE --cache-control "public, max-age=31536000, immutable"
```

Add `--region ca-central-1` if your CLI default region differs.

**Do not confuse with CloudFront invalidation** — that is a different command and requires `--paths`:

```powershell
# Only after deploying JS/CSS to CloudFront — NOT for S3 Cache-Control
aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

If you see `arguments are required: paths`, you ran the CloudFront command without `--paths "/*"` (or a specific path). S3 cache headers use `aws s3 cp` above, not `create-invalidation`.

**Verify:** `curl -I` should show `Cache-Control: public, max-age=31536000, immutable`.

**Limitation:** Helps full GETs and some range caching; progressive loading may still miss cache on some browsers.

---

### 2. CloudFront in front of the assets bucket (best for production)

Terraform module `s3-assets-bucket` supports `enable_cdn = true` in the lab repo (`projects/<your-project>/`). After HCP apply, use output **`assets_cdn_url`** in DynamoDB:

```text
https://{assets_cloudfront_domain}/splats/name.ksplat
```

Set `assets_enable_public_read = false` in tfvars after migrating all URLs off direct S3.

---

### 3. Prefer `.ksplat` over `.splat`

Progressive chunk loading is designed for **`.ksplat`**. Raw **`.splat`** files are larger and progressive behavior is weaker. Legacy production URLs often used `.ksplat` on a CDN.

---

### 4. Disable progressive loading (tradeoff)

In `GaussianViewer.ts`, set `progressiveLoad: false` for a **single full-file GET**, which browsers cache more reliably than many range requests.

| | Progressive (`true`, default) | Non-progressive (`false`) |
|--|-------------------------------|---------------------------|
| First visit | Faster first pixels | Slower until full download |
| Repeat visit (cached file) | Range cache often misses | Full-file cache often hits |
| Processing | `optimizeSplatData` disabled during progressive load | Full in-memory optimizations available |

Use when repeat visits matter more than fastest first paint.

---

### 5. Client-side Cache API / IndexedDB (strongest repeat-visit cache)

When HTTP caching is insufficient, cache the file in the browser explicitly:

1. `fetch(splatUrl)` → store response in `caches.open('virtual-soils-splats')`.
2. On next visit: `cache.match(url)` → `URL.createObjectURL(blob)`.
3. Pass the **blob URL** to `addSplatScene()` (library supports blob URLs with an explicit `format` if needed).

This survives refresh even when Range-request caching fails. Best for large files and heavy repeat use; requires app code (not infra-only).

Reference: [GaussianSplats3D issue #180](https://github.com/mkkellogg/GaussianSplats3D/issues/180).

---

## What does not fix splat caching

| Action | Why it doesn’t help |
|--------|---------------------|
| CloudFront invalidation on the **viewer** distribution | Only affects JS/CSS in `apps/viewer/dist`, not S3 splat URLs |
| `VITE_*` env vars on CloudFront | Splats are static objects, not Vite bundles |
| CORS changes | Required for cross-origin fetch; does not set cache duration |
| Cognito / API config | Unrelated to static asset delivery |

---

## Recommended rollout

1. **Now:** Apply `Cache-Control` on all objects under `splats/`; confirm `(disk cache)` in DevTools on second refresh.
2. **Next:** CloudFront distribution for assets bucket; update DynamoDB `File` URLs to the CDN hostname.
3. **Optional:** Use `.ksplat` everywhere; tune `progressiveLoad` per product needs.
4. **If repeat visits are critical:** Implement Cache API layer in the viewer.

---

## Checklist

- [ ] Splat objects have `Cache-Control: public, max-age=31536000, immutable` (or shorter TTL without `immutable` if overwriting keys in place)
- [ ] DynamoDB `File` URLs point at CDN (or S3 with correct headers)
- [ ] Assets bucket CORS includes viewer CloudFront origin
- [ ] DevTools shows cache hit on second normal refresh (not hard refresh)
- [ ] File format is `.ksplat` where possible
- [ ] Team understands: refresh still re-processes the scene even when the file is cached
