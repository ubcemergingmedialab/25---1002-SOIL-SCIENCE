# Build streamed LOD bundles for every splat in repo temp/
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/splat/batch-lod-from-temp.ps1
#
# Optional env overrides (meters):
#   SPLAT_POSITION_OUTLIER_M=200   trigger position crop when |coord| exceeds this
#   SPLAT_POSITION_BOX_HALF_M=150  half-extent of symmetric crop box (-N..N per axis)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$TempDir = Join-Path $RepoRoot "temp"
$WorkLod = Join-Path $RepoRoot "work/lod"
$WorkOut = Join-Path $RepoRoot "work/out"
$BatchLog = Join-Path $RepoRoot "work/batch-lod.log"

$TargetCoarseM = 1.05
$MaxDecimateSteps = 3

# PlayCanvas-safe cleanup thresholds (override via env vars above).
$PositionOutlierThresholdM = if ($env:SPLAT_POSITION_OUTLIER_M) {
    [double]$env:SPLAT_POSITION_OUTLIER_M
} else { 200.0 }
$PositionBoxHalfExtentM = if ($env:SPLAT_POSITION_BOX_HALF_M) {
    [double]$env:SPLAT_POSITION_BOX_HALF_M
} else { 150.0 }

# Remove Gaussians with -Infinity log-scale (PlayCanvas renders these as screen-filling blobs).
# --filter-nan intentionally keeps -Inf in scale_*; use raw scale filters instead.
$ScaleInfFilters = @(
    "-V", "scale_0_raw,gt,-100",
    "-V", "scale_1_raw,gt,-100",
    "-V", "scale_2_raw,gt,-100"
)

function Write-BatchLog {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    Add-Content -Path $BatchLog -Value $line -Encoding utf8
    Write-Host $Message
}

# splat-transform logs progress to stderr; avoid PowerShell treating that as a terminating error.
function Invoke-SplatTransform {
    param([string[]]$SplatCliArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & splat-transform @SplatCliArgs
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) {
        throw "splat-transform failed (exit $code): splat-transform $($SplatCliArgs -join ' ')"
    }
}

function Get-SplatTransformSummaryText {
    param([string]$Path)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = (splat-transform $Path -m null 2>&1) | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) { throw "splat-transform summary failed for $Path" }
    return $out
}

function Parse-SummaryTableRow {
    param([string]$Line)
    $parts = ($Line -split '\|').ForEach({ $_.Trim() }) | Where-Object { $_ -ne '' }
    if ($parts.Count -lt 8) { return $null }
    return @{
        Column = $parts[0]
        Min    = [double]$parts[1]
        Max    = [double]$parts[2]
        Infs   = [int]$parts[7]
    }
}

function Get-SplatSummary {
    param([string]$Path)
    $out = Get-SplatTransformSummaryText $Path
    $summary = @{
        Path          = $Path
        CountM        = $null
        MaxAbsCoord   = 0.0
        ScaleInfTotal = 0
        Axes          = @{}
        SkyHint       = $false
    }

    if ($out -match "([\d.]+)M gaussians") {
        $summary.CountM = [double]$Matches[1]
    } elseif ($out -match "([\d.]+)K gaussians") {
        $summary.CountM = [double]$Matches[1] / 1000
    }

    foreach ($line in ($out -split "`n")) {
        if ($line -notmatch '^\| (x|y|z|scale_0|scale_1|scale_2)\s+\|') { continue }
        $row = Parse-SummaryTableRow $line
        if (-not $row) { continue }
        $summary.Axes[$row.Column] = $row
        if ($row.Column -match '^scale_') {
            $summary.ScaleInfTotal += $row.Infs
        } else {
            $summary.MaxAbsCoord = [math]::Max(
                $summary.MaxAbsCoord,
                [math]::Abs($row.Min),
                [math]::Abs($row.Max)
            )
        }
    }

    $y = $summary.Axes['y']
    if ($y -and $y.Max -gt 15 -and $summary.MaxAbsCoord -gt $PositionOutlierThresholdM) {
        $summary.SkyHint = $true
    }

    return $summary
}

function Get-GaussianCountM {
    param([string]$Path)
    return (Get-SplatSummary $Path).CountM
}

