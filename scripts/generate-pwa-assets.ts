import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
const worker = await readFile("scripts/pwa/worker.js", "utf8");
for (const app of ["web", "admin"]) {
  const name = app === "web" ? "Stash" : "Stash Admin";
  const directory = `apps/${app}/public`;
  await mkdir(`${directory}/icons`, { recursive: true });
  const icons: Buffer[] = [];
  for (const [file, size, maskable] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["maskable-512.png", 512, true], ["apple-touch-icon.png", 180, true]] as const) {
    const admin = app === "admin", side = Math.round(size * (admin ? .48 : maskable ? .52 : .68));
    const logo = await sharp("apps/web/public/stash.png").resize(side, side).png().toBuffer();
    const composites: sharp.OverlayOptions[] = [{ input: logo, left: Math.round((size-side)/2), top: Math.round(size*(admin ? .19 : (1-side/size)/2)) }];
    if (admin) composites.push({input:Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect x="${size*.23}" y="${size*.66}" width="${size*.54}" height="${size*.13}" rx="${size*.035}" fill="#6752bd"/><text x="50%" y="${size*.751}" text-anchor="middle" font-family="sans-serif" font-size="${size*.078}" font-weight="700" fill="white">ADMIN</text></svg>`),top:0,left:0});
    const png = await sharp({create:{width:size,height:size,channels:4,background:admin ? "#f4f1ff" : "#ffffff"}}).composite(composites).png().toBuffer();
    await writeFile(`${directory}/icons/${file}`, png); icons.push(png);
  }
  const offline = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#ffffff"><title>${name} · Offline</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#252b29;font-family:system-ui,sans-serif}main{width:min(360px,calc(100% - 48px));padding:40px 0}img{width:64px;height:64px;border-radius:14px}small{display:block;margin-top:18px;color:#69716d}h1{font-size:30px;letter-spacing:-1px;margin:14px 0}p{color:#69716d;line-height:1.6}a{display:inline-block;margin-top:14px;padding:12px 18px;border-radius:6px;background:#27312b;color:#fff;text-decoration:none}a:focus-visible{outline:3px solid #6752bd;outline-offset:4px}</style></head><body><main><img src="/icons/icon-192.png" alt=""><small>${name}</small><h1>You’re offline.</h1><p>Reconnect to open ${app === "admin" ? "your admin workspace" : "your library"}.</p><a href="">Try again</a></main></body></html>`;
  await writeFile(`${directory}/offline.html`, offline);
  const version = createHash("sha256").update(worker).update(offline); icons.forEach(icon=>version.update(icon));
  const prefix = `stash-${app}-public-`;
  await writeFile(`${directory}/sw.js`, worker.replace("__CACHE__",prefix+version.digest("hex").slice(0,12)).replace("__PREFIX__",prefix));
}
