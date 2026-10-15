"use client";
import { useEffect, useState } from "react";
import type { Item } from "@stash/shared";
import { api } from "./api";
import { downloadPdf } from "./pdf-transfer";
type Pages = { state: string; pageCount: number | null; errorCode: string | null; pages: { page: number; text: string; truncated: boolean }[] };
const messages: Record<string, string> = { processing_memory_limit: "This PDF needs more memory than we allow for text extraction. The original is still available to download.", password_protected: "This PDF is password protected. Upload an unlocked copy to read its text here.", no_extractable_text: "This PDF has no selectable text. Scanned documents need OCR, which is not supported yet.", too_many_pages: "Text extraction supports PDFs with up to 100 pages.", too_much_text: "This PDF contains more text than we can extract.", invalid_pdf: "We could not read this PDF. Try a fresh copy of the file." };
export function PdfReader({ item, onReady }: { item: Item; onReady: () => Promise<void> }) {
  const [data, setData] = useState<Pages | null>(null), [from, setFrom] = useState(1), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await api<Pages>(`/items/${item.id}/pages?from=${from}`);
        if (stopped) return;
        setData(next); setError("");
        if (["queued", "processing"].includes(next.state)) timer = setTimeout(load, 4000);
        else if (next.state === "ready" && item.pdf?.state !== "ready") await onReady();
      } catch (e) { if (!stopped) setError((e as Error).message); }
    };
    void load(); return () => { stopped = true; clearTimeout(timer); };
  }, [item.id, item.pdf?.state, from, refresh, onReady]);
  async function retry() {
    setBusy(true); setError("");
    try { await api(`/items/${item.id}/extract`, { method: "POST", body: "{}" }); setRefresh(v => v + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="pdf-reader" aria-label="PDF document">
    <div className="pdf-toolbar"><span>{item.pdf?.filename} · {item.pdf && item.pdf.byteSize < 1048576 ? `${Math.max(1, Math.round(item.pdf.byteSize / 1024))} KB` : `${((item.pdf?.byteSize || 0) / 1048576).toFixed(1)} MB`}{data?.pageCount ? ` · ${data.pageCount} ${data.pageCount === 1 ? "page" : "pages"}` : ""}</span><button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await downloadPdf(item); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Download PDF</button></div>
    {data && ["queued", "processing"].includes(data.state) && <p role="status">Preparing the text. You can leave this page and come back.</p>}
    {data?.state === "failed" && <div><p>{messages[data.errorCode || ""] || "Text extraction did not finish. Your original PDF is still saved."}</p><button className="button secondary" disabled={busy} onClick={() => void retry()}>Try extraction again</button></div>}
    {data?.state === "ready" && <><div className="pdf-pages">{data.pages.map(page => <section key={page.page}><h2>Page {page.page}</h2><p>{page.text || "No text on this page."}</p>{page.truncated && <small>Text shortened. Download the original to read this page in full.</small>}</section>)}</div>{(data.pageCount || 0) > 5 && <nav className="pdf-pagination" aria-label="PDF pages"><button className="button secondary" disabled={from === 1} onClick={() => setFrom(v => Math.max(1, v - 5))}>Previous pages</button><span>{from}–{Math.min(from + 4, data.pageCount!)} of {data.pageCount}</span><button className="button secondary" disabled={from + 4 >= data.pageCount!} onClick={() => setFrom(v => v + 5)}>Next pages</button></nav>}</>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
