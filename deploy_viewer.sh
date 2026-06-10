#!/bin/bash

npm run build 
aws s3 sync dist/ s3://ubc-eml-virtual-soils-prod-site-6acc18
aws cloudfront create-invalidation --distribution-id EBMJ39GWTQMS --paths "/*"

