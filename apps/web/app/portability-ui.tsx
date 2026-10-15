"use client";
import { useState } from "react";
import { api } from "./api";
type Preview = {
  collectionsToCreate: number;
  total: number;
  valid: number;
  duplicates: number;
  toSave: number;
  rejected: { index: number; error: string }[];
};
export function Portability({
  onImported,
}: {
  onImported: () => Promise<void>;
}) {
  const [input, setInput] = useState<{
      format: "json" | "html";
      content: string;
    } | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState("");
  return (
    <div>
      <p className="muted">
        Import browser bookmarks or a Stash export. Existing items keep their content.
      </p>
      <label className="import-file">
        Choose an import file
        <input
          type="file"
          accept=".json,.html,.htm,application/json,text/html"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            setInput(null);
            setPreview(null);
            setReport("");
            setError("");
            if (!file) return;
            setBusy(true);
            try {
              const format = file.name.toLowerCase().endsWith(".json")
                ? "json"
                : "html";
              if (file.size > (format === "json" ? 134217728 : 1048576))
                throw new Error(
                  "JSON imports must be under 128 MiB; bookmark HTML must be under 1 MiB.",
                );
              const content = new TextDecoder("utf-8", { fatal: true }).decode(
                await file.arrayBuffer(),
              );
              const data = { format, content } as const;
              setPreview(
                await api<Preview>("/items/import/preview", {
                  method: "POST",
                  body: JSON.stringify(data),
                }),
              );
              setInput(data);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {busy && <p role="status">Processing your file…</p>}
      {preview && (
        <div className="import-preview">
          <h3>Import preview</h3>
          {preview.collectionsToCreate > 0 && (
            <p>
              {preview.collectionsToCreate} new collections will be created.
            </p>
          )}
          <p>
            {preview.total} entries · {preview.toSave} new ·{" "}
            {preview.duplicates} duplicates · {preview.rejected.length} rejected
          </p>
          {preview.rejected.length > 0 && (
            <details>
              <summary>Rejected entries</summary>
              <ul>
                {preview.rejected.map((r) => (
                  <li key={r.index}>
                    Entry {r.index}: {r.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            className="button primary full"
            disabled={busy || (!preview.toSave && !preview.collectionsToCreate)}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await api<{
                  saved: number;
                  duplicates: number;
                  rejected: Preview["rejected"];
                  collectionErrors: { name: string; error: string }[];
                }>("/items/import", { method: "POST", body: JSON.stringify(input) });
                setReport(
                  `${result.saved} saved, ${result.duplicates} duplicates, ${result.rejected.length} rejected.`,
                );
                setPreview(null);
                if (result.rejected.length || result.collectionErrors.length)
                  setError(
                    [
                      ...result.rejected.map(
                        (r) => `Entry ${r.index}: ${r.error}`,
                      ),
                      ...result.collectionErrors.map(
                        (r) => `Collection ${r.name}: ${r.error}`,
                      ),
                    ].join(" "),
                  );
                await onImported();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {preview.toSave
              ? `Import ${preview.toSave} resources`
              : "Import collections"}
          </button>
        </div>
      )}
      {report && (
        <p role="status" className="success-note">
          {report}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <hr />
      <h3>Take your library with you</h3>
      <p className="muted">
        Export item content, organisation and profile details as JSON. Original PDF files require a full backup. Passwords and credentials are excluded.
      </p>
      <button
        className="button secondary full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const data = await api("/items/export");
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              }),
            );
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "stash-export.json";
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setReport("Your library export is ready.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Export my library
      </button>
    </div>
  );
}
