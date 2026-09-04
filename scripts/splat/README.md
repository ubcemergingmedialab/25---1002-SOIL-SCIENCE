# Converting `.ksplat` → PlayCanvas formats

Production splats in this stack start as **`.ksplat`** (mkkellogg / `@mkkellogg/gaussian-splats-3d`). PlayCanvas Engine loads **`.sog`** or **streamed LOD** (`lod-meta.json` + chunk folders).

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

Download from your assets CDN or S3 (`ASSETS_BUCKET` must be set — there is no default bucket in this fork):

```bash
: "${ASSETS_BUCKET:?error: set ASSETS_BUCKET to your assets S3 bucket name}"
aws s3 cp \
  "s3://${ASSETS_BUCKET}/splats/UM_ResearchStation_01_WebHigh.ksplat" \
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

## 5. Orientation (legacy viewer vs PlayCanvas)

**`splat-transform` does not flip splats** — it exports the same coordinates as the source file.

The **legacy `/viewer/`** applies a **180° X correction at load time** in `GaussianViewer.ts` (`rotation: [1, 0, 0, 0]` for mkkellogg). **PlayCanvas does not**, so raw LOD exports look upside-down unless you correct them.

**Batch script (default):** [`batch-lod-from-temp.ps1`](batch-lod-from-temp.ps1) applies `-r 180,0,0` on import so PlayCanvas LOD matches legacy `/viewer/`. Disable with:

```powershell
$env:SPLAT_ROTATION = "none"
powershell -ExecutionPolicy Bypass -File scripts/splat/batch-lod-from-temp.ps1
```

**Manual one-off:**

```bash
splat-transform ./work/scene.ksplat -r 180,0,0 ./work/out/scene.sog
```

**Already-uploaded LOD (no re-export):** use the smoke harness query flag `?orientationX=180` until you re-run the batch script and re-upload.

Adjust axis/angle if a specific scene still differs after comparing side-by-side with `/viewer/?m={FieldID}`.

---

## 6. Upload to assets CDN

**Single SOG:**

```bash
aws s3 cp ./work/out/scene.sog \
  s3://YOUR_ASSETS_BUCKET/splats/sog/scene.sog \
  --cache-control "public, max-age=31536000, immutable" \
  --region ca-central-1
```

**Streamed LOD folder** (sync entire directory):

```bash
chmod +x scripts/splat/sync-lod-to-s3.sh
: "${ASSETS_BUCKET:?error: set ASSETS_BUCKET}"
./scripts/splat/sync-lod-to-s3.sh UM_ResearchStation_01_WebHigh "$ASSETS_BUCKET"
```

Or manually:

```bash
aws s3 sync ./work/out/UM_ResearchStation_01/ \
  s3://YOUR_ASSETS_BUCKET/splats/lod/UM_ResearchStation_01/ \
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

**URL stability:** Partners embed `https://{viewer_domain}/viewer/?m={FieldID}` and may link directly to `File` asset URLs. Upload LOD to **new** keys under `splats/lod/`; do not replace or remove objects at existing `File` paths. Do not change CloudFront domains or `FieldID` values without coordinating embed owners.

---

## Which format to pick?

| Situation | Format |
|-----------|--------|
| Quick test / small scene | `.sog` |
| Mobile performance priority | **streamed LOD** |
| Multi-million Gaussians | **streamed LOD** (required for good mobile UX) |

---

## Legacy vs PlayCanvas visual quality

The legacy viewer loads **`.splat` / `.ksplat`** via **mkkellogg** (`@mkkellogg/gaussian-splats-3d`) in Three.js. The PlayCanvas viewer loads **SOG** or **streamed LOD** produced by **`splat-transform`**. Those are **different file formats and different renderers**, not just different quality presets on the same asset.

### Why legacy can look better at the same angle

| | Legacy | PlayCanvas |
|---|--------|------------|
| **Source file** | `.splat` / `.ksplat` (mkkellogg) | SOG or streamed LOD chunks |
| **Precision** | Full per-Gaussian data from source | **Lossy** quantization (positions, scales, colors in WebP/codebooks) |
| **Renderer** | mkkellogg WebGL sort + rasterize | PlayCanvas gsplat (WebGPU/WebGL2) |
| **Gaussian count** | All splats in file | Often similar total count after conversion — **count ≠ identical appearance** |

SOG is **lossy by design** ([PlayCanvas SOG spec](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/)). Positions and scales are quantized; splats can render **smaller or misaligned**, which shows up as **gaps** (black clear color), especially on **dark, thin, or view-dependent** surfaces (e.g. vertical soil faces when the camera is level with the floor).

This is **not** fixed by viewer URL params alone (`budget=0`, `lod=0`, `orientationX=…`). It is also **not** “black splats rendered transparent” — holes are usually **missing overlap** or **low effective opacity** at that pixel, which reads as see-through on a black background.

### What we ruled out (UM_05 case study, 2026)

For **UM_05** (`UM05_HighQuality_0SH`), side-by-side testing showed:

