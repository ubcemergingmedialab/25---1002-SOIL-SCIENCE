#!/usr/bin/env bash
# Deploy apps/viewer/dist to the viewer S3 bucket and invalidate CloudFront.
#
# Required (repo-root .env or exported env vars):
#   VIEWER_SITE_BUCKET                  S3 bucket name (no s3:// prefix)
#   VIEWER_CLOUDFRONT_DISTRIBUTION_ID   CloudFront distribution ID

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/load-repo-env.sh
source "${SCRIPT_DIR}/scripts/load-repo-env.sh"
load_repo_env

missing=()
[[ -z "${VIEWER_SITE_BUCKET:-}" ]] && missing+=("VIEWER_SITE_BUCKET")
[[ -z "${VIEWER_CLOUDFRONT_DISTRIBUTION_ID:-}" ]] && missing+=("VIEWER_CLOUDFRONT_DISTRIBUTION_ID")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: missing required deploy variables: ${missing[*]}" >&2
  echo "Set them in .env at the repo root (see .env.example) or export them before deploying." >&2
  echo "Example:" >&2
  echo "  export VIEWER_SITE_BUCKET=your-viewer-site-bucket" >&2
  echo "  export VIEWER_CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC" >&2
  exit 1
fi

npm run build:viewer
aws s3 sync apps/viewer/dist/ "s3://${VIEWER_SITE_BUCKET}/"
aws cloudfront create-invalidation --distribution-id "$VIEWER_CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
