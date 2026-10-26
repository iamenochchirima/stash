"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Item, Collection } from "@stash/shared";
import { TopicPicker } from "../topics/topic-picker";
import { uploadPdf } from "../../lib/pdf-transfer";
import { api, ApiError } from "../../lib/api";
export {
  clearItemDrafts,
  scopeItemDraftsToUser,
} from "../../lib/draft-storage";
type Draft = {
  kind: "link" | "note" | "idea" | "pdf";
  title: string;
  url: string;
  body: string;
  notes: string;
  tags: string;
  collectionIds: string[];
  topicIds: string[];
  status: string;
  revision: number;
  requestId: string;
};
export function ItemEditor({
  userId,
  editing,
  collections,
  selectedCollection,
  selectedTopic,
  projectId,
  onSaved,
}: {
  projectId?: string;
  userId: string;
  editing?: Item | null;
  collections: Collection[];
  selectedCollection?: string;
  selectedTopic?: string;
  onSaved: (item: Item, duplicate?: boolean) => void | Promise<void>;
}) {
  const workspaceId = editing?.projectId || projectId;
  const contentLimit = workspaceId ? 500000 : 50000;
  const draftKey = `stash-draft:${userId}:${editing?.id || (workspaceId ? `project-${workspaceId}` : "new")}`;
  const initial: Draft = {
    kind: editing?.kind || "link",
    title: editing?.title || "",
    url: editing?.url || "",
    body: editing?.body || "",
    notes: editing?.notes || "",
    tags: editing?.tags.join(", ") || "",
    collectionIds:
      editing?.collectionIds ||
      (selectedCollection ? [selectedCollection] : []),
    topicIds: editing?.topicIds || (selectedTopic ? [selectedTopic] : []),
    status: editing?.status || "unread",
    revision: editing?.revision || 1,
    requestId: crypto.randomUUID(),
  };
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null");
      if (!saved || typeof saved !== "object") return initial;
      const next = { ...initial };
      for (const key of [
        "title",
        "url",
        "body",
        "notes",
        "tags",
        "requestId",
      ] as const)
        if (typeof saved[key] === "string") next[key] = saved[key];
      if (!editing && ["link", "note", "idea", "pdf"].includes(saved.kind))
        next.kind = saved.kind;
      if (["unread", "reading", "done"].includes(saved.status))
        next.status = saved.status;
      if (Array.isArray(saved.collectionIds))
        next.collectionIds = saved.collectionIds
          .filter((v: unknown) => typeof v === "string")
          .slice(0, 20);
      if (!workspaceId && Array.isArray(saved.topicIds))
        next.topicIds = saved.topicIds
          .filter((value: unknown) => typeof value === "string")
          .slice(0, 20);
      if (Number.isInteger(saved.revision) && saved.revision > 0)
        next.revision = saved.revision;
      return next;
    } catch {
      return initial;
    }
  });
  const [file, setFile] = useState<File | null>(null),
    [progress, setProgress] = useState(0);
  const [pdfAvailable, setPdfAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    void api<{ available: boolean }>("/items/uploads/status")
      .then((r) => setPdfAvailable(r.available))
      .catch(() => setPdfAvailable(false));
  }, []);
  const [topicBusy, setTopicBusy] = useState(false);
  const [draftWarning, setDraftWarning] = useState("");
  const [dirty, setDirty] = useState(() => {
    try {
      return !!sessionStorage.getItem(draftKey);
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<Item | null>(null);
  function change(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  }
  useEffect(() => {
    if (!dirty) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
      setDraftWarning("");
    } catch {
      setDraftWarning(
        "Draft storage is unavailable. Keep this editor open until you save.",
      );
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const ended = () => {
      window.removeEventListener("beforeunload", warn);
      setDirty(false);
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("stash-session-ended", ended);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("stash-session-ended", ended);
    };
  }, [draft, dirty, draftKey]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (topicBusy) return;
    setBusy(true);
    setError("");
    const common = {
      title: draft.title,
      notes: draft.notes,
      tags: draft.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      collectionIds: draft.collectionIds,
      ...(!workspaceId ? { topicIds: draft.topicIds } : {}),
    };
    const input = editing
      ? {
          ...common,
          revision: draft.revision,
          ...(["note", "idea"].includes(editing.kind)
            ? { body: draft.body }
            : { status: draft.status }),
        }
      : {
          ...common,
          projectId: workspaceId,
          kind: draft.kind,
          requestId: draft.requestId,
          ...(draft.kind === "link"
            ? { url: draft.url, status: draft.status }
            : { body: draft.body }),
        };
    try {
      if (!editing && draft.kind === "pdf") {
        if (!file) throw new Error("Choose a PDF file.");
        if (file.size > 20 * 1024 * 1024)
          throw new Error("PDFs can be up to 20 MB.");
        const saved = await uploadPdf(
          file,
          setProgress,
          {
            projectId: workspaceId,
            ...common,
            status: draft.status,
            requestId: draft.requestId,
          },
          userId,
        );
        try {
          sessionStorage.removeItem(draftKey);
        } catch {}
        setDirty(false);
        await onSaved(saved);
        return;
      }
      const result = await api<{ item: Item; duplicate?: boolean }>(
        editing ? `/items/${editing.id}` : "/items",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "X-Stash-Account": userId },
          body: JSON.stringify(input),
        },
      );
      try {
        sessionStorage.removeItem(draftKey);
      } catch {}
      setDirty(false);
      await onSaved(result.item, result.duplicate);
    } catch (e) {
      setError((e as Error).message);
      setConflict(e instanceof ApiError && e.status === 409 && !!editing);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset
        className="item-editor-fields"
        aria-label="Item details"
        disabled={busy}
      >
        {!editing && (
          <label>
            Type
            <select
              aria-label="Type"
              value={draft.kind}
              onChange={(e) =>
                change({ kind: e.target.value as Draft["kind"] })
              }
            >
              <option value="link">Link</option>
              <option value="note">Note</option>
              <option value="idea">Idea</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
        )}
        {!editing && draft.kind === "pdf" && (
          <label>
            PDF file
            <input
              type="file"
              accept="application/pdf,.pdf"
              aria-label="PDF file"
              disabled={busy || !pdfAvailable}
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                change({ requestId: crypto.randomUUID() });
                setProgress(0);
              }}
            />
            <small>
              {pdfAvailable === false
                ? "PDF storage is not connected yet."
                : "Up to 20 MB and 100 pages. Text-based PDFs supported."}
            </small>
            {busy && (
              <progress
                aria-label="Upload progress"
                max={100}
                value={progress}
              />
            )}
          </label>
        )}
        {draft.kind === "link" && (
          <label>
            Link
            <input
              type="url"
              required={!editing}
              disabled={!!editing}
              maxLength={2048}
              value={draft.url}
              onChange={(e) => change({ url: e.target.value })}
              placeholder="https://…"
            />
          </label>
        )}
        <label>
          Title
          <input
            maxLength={200}
            value={draft.title}
            onChange={(e) => change({ title: e.target.value })}
            placeholder={
              draft.kind === "pdf"
                ? "Optional, use the filename"
                : draft.kind === "link"
                  ? "Optional, use the page title"
                  : "Optional, use the first line"
            }
          />
        </label>
        {["note", "idea"].includes(draft.kind) && (
          <label>
            Content
            <textarea
              aria-label="Content"
              required
              maxLength={contentLimit}
              rows={10}
              value={draft.body}
              onChange={(e) => change({ body: e.target.value })}
              placeholder="Write it down. Markdown supported."
            />
            <small>
              Up to {contentLimit.toLocaleString()} characters. Headings, lists,
              links and code blocks supported.
            </small>
          </label>
        )}
        <label>
          Why it matters
          <textarea
            maxLength={10000}
            rows={3}
            value={draft.notes}
            onChange={(e) => change({ notes: e.target.value })}
            placeholder="Optional context for later"
          />
        </label>
        {!workspaceId && (
          <TopicPicker
            selected={draft.topicIds}
            onPendingChange={setTopicBusy}
            onChange={(topicIds) => change({ topicIds })}
          />
        )}
        <details className="item-editor-options">
          <summary>More options</summary>
          <div className="form-row">
            {!workspaceId && (
              <fieldset className="collection-picker">
                <legend>Collections</legend>
                {collections.map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={draft.collectionIds.includes(c.id)}
                      onChange={(e) =>
                        change({
                          collectionIds: e.target.checked
                            ? [...draft.collectionIds, c.id]
                            : draft.collectionIds.filter((id) => id !== c.id),
                        })
                      }
                    />
                    {c.name}
                  </label>
                ))}
              </fieldset>
            )}
            {["link", "pdf"].includes(draft.kind) && (
              <label>
                Reading status
                <select
                  value={draft.status}
                  onChange={(e) => change({ status: e.target.value })}
                >
                  <option value="unread">Unread</option>
                  <option value="reading">Reading</option>
                  <option value="done">Finished</option>
                </select>
              </label>
            )}
          </div>
          <label>
            Tags
            <input
              aria-label="Tags"
              value={draft.tags}
              onChange={(e) => change({ tags: e.target.value })}
              placeholder="research, ideas"
            />
            <small>Separate with commas.</small>
          </label>
        </details>
        {draftWarning && <p role="status">{draftWarning}</p>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {conflict && editing && (
          <section className="edit-conflict">
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                api<{ item: Item }>(`/items/${editing.id}`)
                  .then((r) => setLatest(r.item))
                  .catch((e) => setError(e.message))
              }
            >
              Review latest version
            </button>
            {latest && (
              <>
                <h3>Latest saved version</h3>
                <p>{latest.title}</p>
                {latest.body && <pre>{latest.body}</pre>}
                {latest.notes && (
                  <p>
                    <strong>Why it matters</strong>
                    <br />
                    {latest.notes}
                  </p>
                )}
                {latest.tags.length > 0 && (
                  <p>Tags: {latest.tags.join(", ")}</p>
                )}
                {latest.collectionIds.length > 0 && (
                  <p>
                    Collections:{" "}
                    {collections
                      .filter((c) => latest.collectionIds.includes(c.id))
                      .map((c) => c.name)
                      .join(", ")}
                  </p>
                )}
                {["link", "pdf"].includes(latest.kind) && (
                  <p>
                    Reading status:{" "}
                    {latest.status === "done"
                      ? "Finished"
                      : latest.status === "reading"
                        ? "Reading"
                        : "Unread"}
                  </p>
                )}
                <p>Your unsaved changes remain in the editor above.</p>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    change({ revision: latest.revision });
                    setConflict(false);
                    setLatest(null);
                    setError("");
                  }}
                >
                  Use this revision for my next save
                </button>
              </>
            )}
          </section>
        )}
        <div className="form-actions">
          <small>{dirty ? "Unsaved changes" : ""}</small>
          {dirty && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                if (!confirm("Discard your unsaved changes?")) return;
                try {
                  sessionStorage.removeItem(draftKey);
                } catch {}
                setDraft(initial);
                setDirty(false);
                setConflict(false);
                setLatest(null);
                setError("");
                setFile(null);
                setProgress(0);
                setDraftWarning("");
              }}
            >
              Discard draft
            </button>
          )}
          <button
            type="submit"
            className="button primary"
            disabled={
              busy ||
              topicBusy ||
              (!editing && draft.kind === "pdf" && !pdfAvailable)
            }
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Save item"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
