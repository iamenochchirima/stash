"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Item, Collection } from "@stash/shared";
import { api, ApiError } from "./api";
export function clearItemDrafts() {
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith("stash-draft:")) sessionStorage.removeItem(key); } catch { /* Private browsing can disable browser storage. */ }
}
type Draft = { kind: "link" | "note" | "idea"; title: string; url: string; body: string; notes: string; tags: string; collectionIds: string[]; status: string; revision: number; requestId: string };
export function ItemEditor({ userId, editing, collections, selectedCollection, onSaved }: {
  userId: string; editing?: Item | null; collections: Collection[]; selectedCollection?: string; onSaved: (item: Item, duplicate?: boolean) => void | Promise<void>;
}) {
  const draftKey = `stash-draft:${userId}:${editing?.id || "new"}`;
  const initial: Draft = { kind: editing?.kind === "idea" ? "idea" : editing?.kind === "note" ? "note" : "link", title: editing?.title || "", url: editing?.url || "", body: editing?.body || "", notes: editing?.notes || "", tags: editing?.tags.join(", ") || "", collectionIds: editing?.collectionIds || (selectedCollection ? [selectedCollection] : []), status: editing?.status || "unread", revision: editing?.revision || 1, requestId: crypto.randomUUID() };
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null");
      if (!saved || typeof saved !== "object") return initial;
      const next = { ...initial };
      for (const key of ["title", "url", "body", "notes", "tags", "requestId"] as const) if (typeof saved[key] === "string") next[key] = saved[key];
      if (["link", "note", "idea"].includes(saved.kind)) next.kind = saved.kind;
      if (["unread", "reading", "done"].includes(saved.status)) next.status = saved.status;
      if (Array.isArray(saved.collectionIds)) next.collectionIds = saved.collectionIds.filter((v: unknown) => typeof v === "string").slice(0, 20);
      if (Number.isInteger(saved.revision) && saved.revision > 0) next.revision = saved.revision;
      return next;
    } catch { return initial; }
  });
  const [dirty, setDirty] = useState(() => { try { return !!sessionStorage.getItem(draftKey); } catch { return false; } });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [conflict, setConflict] = useState(false), [latest, setLatest] = useState<Item | null>(null);
  function change(patch: Partial<Draft>) { setDraft(d => ({ ...d, ...patch })); setDirty(true); }
  useEffect(() => {
    if (!dirty) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* Saving remains available when browser storage is full. */ }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, dirty, draftKey]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const common = { title: draft.title, notes: draft.notes, tags: draft.tags.split(",").map(t => t.trim()).filter(Boolean), collectionIds: draft.collectionIds };
    const input = editing ? { ...common, revision: draft.revision, ...(["note", "idea"].includes(editing.kind) ? { body: draft.body } : { status: draft.status }) } : { ...common, kind: draft.kind, requestId: draft.requestId, ...(draft.kind === "link" ? { url: draft.url, status: draft.status } : { body: draft.body }) };
    try {
      const result = await api<{ item: Item; duplicate?: boolean }>(editing ? `/items/${editing.id}` : "/items", { method: editing ? "PATCH" : "POST", body: JSON.stringify(input) });
      try { sessionStorage.removeItem(draftKey); } catch {} setDirty(false); await onSaved(result.item, result.duplicate);
    } catch (e) { setError((e as Error).message); setConflict(e instanceof ApiError && e.status === 409 && !!editing); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit}>
    {!editing && <label>Type<select aria-label="Type" value={draft.kind} onChange={e => change({ kind: e.target.value as Draft["kind"] })}><option value="link">Link</option><option value="note">Note</option><option value="idea">Idea</option></select></label>}
    {draft.kind === "link" && <label>Link<input type="url" required={!editing} disabled={!!editing} maxLength={2048} value={draft.url} onChange={e => change({ url: e.target.value })} placeholder="https://…" /></label>}
    <label>Title<input maxLength={200} value={draft.title} onChange={e => change({ title: e.target.value })} placeholder={draft.kind === "link" ? "Optional, use the page title" : "Optional, use the first line"} /></label>
    {draft.kind !== "link" && <label>Content<textarea aria-label="Content" required maxLength={50000} rows={10} value={draft.body} onChange={e => change({ body: e.target.value })} placeholder="Write it down. Markdown supported." /><small>Up to 50,000 characters. Headings, lists, links and code blocks supported.</small></label>}
    <label>Why it matters<textarea maxLength={10000} rows={3} value={draft.notes} onChange={e => change({ notes: e.target.value })} placeholder="Optional context for later" /></label>
    <div className="form-row"><fieldset className="collection-picker"><legend>Collections</legend>{collections.map(c => <label key={c.id}><input type="checkbox" checked={draft.collectionIds.includes(c.id)} onChange={e => change({ collectionIds: e.target.checked ? [...draft.collectionIds, c.id] : draft.collectionIds.filter(id => id !== c.id) })} />{c.name}</label>)}</fieldset>{(draft.kind === "link" || editing?.kind === "pdf") && <label>Reading status<select value={draft.status} onChange={e => change({ status: e.target.value })}><option value="unread">Unread</option><option value="reading">Reading</option><option value="done">Finished</option></select></label>}</div>
    <label>Tags<input aria-label="Tags" value={draft.tags} onChange={e => change({ tags: e.target.value })} placeholder="research, ideas" /><small>Separate with commas.</small></label>
    {error && <p role="alert" className="error">{error}</p>}
    {conflict && editing && <section className="edit-conflict"><button type="button" className="button secondary" onClick={() => api<{ item: Item }>(`/items/${editing.id}`).then(r => setLatest(r.item)).catch(e => setError(e.message))}>Review latest version</button>{latest && <><h3>Latest saved version</h3><p>{latest.title}</p><pre>{latest.body || latest.notes}</pre><p>Your unsaved changes remain in the editor above.</p><button type="button" className="button secondary" onClick={() => { change({ revision: latest.revision }); setConflict(false); setLatest(null); setError(""); }}>Use this revision for my next save</button></>}</section>}
    <div className="form-actions"><small>{dirty ? "Unsaved changes" : ""}</small><button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Save item"}</button></div>
  </form>;
}
