#!/usr/bin/env bash
# Deploy apps/admin/dist to the admin S3 bucket and invalidate CloudFront.
#
# Required env vars (from your Terraform / hosting outputs):
#   ADMIN_SITE_BUCKET                  S3 bucket name (no s3:// prefix)
#   ADMIN_CLOUDFRONT_DISTRIBUTION_ID   CloudFront distribution ID

set -euo pipefail

missing=()
[[ -z "${ADMIN_SITE_BUCKET:-}" ]] && missing+=("ADMIN_SITE_BUCKET")
[[ -z "${ADMIN_CLOUDFRONT_DISTRIBUTION_ID:-}" ]] && missing+=("ADMIN_CLOUDFRONT_DISTRIBUTION_ID")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: missing required deploy variables: ${missing[*]}" >&2
  echo "Set them to your Virtual Soils admin site bucket and CloudFront distribution ID before deploying." >&2
  echo "Example:" >&2
  echo "  export ADMIN_SITE_BUCKET=your-admin-site-bucket" >&2
  echo "  export ADMIN_CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC" >&2
  exit 1
fi

npm run build:admin
aws s3 sync apps/admin/dist/ "s3://${ADMIN_SITE_BUCKET}/" --delete
aws cloudfront create-invalidation --distribution-id "$ADMIN_CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
