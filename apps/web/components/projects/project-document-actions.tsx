"use client";
import { useState } from "react";
import Link from "next/link";
import type { Item } from "@stash/shared";
import { api } from "../../lib/api";
export function ProjectDocumentActions({ item }: { item: Item }) {
  const [history, setHistory] = useState<
      { revision: number; createdAt: string; characters: number }[]
    >([]),
    [body, setBody] = useState<string | null>(null),
    [error, setError] = useState(""),
    [promotion, setPromotion] = useState(false),
    [excerpt, setExcerpt] = useState(""),
    [saved, setSaved] = useState(""),
    [busy, setBusy] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  return (
    <>
      {item.projectSourceId && (
        <Link
          className="project-reference"
          href={`/items/${item.projectSourceId}`}
        >
          View original project research ↗
        </Link>
      )}
      {item.projectId && !item.deletedAt && (
        <>
          <div className="project-actions">
            <Link
              className="project-reference"
              href={`/projects/${item.projectId}`}
            >
              Open project
            </Link>
            <button
              className="button secondary"
              onClick={() => {
                setPromotion((v) => !v);
                setExcerpt(
                  (item.body || item.notes || item.title).length <= 10000
                    ? item.body || item.notes || item.title
                    : "",
                );
              }}
            >
              Save to library
            </button>
          </div>
          {promotion && (
            <form
              className="project-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const r = await api<{ item: Item }>(
                    `/items/${item.id}/promote`,
                    {
                      method: "POST",
                      body: JSON.stringify({ body: excerpt, requestId }),
                    },
                  );
                  setSaved(r.item.id);
                  setPromotion(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                {item.kind === "link" ? "Context to keep" : "Excerpt to keep"}
                <textarea
                  aria-label="Excerpt to keep"
                  rows={6}
                  required
                  maxLength={item.kind === "link" ? 10000 : 50000}
                  value={excerpt}
                  onChange={(e) => {
                    setExcerpt(e.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                />
              </label>
              <p>
                A library copy links back to this research. The project original
                stays here.
              </p>
              <button className="button primary" disabled={busy}>
                Save library copy
              </button>
            </form>
          )}
          {saved && (
            <Link className="project-reference" href={`/items/${saved}`}>
              Open library copy ↗
            </Link>
          )}
          {["note", "idea"].includes(item.kind) && (
            <details
              className="project-history"
              onToggle={(e) => {
                if (e.currentTarget.open)
                  void api<{ items: typeof history }>(
                    `/items/${item.id}/history`,
                  )
                    .then((r) => setHistory(r.items))
                    .catch((e) => setError(e.message));
              }}
            >
              <summary>Revision history</summary>
              {!history.length && <p>No previous edits yet.</p>}
              {history.map((h) => (
                <p key={h.revision}>
                  <button
                    className="text-button"
                    onClick={() =>
                      void api<{ body: string }>(
                        `/items/${item.id}/history?revision=${h.revision}`,
                      )
                        .then((r) => setBody(r.body))
                        .catch((e) => setError(e.message))
                    }
                  >
                    Revision {h.revision}
                  </button>{" "}
                  · {new Date(h.createdAt).toLocaleString()} ·{" "}
                  {h.characters.toLocaleString()} characters
                </p>
              ))}
              {body !== null && <pre>{body}</pre>}
            </details>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
