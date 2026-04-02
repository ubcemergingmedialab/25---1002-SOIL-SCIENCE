import { Amplify } from "aws-amplify";

/**
 * OAuth redirect URLs must match the page origin where sign-in runs, or Amplify
 * throws "The oauth flow needs to be initiated from the same origin".
 * Register every URL you use (localhost, Amplify preview URLs, custom domain) in
 * Cognito → App client → Hosted UI → Allowed callback / sign-out URLs.
 */
function oauthRedirects(): { signIn: string[]; signOut: string[] } {
  const origin = window.location.origin;
  console.log("OAUTH SIGN OUT: " + origin);
  return {
    signIn: [`${origin}/admin`],
    signOut: [`${origin}/`],
  };
}

const { signIn, signOut } = oauthRedirects();

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolClientId: "q7bro5cdr1ucb3g7c00d420q5",
      userPoolId: "ca-central-1_VnLGRFo8k",

      loginWith: {
        oauth: {
          domain: "ca-central-1vnlgrfo8k.auth.ca-central-1.amazoncognito.com",
          scopes: ["openid", "email"],
          redirectSignIn: signIn,
          redirectSignOut: signOut,
          responseType: "code", // PKCE
        },
      },
    },
  },
});
