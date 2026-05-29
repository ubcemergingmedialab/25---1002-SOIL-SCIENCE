import { Amplify } from "aws-amplify";

/**
 * OAuth redirect URLs must match the page origin where sign-in runs, or Amplify
 * throws "The oauth flow needs to be initiated from the same origin".
 * Register every URL you use (localhost, Amplify preview URLs, custom domain) in
 * Cognito → App client → Hosted UI → Allowed callback / sign-out URLs.
 */
function oauthRedirects(): { signIn: string[]; signOut: string[] } {
  const origin = window.location.origin;
  return {
    signIn: [import.meta.env.VITE_COGNITO_REDIRECT_SIGN_IN || `${origin}/admin`],
    signOut: [import.meta.env.VITE_COGNITO_REDIRECT_SIGN_OUT || `${origin}/`],
  };
}

const { signIn, signOut } = oauthRedirects();
const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined;
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const domain = import.meta.env.VITE_COGNITO_DOMAIN as string | undefined;

if (!userPoolClientId || !userPoolId || !domain) {
  throw new Error(
    "Admin app Cognito env is incomplete. Set VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID, and VITE_COGNITO_DOMAIN."
  );
}

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolClientId,
      userPoolId,

      loginWith: {
        oauth: {
          domain,
          scopes: ["openid", "email"],
          redirectSignIn: signIn,
          redirectSignOut: signOut,
          responseType: "code", // PKCE
        },
      },
    },
  },
});
