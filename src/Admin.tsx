import { type CSSProperties, type FormEvent, Fragment, useEffect, useState } from "react";
import { fetchAuthSession, signInWithRedirect, signOut } from "aws-amplify/auth";
import { type CreateFieldPayload, type MarkerPayload, createField, deleteField, listFields, updateField } from "./adminApi";

type FieldItem = {
  FieldID: string;
  Name: string;
  Description?: string;
  Latitude?: number;
  Longitude?: number;
  File?: string;
  Thumbnail?: string;
  ThumbnailAlt?: string;
  markers?: unknown;
};

type AuthState = "checking" | "authed";

type FieldForm = {
  FieldID: string;
  Name: string;
  Description: string;
  File: string;
  Latitude: string;
  Longitude: string;
  Thumbnail: string;
  ThumbnailAlt: string;
};

function createEmptyForm(): FieldForm {
  return {
    FieldID: "",
    Name: "",
    Description: "",
    File: "",
    Latitude: "",
    Longitude: "",
    Thumbnail: "",
    ThumbnailAlt: "",
  };
}

const modalFieldStyle: CSSProperties = {
  background: "#1b1b1b",
  color: "#fff",
  border: "1px solid #444",
  borderRadius: 4,
  padding: 8,
};

const modalTextareaStyle: CSSProperties = {
  ...modalFieldStyle,
  minHeight: 80,
};

const modalButtonStyle: CSSProperties = {
  background: "#333",
  color: "#fff",
  border: "1px solid #555",
  borderRadius: 4,
  padding: "8px 16px",
  cursor: "pointer",
};

const rowActionButtonStyle: CSSProperties = {
  ...modalButtonStyle,
  padding: "6px 12px",
};

const rowDangerButtonStyle: CSSProperties = {
  ...rowActionButtonStyle,
  background: "#5a1010",
  border: "1px solid #993333",
};

function toFormString(value: string | number | null | undefined) {
  if (value === undefined || value === null) return "";
  return String(value);
}

function createFormFromItem(item: FieldItem): FieldForm {
  return {
    FieldID: toFormString(item.FieldID),
    Name: toFormString(item.Name),
    Description: toFormString(item.Description),
    File: toFormString(item.File),
    Latitude: toFormString(item.Latitude),
    Longitude: toFormString(item.Longitude),
    Thumbnail: toFormString(item.Thumbnail),
    ThumbnailAlt: toFormString(item.ThumbnailAlt),
  };
}

type FieldPayloadResult = { payload?: CreateFieldPayload; error?: string };

function buildPayloadFromForm(form: FieldForm): FieldPayloadResult {
  const fieldId = form.FieldID.trim();
  if (!fieldId) return { error: "FieldID is required." };
  const name = form.Name.trim();
  if (!name) return { error: "Name is required." };

  const payload: CreateFieldPayload = {
    FieldID: fieldId,
    Name: name,
  };

  const description = form.Description.trim();
  if (description) payload.Description = description;
  const file = form.File.trim();
  if (file) payload.File = file;
  const thumbnail = form.Thumbnail.trim();
  if (thumbnail) payload.Thumbnail = thumbnail;
  const thumbnailAlt = form.ThumbnailAlt.trim();
  if (thumbnailAlt) payload.ThumbnailAlt = thumbnailAlt;

  const latValue = form.Latitude.trim();
  if (latValue) {
    const lat = Number(latValue);
    if (Number.isNaN(lat)) {
      return { error: "Latitude must be a number." };
    }
    payload.Latitude = lat;
  }

  const lngValue = form.Longitude.trim();
  if (lngValue) {
    const lng = Number(lngValue);
    if (Number.isNaN(lng)) {
      return { error: "Longitude must be a number." };
    }
    payload.Longitude = lng;
  }

  return { payload };
}

