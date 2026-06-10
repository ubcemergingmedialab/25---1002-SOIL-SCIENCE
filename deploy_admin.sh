#!/bin/bash

npm run build:admin
aws s3 sync apps/admin/dist/ s3://ubc-eml-virtual-soils-prod-admin-26a693/ --delete
aws cloudfront create-invalidation --distribution-id E27S1RF5W3BDSO --paths "/*"

