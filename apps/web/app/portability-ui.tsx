"use client";
import { useState,useEffect,useRef } from "react";
import { api } from "./api";
import { prepareBackup,restoreBackup } from "./backup-restore";
import type { OpenBackup } from "./backup-archive";
import { downloadBackup } from "./backup-download";
type Preview = {
  missingOriginals?: number;
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
    [report, setReport] = useState(""),
    [bookmarkCounts,setBookmarkCounts]=useState<{links:number;omitted:number}|null>(null);
  const [backup,setBackup]=useState<{archive:OpenBackup;pdfs:number;missingOriginals:number}|null>(null),[progress,setProgress]=useState("");
  const active=useRef<{controller:AbortController;archive?:OpenBackup}|null>(null);
  useEffect(()=>()=>{active.current?.controller.abort();void active.current?.archive?.close();},[]);
  return (
    <div>
      <p className="muted">
        Import browser bookmarks or a Stash export. Existing items keep their content.
      </p>
      <label className="import-file">
        Choose an import file
        <input
          type="file"
          accept=".zip,.json,.html,.htm,application/zip,application/json,text/html"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            active.current?.controller.abort();await active.current?.archive?.close();
            active.current=null;setBackup(null);setProgress("");
            setInput(null);
            setPreview(null);
            setReport("");
            setError("");
            if (!file) return;
            setBusy(true);
            try {
              if(file.name.toLowerCase().endsWith(".zip")){
                const controller=new AbortController();active.current={controller};
                const prepared=await prepareBackup(file,controller.signal,setProgress);active.current.archive=prepared.archive;setBackup(prepared);setProgress("");return;
              }
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
      {busy && <p role="status">{progress||"Processing your file…"}</p>}
      {backup&&<div className="import-preview"><h3>Restore backup</h3>
        <p>{backup.archive.manifest.items.length} {backup.archive.manifest.items.length===1?"item":"items"} · {backup.pdfs} original {backup.pdfs===1?"PDF":"PDFs"} · {backup.archive.manifest.projects.length} {backup.archive.manifest.projects.length===1?"project":"projects"}</p>
        {!!backup.missingOriginals&&<p>{backup.missingOriginals} PDFs have saved text only.</p>}
        <button className="button primary full" disabled={busy} onClick={async()=>{
          setBusy(true);setError("");setReport("");
          try{
            const result=await restoreBackup(backup.archive,active.current!.controller.signal,setProgress);
            setReport(`${result.saved} restored, ${result.duplicates} existing, ${result.originals} ${result.originals===1?"original":"originals"} added.`);setBackup(null);await backup.archive.close();active.current=null;await onImported();
          }catch(e){setError(`${(e as Error).message} Existing content is preserved. You can retry this backup.`);}
          finally{setBusy(false);setProgress("");}
        }}>Restore backup</button></div>}
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
          {!!preview.missingOriginals && <p>{preview.missingOriginals} {preview.missingOriginals===1?"PDF will be restored without its original file.":"PDFs will be restored without their original files."} Use a full backup to include originals.</p>}
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
              ? `Import ${preview.toSave} items`
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
      <p className="muted">A full backup includes your items and original PDFs. Data-only exports include saved text and organisation.</p>
      <button className="button primary full" disabled={busy} onClick={async()=>{
        setBusy(true);setError("");setReport("");
        try{await downloadBackup(()=>setReport("Your full backup has downloaded."),setError);setReport("Your backup is downloading. Keep this page open until it finishes.");}
        catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>Download full backup</button>
      <button
        className="button secondary full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await downloadBackup(()=>setReport("Your data export has downloaded."),setError,"json");
            setReport("Your data export is downloading.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Export data only
      </button>
      <button className="button secondary full" disabled={busy} onClick={async()=>{
        setBusy(true);setError("");try{setBookmarkCounts(await api<{links:number;omitted:number}>("/items/bookmarks"));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
      }}>Export bookmarks</button>
      {bookmarkCounts&&<div className="import-preview"><p>{bookmarkCounts.links} {bookmarkCounts.links===1?"link":"links"} · {bookmarkCounts.omitted} other {bookmarkCounts.omitted===1?"item":"items"} omitted</p><p className="muted">Link titles and URLs only. Use a Stash backup to keep notes, files and organisation.</p>
        <button className="button secondary full" disabled={busy||!bookmarkCounts.links} onClick={async()=>{
          setBusy(true);setError("");try{await downloadBackup(()=>setReport("Your bookmarks have downloaded."),setError,"bookmarks");setReport("Your bookmarks are downloading.");}catch(e){setError((e as Error).message);}finally{setBusy(false);}
        }}>Download bookmarks</button></div>}
    </div>
  );
}
