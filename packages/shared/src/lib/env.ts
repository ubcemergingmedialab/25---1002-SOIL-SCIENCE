/** App origin for OAuth redirects (build override or current page). */
export function appOrigin(): string {
  if (import.meta.env.VITE_APP_ORIGIN) {
    return import.meta.env.VITE_APP_ORIGIN.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env (or set build-time CI secrets) with your Virtual Soils Cognito / hosting values.`,
    );
  }
  return value;
}

export function cognitoUserPoolId(): string {
  return requireEnv(
    import.meta.env.VITE_COGNITO_USER_POOL_ID,
    "VITE_COGNITO_USER_POOL_ID",
  );
}

export function cognitoClientId(): string {
  return requireEnv(
    import.meta.env.VITE_COGNITO_CLIENT_ID,
    "VITE_COGNITO_CLIENT_ID",
  );
}

export function cognitoOAuthDomain(): string {
  return requireEnv(
    import.meta.env.VITE_COGNITO_OAUTH_DOMAIN,
    "VITE_COGNITO_OAUTH_DOMAIN",
  );
}