export default function Admin() {
  const [authState, setAuthState] = useState<AuthState>("checking");

  const [items, setItems] = useState<FieldItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<FieldForm>(() => createEmptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FieldForm | null>(null);

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

  useEffect(() => {
    if (!editingId) return;
    if (!expanded.has(editingId)) {
      setEditingId(null);
      setEditForm(null);
    }
  }, [editingId, expanded]);

  function resetForm() {
    setForm(createEmptyForm());
  }

  function startEditing(item: FieldItem) {
    setErr("");
    setEditingId(item.FieldID);
    setEditForm(createFormFromItem(item));
  }

  function cancelEditing() {
    setEditingId(null);
    setEditForm(null);
    setErr("");
  }

  function openMarkerManager(fieldId: string, gaussianPath?: string) {
    const params = new URLSearchParams();
    params.set("fieldId", fieldId);
    params.set("controlMode", "fly");
    const trimmedPath = gaussianPath?.trim();
    if (trimmedPath) params.set("gaussianPath", trimmedPath);
    const editorUrl = new URL("/editor", window.location.origin);
    editorUrl.search = params.toString();
    window.open(editorUrl.toString(), "_blank");
  }

  async function onAdd(e?: FormEvent<HTMLFormElement>) {
    if (e) e.preventDefault();
    const result = buildPayloadFromForm(form);
    if (!result.payload) {
      setErr(result.error ?? "Please fix the highlighted form errors.");
      return;
    }

    setErr("");
    setBusy(true);
    try {
      const out = await createField(result.payload);
      setItems((prev) => [out.item as FieldItem, ...prev]);
      resetForm();
      setIsModalOpen(false);
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(fieldId: string) {
    if (!editForm) return;
    const result = buildPayloadFromForm(editForm);
    if (!result.payload) {
      setErr(result.error ?? "Please fix the highlighted form errors.");
      return;
    }

    setErr("");
    setBusy(true);
    try {
      await updateField(fieldId, result.payload);
      await load();
      cancelEditing();
    } catch (e: any) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteEntry(fieldId: string) {
    if (!window.confirm(`Delete entry "${fieldId}"? This cannot be undone.`)) return;
    setErr("");
    setBusy(true);
    try {
      await deleteField(fieldId);
      setItems((prev) => prev.filter((item) => item.FieldID !== fieldId));
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(fieldId);
        return next;
      });
      if (editingId === fieldId) {
        cancelEditing();
      }
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
    <div style={{ padding: 24, background: "#000", color: "#fff", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Admin</h1>
        <button onClick={onLogout}>Log out</button>
      </div>

      <p>Authenticated ✅</p>
      {err && <pre style={{ color: "crimson" }}>{err}</pre>}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => {
            resetForm();
            setErr("");
            setIsModalOpen(true);
          }}
        >
          Add Entry
        </button>
        <button onClick={load} disabled={busy}>
          Refresh
        </button>
      </div>

      <hr style={{ margin: "16px 0" }} />

      <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}>
        <thead>
          <tr>
            <th style={{ width: 40, borderBottom: "1px solid #333" }} />
            <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: 8 }}>FieldID</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #333", padding: 8 }}>Name</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const isExpanded = expanded.has(it.FieldID);
            const markersArray = Array.isArray(it.markers) ? (it.markers as MarkerPayload[]) : [];
            const isEditing = editingId === it.FieldID;
            const currentEditForm = isEditing && editForm ? editForm : null;
            return (
              <Fragment key={it.FieldID}>
                <tr style={{ background: "#141414" }}>
                  <td style={{ borderBottom: "1px solid #222", padding: 8 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(it.FieldID)) next.delete(it.FieldID);
                          else next.add(it.FieldID);
                          return next;
                        })
                      }
                      style={{
                        width: 28,
                        height: 28,
                        border: "none",
                        cursor: "pointer",
                        fontSize: 20,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "#000",
                        color: "#fff",
                        padding: 0,
                      }}
                    >
                      {isExpanded ? "−" : "+"}
                    </button>
                  </td>
                  <td style={{ borderBottom: "1px solid #222", padding: 8 }}>{it.FieldID}</td>
                  <td style={{ borderBottom: "1px solid #222", padding: 8 }}>{it.Name}</td>
                </tr>
                {isExpanded && (
                  <tr style={{ background: "#0a0a0a" }}>
                    <td />
                    <td colSpan={2} style={{ borderBottom: "1px solid #333", padding: 16 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 16,
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: 18 }}>{it.Name || "Untitled Field"}</strong>
                          <p style={{ margin: "4px 0 0", color: "#bbb" }}>FieldID: {it.FieldID}</p>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            style={rowDangerButtonStyle}
                            onClick={() => onDeleteEntry(it.FieldID)}
                            disabled={busy}
                          >
                            Delete Entry
                          </button>
                          {currentEditForm ? (
                            <>
                              <button type="button" style={rowActionButtonStyle} onClick={cancelEditing} disabled={busy}>
                                Cancel
                              </button>
                              <button
                                type="button"
                                style={rowActionButtonStyle}
                                onClick={() => onSaveEdit(it.FieldID)}
                                disabled={busy}
                              >
                                Save Changes
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              style={rowActionButtonStyle}
                              onClick={() => startEditing(it)}
                              disabled={busy}
                            >
                              Modify Entry
                            </button>
                          )}
                        </div>
                      </div>
                      {currentEditForm ? (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <strong>Field ID</strong>
                              <input
                                value={currentEditForm.FieldID}
                                style={{ ...modalFieldStyle, opacity: 0.6, cursor: "not-allowed" }}
                                disabled
                              />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <strong>Name</strong>
                              <input
                                value={currentEditForm.Name}
                                style={modalFieldStyle}
                                onChange={(e) =>
                                  setEditForm((prev) => (prev ? { ...prev, Name: e.target.value } : prev))
                                }
                              />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <strong>File</strong>
                              <input
                                value={currentEditForm.File}
                                style={modalFieldStyle}
                                onChange={(e) =>
                                  setEditForm((prev) => (prev ? { ...prev, File: e.target.value } : prev))
                                }
                              />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <strong>Thumbnail</strong>
                              <input
                                value={currentEditForm.Thumbnail}
                                style={modalFieldStyle}
                                onChange={(e) =>
                                  setEditForm((prev) => (prev ? { ...prev, Thumbnail: e.target.value } : prev))
                                }
                              />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <strong>Thumbnail Alt</strong>
                              <input
                                value={currentEditForm.ThumbnailAlt}
                                style={modalFieldStyle}
                                onChange={(e) =>
                                  setEditForm((prev) => (prev ? { ...prev, ThumbnailAlt: e.target.value } : prev))
                                }
                              />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <strong>Latitude</strong>
                              <input
                                type="number"
                                inputMode="decimal"
                                step="any"
                                value={currentEditForm.Latitude}
                                style={modalFieldStyle}
                                onChange={(e) =>
                                  setEditForm((prev) => (prev ? { ...prev, Latitude: e.target.value } : prev))
                                }
                              />
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <strong>Longitude</strong>
                              <input
                                type="number"
                                inputMode="decimal"
                                step="any"
                                value={currentEditForm.Longitude}
                                style={modalFieldStyle}
                                onChange={(e) =>
                                  setEditForm((prev) => (prev ? { ...prev, Longitude: e.target.value } : prev))
                                }
                              />
                            </div>
                          </div>
                          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                            <strong>Description</strong>
                            <textarea
                              style={{ ...modalTextareaStyle, gridColumn: "1 / -1" }}
                              placeholder="Description"
                              value={currentEditForm.Description}
                              onChange={(e) =>
                                setEditForm((prev) => (prev ? { ...prev, Description: e.target.value } : prev))
                              }
                            />
                          </div>
                          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                            <strong>Markers</strong>
                            <p style={{ margin: 0, color: "#bbb" }}>
                              Use the 3D editor to manage this field&apos;s markers.
                            </p>
                            <button
                              type="button"
                              style={modalButtonStyle}
                              onClick={() => openMarkerManager(currentEditForm.FieldID, currentEditForm.File)}
                            >
                              Manage Markers
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                            <div>
                              <strong>Latitude</strong>
                              <p style={{ margin: "4px 0 0" }}>{it.Latitude ?? "—"}</p>
                            </div>
                            <div>
                              <strong>Longitude</strong>
                              <p style={{ margin: "4px 0 0" }}>{it.Longitude ?? "—"}</p>
                            </div>
                            <div>
                              <strong>Description</strong>
                              <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{it.Description ?? "—"}</p>
                            </div>
                            <div>
                              <strong>File</strong>
                              <p style={{ margin: "4px 0 0" }}>{it.File ?? "—"}</p>
                            </div>
                            <div>
                              <strong>Thumbnail</strong>
                              <p style={{ margin: "4px 0 0" }}>{it.Thumbnail ?? "—"}</p>
                            </div>
                            <div>
                              <strong>Thumbnail Alt</strong>
                              <p style={{ margin: "4px 0 0" }}>{it.ThumbnailAlt ?? "—"}</p>
                            </div>
                          </div>
                          <div style={{ marginTop: 16 }}>
                            <strong>Markers</strong>
                            {markersArray.length === 0 ? (
                              <p style={{ margin: "4px 0 0" }}>—</p>
                            ) : (
                              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 4 }}>Icon</th>
                                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 4 }}>Scale</th>
                                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 4 }}>Pos X</th>
                                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 4 }}>Pos Y</th>
                                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 4 }}>Pos Z</th>
                                    <th style={{ textAlign: "left", borderBottom: "1px solid #444", padding: 4 }}>Text</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {markersArray.map((marker, idx) => (
                                    <tr key={`${it.FieldID}-marker-${idx}`} style={{ background: "#111" }}>
                                      <td style={{ borderBottom: "1px solid #222", padding: 4 }}>
                                        {marker[0] ? (
                                          <img
                                            src={marker[0]}
                                            alt={`marker icon ${idx + 1}`}
                                            style={{ width: 32, height: 32, objectFit: "contain" }}
                                          />
                                        ) : (
                                          ""
                                        )}
                                      </td>
                                      <td style={{ borderBottom: "1px solid #222", padding: 4 }}>{marker[1] ?? ""}</td>
                                      <td style={{ borderBottom: "1px solid #222", padding: 4 }}>{marker[2]?.[0] ?? ""}</td>
                                      <td style={{ borderBottom: "1px solid #222", padding: 4 }}>{marker[2]?.[1] ?? ""}</td>
                                      <td style={{ borderBottom: "1px solid #222", padding: 4 }}>{marker[2]?.[2] ?? ""}</td>
                                      <td style={{ borderBottom: "1px solid #222", padding: 4 }}>{marker[3] ?? ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {isModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
          }}
        >
          <div
            style={{
              background: "#050505",
              color: "#fff",
              padding: 24,
              borderRadius: 8,
              width: "min(720px, 95vw)",
              maxHeight: "90vh",
              overflow: "auto",
              border: "1px solid #222",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Add Entry</h2>
            <form onSubmit={onAdd} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <input
                placeholder="FieldID (pk)"
                value={form.FieldID}
                style={modalFieldStyle}
                onChange={(e) => setForm((prev) => ({ ...prev, FieldID: e.target.value }))}
              />
              <input
                placeholder="Name"
                value={form.Name}
                style={modalFieldStyle}
                onChange={(e) => setForm((prev) => ({ ...prev, Name: e.target.value }))}
              />
              <input
                placeholder="File"
                value={form.File}
                style={modalFieldStyle}
                onChange={(e) => setForm((prev) => ({ ...prev, File: e.target.value }))}
              />
              <input
                placeholder="Thumbnail"
                value={form.Thumbnail}
                style={modalFieldStyle}
                onChange={(e) => setForm((prev) => ({ ...prev, Thumbnail: e.target.value }))}
              />
              <input
                placeholder="Thumbnail Alt Text"
                value={form.ThumbnailAlt}
                style={modalFieldStyle}
                onChange={(e) => setForm((prev) => ({ ...prev, ThumbnailAlt: e.target.value }))}
              />
              <input
                placeholder="Latitude"
                type="number"
                inputMode="decimal"
                step="any"
                value={form.Latitude}
                style={modalFieldStyle}
                onChange={(e) => setForm((prev) => ({ ...prev, Latitude: e.target.value }))}
              />
              <input
                placeholder="Longitude"
                type="number"
                inputMode="decimal"
                step="any"
                value={form.Longitude}
                style={modalFieldStyle}
                onChange={(e) => setForm((prev) => ({ ...prev, Longitude: e.target.value }))}
              />
              <textarea
                style={{ ...modalTextareaStyle, gridColumn: "1 / -1" }}
                placeholder="Description"
                value={form.Description}
                onChange={(e) => setForm((prev) => ({ ...prev, Description: e.target.value }))}
              />
              <p style={{ gridColumn: "1 / -1", margin: "8px 0 0", color: "#bbb" }}>
                Markers can be added from the editor after creating the field.
              </p>
              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" style={modalButtonStyle} onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" style={modalButtonStyle} disabled={busy || !form.FieldID.trim() || !form.Name.trim()}>
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {busy && <p>Loading…</p>}
    </div>
  );
}
