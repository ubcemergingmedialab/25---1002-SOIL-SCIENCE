#!/usr/bin/env bash
# Deploy this app's dist/ to the viewer S3 bucket and invalidate CloudFront.
# Prefer the repo-root deploy_viewer.sh from a monorepo checkout.
#
# Required env vars (from your Terraform / hosting outputs):
#   VIEWER_SITE_BUCKET                  S3 bucket name (no s3:// prefix)
#   VIEWER_CLOUDFRONT_DISTRIBUTION_ID   CloudFront distribution ID

set -euo pipefail

missing=()
[[ -z "${VIEWER_SITE_BUCKET:-}" ]] && missing+=("VIEWER_SITE_BUCKET")
[[ -z "${VIEWER_CLOUDFRONT_DISTRIBUTION_ID:-}" ]] && missing+=("VIEWER_CLOUDFRONT_DISTRIBUTION_ID")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: missing required deploy variables: ${missing[*]}" >&2
  echo "Set them to your Virtual Soils viewer site bucket and CloudFront distribution ID before deploying." >&2
  echo "Example:" >&2
  echo "  export VIEWER_SITE_BUCKET=your-viewer-site-bucket" >&2
  echo "  export VIEWER_CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC" >&2
  exit 1
fi

npm run build
aws s3 sync dist/ "s3://${VIEWER_SITE_BUCKET}/"
aws cloudfront create-invalidation --distribution-id "$VIEWER_CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