function Repair-PlayCanvasSplatData {
    param(
        [string]$InputPath,
        [string]$Lod0Path,
        [string]$BaseName
    )

    Write-Host "[1/3] ksplat/splat -> lod0.ply (PlayCanvas cleanup)"
    Invoke-SplatTransform -SplatCliArgs @("-w", $InputPath) + $ScaleInfFilters + @($Lod0Path)

    $summary = Get-SplatSummary $Lod0Path
    Write-BatchLog "  $BaseName after scale-inf filter: $($summary.CountM)M gaussians, max |coord|=$($summary.MaxAbsCoord)m, scale infs=$($summary.ScaleInfTotal)"

    if ($summary.ScaleInfTotal -gt 0) {
        Write-BatchLog "  WARNING $BaseName : scale_* still has $($summary.ScaleInfTotal) Inf values after filter"
    }

    if ($summary.MaxAbsCoord -gt $PositionOutlierThresholdM) {
        $half = $PositionBoxHalfExtentM
        $box = "-$half,-$half,-$half,$half,$half,$half"
        $lod0Cropped = "$Lod0Path.tmp.ply"

        Write-Host "      position outliers detected (max |coord|=$([math]::Round($summary.MaxAbsCoord,1))m > ${PositionOutlierThresholdM}m)"
        Write-Host "      cropping to box [$box] (distant sky/outlier shell)"
        if ($summary.SkyHint) {
            Write-BatchLog "  NOTE $BaseName : large extent + upper y - likely cloudy-sky / distant shell gaussians"
        }

        Invoke-SplatTransform -SplatCliArgs @("-w", $Lod0Path, "-B", $box, $lod0Cropped)
        Move-Item -Force $lod0Cropped $Lod0Path

        $summary = Get-SplatSummary $Lod0Path
        Write-BatchLog "  $BaseName after position crop: $($summary.CountM)M gaussians, max |coord|=$($summary.MaxAbsCoord)m"
        Write-Host "      after crop: $($summary.CountM)M gaussians, max |coord|=$([math]::Round($summary.MaxAbsCoord,1))m"
    }

    if ($summary.MaxAbsCoord -gt $PositionOutlierThresholdM) {
        Write-BatchLog "  WARNING $BaseName : still exceeds position threshold after crop - inspect manually"
    }

    return $summary
}

function Ensure-Dir {
    param([string]$Path)
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

Ensure-Dir (Join-Path $RepoRoot "work")
Write-BatchLog "=== batch-lod-from-temp start (outlier>${PositionOutlierThresholdM}m -> box +/-${PositionBoxHalfExtentM}m) ==="

$inputs = Get-ChildItem -Path $TempDir -File |
    Where-Object { $_.Extension -match '^\.(ksplat|splat|ply)$' } |
    Sort-Object Name

if ($inputs.Count -eq 0) {
    Write-Error "No .ksplat/.splat/.ply files in $TempDir"
}

Write-Host "Processing $($inputs.Count) splat(s) from $TempDir"
Write-Host ""

foreach ($input in $inputs) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($input.Name)
    $lodDir = Join-Path $WorkLod $base
    $outDir = Join-Path $WorkOut $base
    Ensure-Dir $lodDir
    Ensure-Dir $outDir

    Write-Host "========================================"
    Write-Host " $base ($($input.Name))"
    Write-Host "========================================"
    Write-BatchLog "Processing $base ($($input.Name))"

    $lod0 = Join-Path $lodDir "lod0.ply"
    $null = Repair-PlayCanvasSplatData -InputPath $input.FullName -Lod0Path $lod0 -BaseName $base

    $lodFiles = @($lod0)
    $countM = Get-GaussianCountM $lod0
    Write-Host "      lod0: ${countM}M gaussians"

    $step = 0
    while ($countM -gt $TargetCoarseM -and $step -lt $MaxDecimateSteps) {
        $step++
        $prev = $lodFiles[-1]
        $next = Join-Path $lodDir "lod$step.ply"
        Write-Host "[2/3] decimate -> lod$step.ply"
        Invoke-SplatTransform -SplatCliArgs @("-w", $prev, "--decimate", "50%", $next)
        $lodFiles += $next
        $countM = Get-GaussianCountM $next
        Write-Host "      lod$step : ${countM}M gaussians"
    }

    $manifest = Join-Path $outDir "lod-meta.json"
    $transformArgs = @("-w")
    for ($i = 0; $i -lt $lodFiles.Count; $i++) {
        $transformArgs += $lodFiles[$i]
        $transformArgs += "--lod"
        $transformArgs += "$i"
    }
    $transformArgs += $manifest

    Write-Host "[3/3] bundle streamed LOD -> $manifest"
    Write-Host "      levels: $($lodFiles.Count) (lod0..lod$($lodFiles.Count - 1))"
    Invoke-SplatTransform -SplatCliArgs $transformArgs

    Write-BatchLog "Done $base -> $outDir"
    Write-Host "Done: $outDir"
    Write-Host ""
}

Write-BatchLog "=== batch-lod-from-temp complete ==="
Write-Host "All complete. Output under: $WorkOut"
Write-Host "Log: $BatchLog"
