import { api } from "./api";
async function downloadWorker() {
  if (!("serviceWorker" in navigator)) throw new Error("This browser cannot stream exports. Try a current browser.");
  const registration = await navigator.serviceWorker.register("/backup-download-sw.js", { scope: "/backup-download/", updateViaCache: "none" });
  await registration.update();
  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker) throw new Error("Could not prepare the download. Try again.");
  if(worker.state==="activated")return worker;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { worker.removeEventListener("statechange", check); reject(new Error("Could not prepare the download. Try again.")); }, 15000);
    function check() { if (worker!.state === "activated" || worker!.state === "redundant") { clearTimeout(timer); worker!.removeEventListener("statechange", check); worker!.state === "activated" ? resolve() : reject(new Error("Could not prepare the download. Try again.")); } }
    worker.addEventListener("statechange", check); check();
  });
  return worker;
}
export async function downloadBackup(onComplete:()=>void,onError:(message:string)=>void,format:"zip"|"json"|"bookmarks"="zip") {
  const worker = await downloadWorker();
  const ticket = await api<{token:string;downloadUrl:string}>("/backups/export", { method: "POST", body: JSON.stringify({format}) });
  const channel = new MessageChannel(), id = crypto.randomUUID();
  const frame = document.createElement("iframe"); frame.hidden = true; frame.title = "Download Stash backup";
  let settled = false, timer: ReturnType<typeof setTimeout>;
  const cleanup = () => { clearTimeout(timer); channel.port1.close(); setTimeout(() => frame.remove(), 1000); };
  await new Promise<void>((resolve,reject) => {
    timer = setTimeout(() => { cleanup(); if (!settled) reject(new Error("Could not start the backup. Try again.")); else onError("The backup took too long. Try again."); }, 15 * 60 * 1000);
    channel.port1.onmessage = event => {
      if (event.data.type === "ready") { frame.src = `/backup-download/${id}`; document.body.append(frame); }
      if (event.data.type === "started") { settled = true; resolve(); }
      if (event.data.type === "complete") { onComplete(); cleanup(); }
      if (event.data.type === "error") { cleanup(); const message = "The download could not finish. Try again."; if (!settled) reject(new Error(message)); else onError(message); }
    };
    worker.postMessage({id,url:ticket.downloadUrl,token:ticket.token,format},[channel.port2]);
  });
}
