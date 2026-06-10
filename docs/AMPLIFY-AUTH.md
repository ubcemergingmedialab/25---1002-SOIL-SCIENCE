# aws-amplify auth dependency (admin app)

This document describes how the **`aws-amplify` npm package** is used in the Virtual Soils monorepo today.

It is **not** about Amplify Hosting. Static sites deploy via **S3 + CloudFront** (see [`DEPLOY-S3-CLOUDFRONT.md`](./DEPLOY-S3-CLOUDFRONT.md)). The `aws-amplify` library is used only as a **browser client SDK for Cognito Hosted UI OAuth** in the admin app.

---

## Scope

| App / package | Uses `aws-amplify`? |
|---------------|---------------------|
| `apps/admin` | **Yes** — login, logout, session tokens |
| `apps/viewer` | **No** — public API only |
| `packages/shared` | **No** — no auth imports |

**Package:** `aws-amplify` `^6.16.0` (declared in `apps/admin/package.json` and hoisted at the repo root `package.json`).

**Backend:** Cognito user pool, app client, and Hosted UI domain are provisioned by Terraform in the lab repo (`terraform-setup-template/projects/ubc-eml/virtual-soils/`). Amplify does not manage that infrastructure.

---

## What Amplify provides here

Amplify Auth wraps the standard **OAuth 2.0 authorization code flow with PKCE** against Cognito Hosted UI:

```text
┌─────────────┐     signInWithRedirect      ┌──────────────────────┐
│  Admin SPA  │ ──────────────────────────► │ Cognito Hosted UI    │
│  (browser)  │                             │ /oauth2/authorize    │
└──────┬──────┘                             └──────────┬───────────┘
       │                                               │
       │  callback ?code=… (Amplify exchanges code)    │
       ◄───────────────────────────────────────────────┘
       │
       │  tokens stored in browser (Amplify token store)
       │
       ▼
┌─────────────┐   Bearer id token    ┌──────────────────────┐
│  adminApi   │ ───────────────────► │ API Gateway + Lambda │
└─────────────┘                      └──────────────────────┘

Logout: signOut() → clear local tokens → redirect to Cognito /logout → back to admin origin
```

Amplify handles:

- PKCE (`code_verifier` / `code_challenge`) and OAuth `state`
- Redirect to Cognito authorize endpoint
- Callback processing (code → token exchange)
- Token persistence and refresh
- Hosted UI logout redirect with `logout_uri`

The app does **not** use Amplify API, DataStore, Storage, Analytics, or Identity Pool features from the umbrella package.

---

## Source files

| File | Role |
|------|------|
| `apps/admin/src/main.tsx` | Side-effect import `./auth` before routes mount (runs `Amplify.configure`) |
| `apps/admin/src/auth.ts` | Cognito OAuth config; exports `getCognitoSignOutRedirect()` |
| `apps/admin/src/Admin.tsx` | Auth gate on `/`; login redirect; logout button |
| `apps/admin/src/RequireAuth.tsx` | Auth gate wrapper for `/editor` |
| `apps/admin/src/adminApi.ts` | Reads session token for `Authorization` header on admin API calls |

`Editor.tsx` does not import Amplify directly; it uses `adminApi.ts`, which does.

---

## Amplify APIs in use

| API | Import path | Used in |
|-----|-------------|---------|
| `Amplify.configure` | `aws-amplify` | `auth.ts` |
| `signInWithRedirect` | `aws-amplify/auth` | `Admin.tsx`, `RequireAuth.tsx` |
| `fetchAuthSession` | `aws-amplify/auth` | `Admin.tsx`, `RequireAuth.tsx`, `adminApi.ts` |
| `signOut` | `aws-amplify/auth` | `Admin.tsx` |

### Configuration (`auth.ts`)

At module load, Amplify is configured with:

- `userPoolId` ← `VITE_COGNITO_USER_POOL_ID`
- `userPoolClientId` ← `VITE_COGNITO_CLIENT_ID`
- OAuth `domain` ← `VITE_COGNITO_DOMAIN` or `VITE_COGNITO_OAUTH_DOMAIN`
- `scopes`: `openid`, `email`
- `responseType`: `code` (PKCE)
- `redirectSignIn` / `redirectSignOut`: derived from current page origin plus optional env overrides

Default redirect URLs are built as `{origin}/` (with trailing slash), e.g. `https://d1mulmg3y4nxxd.cloudfront.net/` for production admin.

Optional comma-separated overrides:

- `VITE_COGNITO_REDIRECT_SIGN_IN`
- `VITE_COGNITO_REDIRECT_SIGN_OUT`

Values must be full `http://` or `https://` URLs and must appear in Cognito app client **Allowed callback URLs** / **Allowed sign-out URLs** (set in Terraform `cognito_callback_urls` / `cognito_logout_urls`).

---

## Auth flows by route