- Legacy `.splat` ≈ **4.1M** Gaussians; PlayCanvas LOD0 ≈ **4.09M** — similar count, worse appearance in PlayCanvas at the same camera angle.
- **`budget=0`** — not the global splat budget cap.
- **`lod=0`** — not distance-based LOD downgrade.
- **Re-convert variants** ([`reconvert-um05.ps1`](reconvert-um05.ps1): `lod0-only`, `single-sog`, `nocrop-lod0`, `lod-standard`, `rotation-baked`) — all still SOG + PlayCanvas; **none matched legacy** at the good angle.

Conclusion: remaining gap is **SOG encoding + PlayCanvas rendering vs mkkellogg `.splat`**, plus **view-dependent thin coverage** in the source (legacy also shows some holes at bad angles; PlayCanvas is less forgiving).

### Practical mitigations

1. **Authoring** — Set `start_view_position` to a framing where the scene looks solid (often steeper than a level walk-along view). Avoid default views into dark vertical faces.
2. **Per-field fallback** — Use `?renderer=legacy` on `/viewer/` when PlayCanvas quality is unacceptable for a field (e.g. UM_05).
3. **Conversion tuning** — Try newer `splat-transform`, `-i` / `--iterations` for SH compression (see [SplatTransform docs](https://developer.playcanvas.com/user-manual/splat-transform/)); UM_05 is **0SH** so SH iteration helps less than position/scale quantization.
4. **Re-capture / densify** — Improve coverage in problem regions in training or SuperSplat (underlying reconstruction issue).
5. **Engine/tooling** — Track PlayCanvas forum/GitHub for SOG position accuracy and quality fixes (links below).

### Debug URLs (PlayCanvas viewer)

```text
/viewer/?m={FieldID}&budget=0&lod=0&groundClamp=0
/viewer/?url=/work-out/{basename}/lod-meta.json&budget=0&lod=0
/viewer/?m={FieldID}&renderer=legacy
```

### External discussion (SOG quality / artifacts)

Community and PlayCanvas reports align with “SOG can look worse than source PLY/splat at same splat count”:

| Topic | Link |
|-------|------|
| PLY vs SOG messy after convert; PlayCanvas staff: **position quantization** cause; streamed SOG may help | [PlayCanvas forum — PLY vs SOG](https://forum.playcanvas.com/t/ply-vs-sog/42359) |
| **Significant SOG quality loss** vs PLY; SH import bug fixed in engine PR [#7972](https://github.com/playcanvas/engine/pull/7972) | [splat-transform issue #52](https://github.com/playcanvas/splat-transform/issues/52) |
| SOG **lossy**; PLY for archive, SOG for delivery | [PlayCanvas — Splat file formats](https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/) |
| **False transparency** in 3DGS training (research; not SOG-specific) | [Noise Guided Splatting (arXiv)](https://arxiv.org/html/2510.15736v1) |
| SH quantization / clamping discussion on PLY→SOG color artifacts | [LichtFeld-Studio issue #868](https://github.com/MrNeRF/LichtFeld-Studio/issues/868) |

**Do not re-debug** a field that looks worse in PlayCanvas than legacy by only raising splat budget or LOD — confirm with `budget=0&lod=0` and legacy side-by-side first.

---

## Batch convert all files in `temp/`

**Script docs:** [`batch-lod-from-temp.md`](batch-lod-from-temp.md) (prerequisites, usage, env vars, troubleshooting).

From repo root (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/splat/batch-lod-from-temp.ps1
```

This reads every `.ksplat` / `.splat` in [`temp/`](../temp/), writes:

- Intermediate PLY LOD chain → `work/lod/{basename}/lod0.ply`, `lod1.ply`, …
- Streamed LOD bundle → `work/out/{basename}/lod-meta.json` (+ chunk folders)
- Ground collision voxels → `work/out/{basename}/collision.voxel.json` + `collision.voxel.bin` (prep culls to ~60 m sphere at seed by default)

See [`batch-lod-from-temp.md`](batch-lod-from-temp.md) for collision env vars (`SPLAT_COLLISION`, `SPLAT_COLLISION_SPHERE_M`, `SPLAT_VOXEL_PARAMS`, …).

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
$env:SPLAT_ROTATION = "180,0,0"   # default; use "none" to skip
powershell -ExecutionPolicy Bypass -File scripts/splat/batch-lod-from-temp.ps1
```

Log: [`work/batch-lod.log`](../work/batch-lod.log).

**Monitor a running batch** (runtime, CPU, log, output folders):

```bash
bash scripts/splat/check-batch-progress.sh
bash scripts/splat/check-batch-progress.sh --watch 10
```

**Local smoke test (no S3 upload):** with `npm run dev:viewer` running, open:

```text
http://localhost:5173/viewer/?url=/work-out/{basename}/lod-meta.json
```

Vite serves `work/out/` at `/work-out/` during dev only.

**UM_05 quality comparison rebuild:**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/splat/reconvert-um05.ps1
powershell -ExecutionPolicy Bypass -File scripts/splat/reconvert-um05.ps1 -CheckOnly
```

See [Legacy vs PlayCanvas visual quality](#legacy-vs-playcanvas-visual-quality) above.

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
