# Two-App Architecture

The repo now contains two independent Vite apps plus one shared package:

```text
apps/
  viewer/   public read-only Viewer app
  admin/    authenticated Admin Panel + Editor app

packages/
  shared/   shared types, pure utils, and Three.js viewer runtime
```

## Apps

### Public Viewer

Location: `apps/viewer`

Routes:

- `/`
- `/viewer/*`

The viewer app contains only the public viewing experience. It does not import Cognito, Amplify Auth, the admin API client, Admin, or Editor.

API client:

- `apps/viewer/src/publicApi.ts`
- Uses `VITE_PUBLIC_API_URL`
- Exposes read-only methods:
  - `getFields()`
  - `getFieldById(fieldId)`
  - `getPins()`

Expected URL:

```text
/viewer/?m={FieldID}
```

### Authenticated Admin

Location: `apps/admin`

Routes:

- `/`
- `/admin` redirects to `/`
- `/editor`

The admin app contains the Admin Panel, Editor, Cognito OAuth (via the `aws-amplify` client library), and authenticated admin API client.

API client:

- `apps/admin/src/adminApi.ts`
- Uses `VITE_ADMIN_API_URL`
- Attaches a Cognito JWT `Authorization` header from `fetchAuthSession()`
- Supports:
  - `listFields()`
  - `getField(fieldId)`
  - `createField(payload)`
  - `updateField(fieldId, payload)`
  - `deleteField(fieldId)`
  - `updateFieldMarkers(fieldId, markers)`

## Shared Package

Location: `packages/shared`

Shared code is safe for both apps to import. It contains no auth setup and no app-specific API clients.

Current contents:

- `src/types/fields.ts`
- `src/types/markerLabel.ts`
- `src/utils/fields.ts`
- `src/utils/markers.ts`
- `src/utils/numbers.ts`
- `src/three/*`
- `src/styles.css`

## Commands

From repo root:

```bash
npm run dev:viewer
npm run dev:admin
npm run build:viewer
npm run build:admin
npm run build
npm run typecheck
npm run lint
```

Each app also builds from its own folder:

```bash
cd apps/viewer
npm run build

cd apps/admin
npm run build
```

Build output:

- `apps/viewer/dist`
- `apps/admin/dist`

## Deployment (S3 + CloudFront)

Both apps deploy as **static sites**: Vite build → **S3** origin bucket → **CloudFront** distribution. This replaced the previous **Amplify Hosting** flow. Cognito auth in the admin app still uses the **`aws-amplify` npm package** (client SDK only — not Amplify Hosting). See [`AMPLIFY-AUTH.md`](./AMPLIFY-AUTH.md) for how that dependency is used.

**Full runbook:** [`DEPLOY-S3-CLOUDFRONT.md`](./DEPLOY-S3-CLOUDFRONT.md) (Terraform outputs, Cognito URLs, CI/CD, smoke tests).

| App | Build output | S3 sync target | CloudFront role |
|-----|--------------|----------------|-----------------|
| Viewer | `apps/viewer/dist` | HCP `viewer_site_bucket_name` | Public viewer at `viewer_site_url` |
| Admin | `apps/admin/dist` | HCP `admin_site_bucket_name` | Admin + editor at `admin_site_url` |

### Viewer deploy

Build from repo root (or `apps/viewer`):

```bash
npm run build:viewer
```

Sync and invalidate (values from HCP Terraform outputs):

```bash
aws s3 sync apps/viewer/dist/ s3://VIEWER_SITE_BUCKET/ --delete
aws cloudfront create-invalidation --distribution-id VIEWER_DISTRIBUTION_ID --paths "/*"
```

Required build-time env:

```text
VITE_PUBLIC_API_URL
```

Do not configure Cognito for the viewer build.

### Admin deploy

Build from repo root (or `apps/admin`):

```bash
npm run build:admin
```

Sync and invalidate:

```bash
aws s3 sync apps/admin/dist/ s3://ADMIN_SITE_BUCKET/ --delete
aws cloudfront create-invalidation --distribution-id ADMIN_DISTRIBUTION_ID --paths "/*"
```

Required build-time env:

```text
VITE_ADMIN_API_URL
VITE_COGNITO_USER_POOL_ID
VITE_COGNITO_CLIENT_ID
VITE_COGNITO_DOMAIN
VITE_COGNITO_OAUTH_DOMAIN
```

Optional redirect overrides:

```text
VITE_COGNITO_REDIRECT_SIGN_IN
VITE_COGNITO_REDIRECT_SIGN_OUT
VITE_APP_ORIGIN
```

The admin app defaults OAuth redirects to the current page origin with a trailing slash:

```text
sign in:  {origin}/
sign out: {origin}/
```

These must match entries in Terraform `cognito_callback_urls` and `cognito_logout_urls` (admin CloudFront URL + `http://localhost:5174/` for local dev). Only set the redirect env vars when you need extra URLs beyond the default.

### CI/CD

Use a **narrow GitHub deploy IAM role** (not `HCPTerraform`): `aws s3 sync` + CloudFront invalidation for each bucket. Two jobs or a matrix — one per app. Changes under `packages/shared` should trigger both builds. See [`DEPLOY-S3-CLOUDFRONT.md`](./DEPLOY-S3-CLOUDFRONT.md) for workflow shape and IAM policy pointer.

## AWS Notes

- Viewer domain should call only public read endpoints such as `/fields`, `/fields/{id}`, and `/pins`.
- Admin domain should call authenticated `/admin/api/*` endpoints.
- API Gateway CORS must allow both the viewer domain and the admin domain.
- Cognito callback/logout URLs should include only the admin app domain and the admin localhost dev URL.
- Cognito/Auth should not be configured for the viewer app.
- Do not put AWS access keys or secret keys in frontend env files.

## Boundary Checks

The intended dependency boundaries are:

- `apps/viewer` may import `@soil/shared`, but not `apps/admin`.
- `apps/admin` may import `@soil/shared`, but not `apps/viewer`.
- `packages/shared` must not import either app, Amplify, Cognito, or API clients.
- Viewer API client must stay read-only.
