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

- `/admin`
- `/editor`

The admin app contains the Admin Panel, Editor, Amplify/Cognito setup, and authenticated admin API client.

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

## Amplify Deployment

Deploy the two apps as separate Amplify apps.

### Viewer Amplify App

App root:

```text
apps/viewer
```

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Required environment variables:

```text
VITE_PUBLIC_API_URL
```

Optional:

```text
VITE_ASSET_BASE_URL
```

Do not configure Cognito for the viewer app.

### Admin Amplify App

App root:

```text
apps/admin
```

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Required environment variables:

```text
VITE_ADMIN_API_URL
VITE_AWS_REGION
VITE_COGNITO_USER_POOL_ID
VITE_COGNITO_CLIENT_ID
VITE_COGNITO_DOMAIN
VITE_COGNITO_REDIRECT_SIGN_IN
VITE_COGNITO_REDIRECT_SIGN_OUT
```

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
