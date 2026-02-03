import { useEffect, useState } from "react";
import { fetchAuthSession, signInWithRedirect, signOut } from "aws-amplify/auth";
import { createField, listFields } from "./adminApi";

type FieldItem = {
  FieldID: string;
  Name: string;
  Description?: string;
  Latitude?: number;
  Longitude?: number;
};

type AuthState = "checking" | "authed";

export default function Admin() {
  const [authState, setAuthState] = useState<AuthState>("checking");

  const [items, setItems] = useState<FieldItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [FieldID, setFieldID] = useState("");
  const [Name, setName] = useState("");
  const [Description, setDescription] = useState("");
  const [Latitude, setLatitude] = useState("");
  const [Longitude, setLongitude] = useState("");

  // Auth gate: do not render portal until authenticated
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

  async function load() {
    setErr("");
    setBusy(true);
    try {
      const data = await listFields();
      setItems(data.items as FieldItem[]);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Only load data after authenticated
  useEffect(() => {
    if (authState !== "authed") return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  async function onAdd() {
    setErr("");
    setBusy(true);
    try {
      const out = await createField({
        FieldID: FieldID.trim(),
        Name: Name.trim(),
        Description: Description.trim(),
        Latitude: Latitude.trim(),
        Longitude: Longitude.trim(),
      });
      setItems((prev) => [out.item as FieldItem, ...prev]);
      setFieldID("");
      setName("");
      setDescription("");
      setLatitude("");
      setLongitude("");
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await signOut();
    const domain = "ca-central-1vnlgrfo8k.auth.ca-central-1.amazoncognito.com";
    const clientId = "q7bro5cdr1ucb3g7c00d420q5";
    const logoutUri = "http://localhost:5173/";
    window.location.assign(
      `https://${domain}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(logoutUri)}`
    );
  }

  // While checking auth, render nothing (no flash)
  if (authState === "checking") {
    //return null;
    return <div style={{ padding: 24 }}>Redirecting to login…</div>;
  }

  // Authenticated portal
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Admin</h1>
        <button onClick={onLogout}>Log out</button>
      </div>

      <p>Authenticated ✅</p>
      {err && <pre style={{ color: "crimson" }}>{err}</pre>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxWidth: 720 }}>
        <input placeholder="FieldID (pk)" value={FieldID} onChange={(e) => setFieldID(e.target.value)} />
        <input placeholder="Name" value={Name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Latitude" value={Latitude} onChange={(e) => setLatitude(e.target.value)} />
        <input placeholder="Longitude" value={Longitude} onChange={(e) => setLongitude(e.target.value)} />
        <textarea
          style={{ gridColumn: "1 / -1", height: 80 }}
          placeholder="Description"
          value={Description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onAdd} disabled={busy || !FieldID.trim() || !Name.trim()}>
            Add entry
          </button>
          <button onClick={load} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      <hr style={{ margin: "16px 0" }} />

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>FieldID</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Name</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Latitude</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Longitude</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.FieldID}>
              <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>{it.FieldID}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>{it.Name}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>{it.Latitude ?? ""}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>{it.Longitude ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {busy && <p>Loading…</p>}
    </div>
  );
}
