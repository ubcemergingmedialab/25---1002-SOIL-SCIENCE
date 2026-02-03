import { Amplify } from "aws-amplify";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolClientId: "q7bro5cdr1ucb3g7c00d420q5",
      userPoolId: "ca-central-1_VnLGRFo8k",

      loginWith: {
        oauth: {
          domain: "ca-central-1vnlgrfo8k.auth.ca-central-1.amazoncognito.com",
          scopes: ["openid", "email"],
          redirectSignIn: ["http://localhost:5173/admin"],
          redirectSignOut: ["http://localhost:5173/"],
          responseType: "code", // PKCE
        },
      },
    },
  },
});