| Route | Guard | Behavior |
|-------|-------|----------|
| `/` | Inline in `Admin.tsx` | `fetchAuthSession()` → if no token, `signInWithRedirect()` |
| `/editor` | `RequireAuth` | Same check; renders `Editor` when authed |
| `/admin` | — | Redirects to `/` |

### Login

1. User opens admin URL without a valid session.
2. `fetchAuthSession()` returns no usable token.
3. `signInWithRedirect()` sends the browser to Cognito Hosted UI.
4. After sign-in, Cognito redirects to a registered callback URL (`{origin}/`).
5. Amplify completes the code exchange and stores tokens.
6. UI sets `authState` to `"authed"` and loads admin data.

### Logout

`Admin.tsx` calls:

```typescript
await signOut({
  global: false,
  oauth: { redirectUrl: getCognitoSignOutRedirect() },
});
```

Amplify clears **local tokens first**, then redirects to Cognito `/logout` with `logout_uri` matching `getCognitoSignOutRedirect()` (first entry in the configured sign-out URL list).

**Important:** Sign-out URLs in Cognito must match **exactly**, including trailing slash. A mismatch often surfaces as a Cognito error about `redirect_uri` even when `logout_uri` was intended.

Do not hand-build the logout URL without also clearing Amplify’s token store — the user will appear logged in again on return if local tokens remain.

### API authorization

`adminApi.ts` attaches the **ID token** to each request:

```typescript
const session = await fetchAuthSession();
const token = session.tokens?.idToken?.toString();
// Authorization: Bearer ${token}
```

The auth gates in `Admin.tsx` and `RequireAuth.tsx` check **`accessToken`** presence instead of `idToken`. In practice both are issued together after Hosted UI login, but the gate and API client use different token types.

---

## Environment variables

Required for admin **build** (local `.env` or CI secrets). See [`.env.example`](../.env.example).

| Variable | Purpose |
|----------|---------|
| `VITE_COGNITO_USER_POOL_ID` | User pool ID |
| `VITE_COGNITO_CLIENT_ID` | App client ID |
| `VITE_COGNITO_OAUTH_DOMAIN` | Hosted UI hostname (no `https://`) |
| `VITE_COGNITO_DOMAIN` | Alternate name accepted by `auth.ts` |
| `VITE_ADMIN_API_URL` | API base URL (not Amplify; used by `adminApi.ts`) |

Optional:

| Variable | Purpose |
|----------|---------|
| `VITE_COGNITO_REDIRECT_SIGN_IN` | Extra callback URLs |
| `VITE_COGNITO_REDIRECT_SIGN_OUT` | Extra sign-out URLs |
| `VITE_APP_ORIGIN` | Fixed origin helper in `@soil/shared/lib/env` (logout-related helpers) |

The viewer build must **not** include Cognito variables.

---

## Infrastructure alignment (Terraform)

These Terraform settings must stay in sync with Amplify redirect config:

| Terraform variable | Must include |
|--------------------|--------------|
| `cognito_callback_urls` | `http://localhost:5174/`, admin CloudFront URL with trailing `/` |
| `cognito_logout_urls` | Same as callbacks for this app |
| `cors_allow_origins` | Viewer + admin CloudFront URLs and localhost dev ports (API CORS; separate from Cognito) |

Cognito is **admin-only**. The viewer CloudFront URL is not a Cognito callback.

HCP outputs used at build time: `cognito_user_pool_id`, `cognito_user_pool_client_id`, `cognito_hosted_ui_domain`, `admin_site_url`, `api_endpoint`.

---

## What Amplify is not responsible for

| Concern | Owner |
|---------|--------|
| Hosting admin/viewer static files | S3 + CloudFront (`s3-static-site` Terraform module) |
| API authorization logic | Lambda validates JWT on `/admin/api/*` |
| Public read routes | Viewer `publicApi.ts` — no auth |
| Splats / assets CORS | Assets S3 bucket + CloudFront CDN |
| Cognito user pool lifecycle | Terraform `cognito-user-pool` module |

---

## Operational notes

- **Same origin for OAuth:** Sign-in must be initiated from an origin listed in `redirectSignIn`. Amplify throws if the flow starts from an unregistered origin.
- **Rebuild after env changes:** `VITE_*` values are baked in at `npm run build:admin`; changing Cognito or API URLs requires a new deploy.
- **Bundle size:** The `aws-amplify` meta-package pulls several `@aws-amplify/*` subpackages; only Auth is used. Tree-shaking reduces unused code but the dependency tree is still larger than a minimal OIDC client.
- **Local dev:** Admin dev server runs on port **5174** (`npm run dev:admin`); Cognito must allow `http://localhost:5174/` in callback and logout URLs.

---

## Related documentation

- [`DECOUPLED-APPS.md`](./DECOUPLED-APPS.md) — two-app architecture and deploy overview
- [`DEPLOY-S3-CLOUDFRONT.md`](./DEPLOY-S3-CLOUDFRONT.md) — build env vars, Cognito URL checklist, smoke tests
- Lab repo: `terraform-setup-template/docs/virtual-soils-hcp-deployment.md` — HCP apply and IAM
