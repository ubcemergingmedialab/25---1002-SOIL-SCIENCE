# Converting `.ksplat` → PlayCanvas formats

Virtual Soils production splats are **`.ksplat`** (mkkellogg / `@mkkellogg/gaussian-splats-3d`). PlayCanvas Engine loads **`.sog`** or **streamed LOD** (`lod-meta.json` + chunk folders).

Tool: [`@playcanvas/splat-transform`](https://github.com/playcanvas/splat-transform) (reads `.ksplat`; does not write `.ksplat`).

**Related:** [`docs/PLAYCANVAS-MIGRATION-PLAN.md`](../docs/PLAYCANVAS-MIGRATION-PLAN.md), [`docs/SPLAT-CACHING.md`](../docs/SPLAT-CACHING.md)

---

## 1. Install

```bash
npm install -g @playcanvas/splat-transform
splat-transform --version
```

Optional: list GPUs for faster SOG compression:

```bash
splat-transform --list-gpus
```

---

## 2. Get a source file

Download from assets CDN or S3 (example bucket from prod):

```bash
aws s3 cp \
  s3://ubc-eml-virtual-soils-prod-assets-078d04/splats/UM_ResearchStation_01_WebHigh.ksplat \
  ./work/UM_ResearchStation_01_WebHigh.ksplat \
  --region ca-central-1
```

Or curl from CloudFront:

```bash
curl -o ./work/scene.ksplat "https://YOUR_ASSETS_CF_DOMAIN/splats/UM_ResearchStation_01_WebHigh.ksplat"
```

Inspect splat count (optional):

```bash
splat-transform ./work/scene.ksplat -m null
```

---

## 3. Option A — Single `.sog` (smaller scenes)

Best for sites under ~1–2M Gaussians or quick tests.

**Create output directories first** — `splat-transform` does not create parent folders; missing dirs cause `ENOENT` on Windows.

```bash
# macOS / Linux / Git Bash
mkdir -p ./work/out

# PowerShell (repo root)
New-Item -ItemType Directory -Force -Path work/out | Out-Null
```

```bash
splat-transform ./work/scene.ksplat ./work/out/scene.sog
```

Engine loads this URL directly:

```text
https://{assets_cdn}/splats/sog/scene.sog
```

---

## 4. Option B — Streamed LOD (recommended for mobile / large scenes)

Produces a **folder** with `lod-meta.json` and chunk subfolders. Engine loads the **manifest URL**:

```text
https://{assets_cdn}/splats/lod/{FieldID}/lod-meta.json
```

### Step 1 — Build an LOD chain (decimate 50% each level)

Start from your `.ksplat`. Export each level as PLY (intermediate), halving until the coarsest level is ~1M Gaussians:

**Create `work/lod` first** (splat-transform will not create it):

```powershell
New-Item -ItemType Directory -Force -Path work/lod | Out-Null
```

```bash
# LOD 0 = full resolution from ksplat
splat-transform ./work/scene.ksplat ./work/lod/lod0.ply

# Halve each level (repeat until coarsest ~1M splats)
splat-transform ./work/lod/lod0.ply --decimate 50% ./work/lod/lod1.ply
splat-transform ./work/lod/lod1.ply --decimate 50% ./work/lod/lod2.ply
splat-transform ./work/lod/lod2.ply --decimate 50% ./work/lod/lod3.ply
```

Check counts:

```bash
splat-transform ./work/lod/lod3.ply -m null
```

### Step 2 — Combine into streamed SOG

Tag each input with `--lod n` (applies to the **preceding** file). Output path must end in `lod-meta.json`:

```bash
New-Item -ItemType Directory -Force -Path work/out/UM_ResearchStation_01 | Out-Null
```

```bash
splat-transform \
  ./work/lod/lod0.ply --lod 0 \
  ./work/lod/lod1.ply --lod 1 \
  ./work/lod/lod2.ply --lod 2 \
  ./work/lod/lod3.ply --lod 3 \
  ./work/out/UM_ResearchStation_01/lod-meta.json
```

Result layout:

```text
work/out/UM_ResearchStation_01/
  lod-meta.json
  0_0/meta.json + *.webp
  0_1/...
  1_0/...
  ...
```

Optional chunk tuning (finer streaming = more, smaller files):

```bash
# ~256K Gaussians per chunk, 8m chunks
splat-transform ... --lod-chunk-count 256 --lod-chunk-extent 8 ./work/out/.../lod-meta.json
```

Full guide: [PlayCanvas — Generating Streamed SOG](https://github.com/playcanvas/splat-transform/blob/main/guides/STREAMED_SOG.md)

---

## 5. Orientation check

The current Three.js viewer applies a **180° flip** when loading mkkellogg splats (`rotation: [1, 0, 0, 0]` in `GaussianViewer.ts`). PlayCanvas may show the scene upright without that, or upside-down.

After conversion, load in a PlayCanvas engine smoke test. If wrong, re-export with rotation (Euler degrees):

```bash
splat-transform ./work/scene.ksplat -r 180,0,0 ./work/out/scene.sog
```

Adjust axis/angle until engine view matches the current production viewer.

---

## 6. Upload to assets CDN

**Single SOG:**

```bash
aws s3 cp ./work/out/scene.sog \
  s3://ubc-eml-virtual-soils-prod-assets-078d04/splats/sog/scene.sog \
  --cache-control "public, max-age=31536000, immutable" \
  --region ca-central-1
```

**Streamed LOD folder** (sync entire directory):

```bash
chmod +x scripts/splat/sync-lod-to-s3.sh
./scripts/splat/sync-lod-to-s3.sh UM_ResearchStation_01_WebHigh ubc-eml-virtual-soils-prod-assets-078d04
```

Or manually:

```bash
aws s3 sync ./work/out/UM_ResearchStation_01/ \
  s3://ubc-eml-virtual-soils-prod-assets-078d04/splats/lod/UM_ResearchStation_01/ \
  --cache-control "public, max-age=31536000, immutable" \
  --region ca-central-1
```

Public URLs (replace with your assets CloudFront domain):

```text
https://{assets_cdn}/splats/sog/scene.sog
https://{assets_cdn}/splats/lod/UM_ResearchStation_01/lod-meta.json
```

Verify CORS from browser DevTools (viewer/admin origins must be allowed).

---

## 7. DynamoDB / API (Phase 1)

Keep existing `File` (`.ksplat`) for the current viewer. Add PlayCanvas fields for the engine path:

| Attribute | Example |
|-----------|---------|
| `FilePlayCanvas` | `https://{assets_cdn}/splats/lod/UM_ResearchStation_01/lod-meta.json` |
| `FileFormat` | `streamed-lod` or `sog` |

---

## Which format to pick?

| Situation | Format |
|-----------|--------|
| Quick test / small scene | `.sog` |
| Mobile performance priority | **streamed LOD** |
| Multi-million Gaussians | **streamed LOD** (required for good mobile UX) |

---

## Batch convert all files in `temp/`

From repo root (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/splat/batch-lod-from-temp.ps1
```

This reads every `.ksplat` / `.splat` in [`temp/`](../temp/), writes:

- Intermediate PLY LOD chain → `work/lod/{basename}/lod0.ply`, `lod1.ply`, …
- Streamed LOD bundle → `work/out/{basename}/lod-meta.json` (+ chunk folders)

Halves splat count at each level until coarsest ≤ ~1.05M Gaussians (max 3 decimation steps).

**Automatic PlayCanvas cleanup** (see [`batch-lod-from-temp.ps1`](batch-lod-from-temp.ps1)):

| Check | Action |
|-------|--------|
| Invalid `-Infinity` log-scale on `scale_*` | Strip via `-V scale_*_raw,gt,-100` (`--filter-nan` is not enough) |
| Position outliers (any \|x/y/z\| > **200 m** by default) | Symmetric box crop **±150 m** (distant sky shells / corrupt coordinates) |
| Cloudy sky hint | Logged when large extent coincides with high `y` max — crop removes distant sky gaussians, not on-site ground detail |

Override thresholds:

```powershell
$env:SPLAT_POSITION_OUTLIER_M = 200
$env:SPLAT_POSITION_BOX_HALF_M = 150
powershell -ExecutionPolicy Bypass -File scripts/splat/batch-lod-from-temp.ps1
```

Log: [`work/batch-lod.log`](../work/batch-lod.log).

**Local smoke test (no S3 upload):** with `npm run dev:viewer` running, open:

```text
http://localhost:5173/viewer-pc/?url=/work-out/{basename}/lod-meta.json
```

Vite serves `work/out/` at `/work-out/` during dev only.

---

```bash
# 1. List ksplat keys
aws s3 ls s3://BUCKET/splats/ --region ca-central-1

# 2. For each file: download → convert → upload
# 3. Update DynamoDB FilePlayCanvas per FieldID
```

Automate with a shell script loop or CI job in a later Phase 1 task.

---

## References

- [splat-transform README](https://github.com/playcanvas/splat-transform)
- [PlayCanvas — Splat file formats](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/)
- [PlayCanvas — LOD streaming (engine)](https://developer.playcanvas.com/user-manual/gaussian-splatting/building/unified-rendering/lod-streaming/)
