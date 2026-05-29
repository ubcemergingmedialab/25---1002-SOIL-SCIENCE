import { type ReactNode, useEffect, useState } from "react";
import { fetchAuthSession, signInWithRedirect } from "aws-amplify/auth";

type AuthState = "checking" | "authed";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>("checking");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens?.accessToken?.toString();
        if (!token) {
          await signInWithRedirect();
          return;
        }
        if (!cancelled) setAuthState("authed");
      } catch {
        await signInWithRedirect();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (authState === "checking") {
    return <div style={{ padding: 24 }}>Redirecting to login...</div>;
  }

  return <>{children}</>;
}
