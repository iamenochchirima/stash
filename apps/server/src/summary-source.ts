import { createHash } from "node:crypto";
import { load } from "cheerio";
import { sql } from "drizzle-orm";
import type { Database } from "@stash/db";
import type { SummarySnapshot } from "@stash/shared";
import { resolveTarget, requestPage, withDeadline, type Resolver } from "./metadata.js";
export async function articleText(value: string, boundary: { resolver?: Resolver; request?: typeof requestPage } = {}) {
  const started = Date.now();
  for (let redirect = 0; redirect <= 3; redirect++) {
    const remaining = () => Math.max(1, 7000 - (Date.now() - started));
    if (Date.now() - started >= 7000) throw new Error("source_unavailable");
    const { url, address } = await withDeadline(resolveTarget(value, boundary.resolver), remaining());
    const page = await (boundary.request || requestPage)(url, address, remaining());
    if (page.status >= 300 && page.status < 400 && page.location) { value = new URL(page.location, url).toString(); continue; }
    if (page.status !== 200 || Buffer.byteLength(page.body) > 524288 || !page.contentType.toLowerCase().startsWith("text/html")) throw new Error("source_unavailable");
    const $ = load(page.body);
    if ($('[class*="paywall"],[id*="paywall"],[data-paywall]').length || /"isAccessibleForFree"\s*:\s*(false|"false")/i.test(page.body)) throw new Error("source_unavailable");
    $("script,style,nav,header,footer,aside,iframe,form,button,noscript,[hidden],[aria-hidden='true'],[style*='display:none'],[style*='display: none']").remove();
    const article = $("article").first(), main = $("main,[role='main']").first();
    const root = article.length ? article : main.length ? main : $("body");
    root.find("p,h1,h2,h3,h4,li,pre,blockquote").append("\n\n");
    const text = root.text().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 250 || /(subscribe|sign in|log in) to (read|continue reading|continue to read)/i.test(text)) throw new Error("source_unavailable");
    return { text, url: url.toString() };
  }
  throw new Error("source_unavailable");
}
function chunks(text: string, budget: number, limit: number) {
  const parts: string[] = []; let offset = 0;
  while (offset < text.length && budget > 0 && parts.length < limit) {
    let end = Math.min(offset + 600, text.length, offset + budget);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end - 2);
      if (paragraph >= offset + 180) end = paragraph + 2;
      else { const word = text.lastIndexOf(" ",end - 1); if (word >= offset + 400) end = word + 1; }
    }
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    if (end <= offset) break;
    const part = text.slice(offset,end); parts.push(part); budget -= part.length; offset = end;
  }
  return { parts, consumed: offset };
}
export async function summarySource(db: Database, userId: string, id: string, revision: number, boundary?: Parameters<typeof articleText>[1]) {
  const found = await db.execute(sql`select kind,url,source_revision from resources where id=${id} and user_id=${userId} and deleted_at is null`);
  const item = found.rows[0];
  if (!item || Number(item.source_revision) !== revision) throw new Error("source_changed");
  const snapshot: SummarySnapshot = { kind: item.kind === "pdf" ? "pdf" : "link", sources: [], partial: false, totalCharacters: 0, includedCharacters: 0 };
  let fullText = "";
  if (item.kind === "pdf") {
    const file = await db.execute(sql`select pages from attachments where resource_id=${id} and user_id=${userId} and state='ready'`);
    if (!file.rows.length) throw new Error("source_unavailable");
    const pages = file.rows[0].pages as { page: number; text: string }[];
    fullText = pages.map(p => p.text).join("\n\n"); snapshot.totalCharacters = pages.reduce((n,p)=>n+p.text.length,0);
    let remaining = 12000, consumed = 0;
    for (const page of pages) {
      if (!page.text.trim()) continue;
      const divided = chunks(page.text,remaining,40 - snapshot.sources.length);
      for (const text of divided.parts) snapshot.sources.push({ id: `s${snapshot.sources.length + 1}`, label: `Page ${page.page}`, page: page.page, text });
      consumed += divided.consumed; remaining -= divided.consumed;
    }
    snapshot.partial = consumed < snapshot.totalCharacters;
  } else if (item.kind === "link") {
    const article = await articleText(String(item.url), boundary); fullText = article.text; snapshot.url = article.url;
    snapshot.totalCharacters = fullText.length;
    const divided = chunks(fullText,12000,40);
    for (const text of divided.parts) snapshot.sources.push({id:`s${snapshot.sources.length + 1}`,label:`Section ${snapshot.sources.length + 1}`,text});
    snapshot.partial = divided.consumed < fullText.length;
  } else throw new Error("source_unavailable");
  snapshot.includedCharacters = snapshot.sources.reduce((n,s)=>n+s.text.length,0);
  if (!snapshot.sources.length || snapshot.includedCharacters < 12) throw new Error("source_unavailable");
  return { snapshot, hash: createHash("sha256").update(fullText).digest("hex") };
}
