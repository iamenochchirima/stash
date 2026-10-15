/* Private downloads are streamed, never placed in CacheStorage or persistent storage. */
const transfers = new Map();
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  const value = event.data, port = event.ports[0];
  if (!port || !event.source || new URL(event.source.url).origin !== self.location.origin) return;
  try {
    const target = new URL(value.url), format=value.format||"zip";
    if(!["zip","json","bookmarks"].includes(format))throw new Error();
    if (!/^[a-f0-9-]{36}$/.test(value.id) || !/^[A-Za-z0-9_-]{43}$/.test(value.token) || target.pathname !== "/backup-transfers/export" || target.search || target.hash || target.username || target.password || !(target.protocol === "https:" || target.protocol === "http:" && ["127.0.0.1", "localhost"].includes(target.hostname))) throw new Error();
    if (transfers.size >= 3 || transfers.has(value.id)) throw new Error();
    const timer = setTimeout(() => { transfers.delete(value.id); port.postMessage({ type: "error" }); port.close(); }, 60000);
    transfers.set(value.id, { url: target.href, token: value.token, format, port, timer });
    port.postMessage({ type: "ready" });
  } catch { port.postMessage({ type: "error" }); port.close(); }
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/backup-download/")) return;
  event.respondWith((async () => {
    const id = url.pathname.slice("/backup-download/".length), value = transfers.get(id);
    if (!value) return new Response("Download permission expired. Start the backup again.", { status: 410, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
    transfers.delete(id); clearTimeout(value.timer);
    try {
      const response = await fetch(value.url, { headers: { Authorization: `Bearer ${value.token}` }, credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15 * 60 * 1000) });
      const type={zip:"application/zip",json:"application/json",bookmarks:"text/html"}[value.format], filename={zip:"stash-backup.zip",json:"stash-export.json",bookmarks:"stash-bookmarks.html"}[value.format];
      if (!response.ok || !response.body || !response.headers.get("Content-Type")?.startsWith(type)) throw new Error();
      value.port.postMessage({ type: "started" });
      const reader = response.body.getReader();
      const finish = type => { value.port.postMessage({ type }); value.port.close(); };
      const body = new ReadableStream({
        async pull(controller) { try { const part = await reader.read(); if (part.done) { controller.close(); finish("complete"); } else controller.enqueue(part.value); } catch { controller.error(new Error("Backup interrupted")); finish("error"); } },
        async cancel(reason) { await reader.cancel(reason); finish("error"); },
      });
      return new Response(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    } catch { value.port.postMessage({ type: "error" }); value.port.close(); return new Response("Backup failed. Return to Stash and try again.", { status: 502, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } }); }
  })());
});
