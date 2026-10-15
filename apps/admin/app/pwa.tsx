"use client";

import { useEffect, useRef, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function Pwa({ children, name }: { children: React.ReactNode; name: string }) {
  const [installed, setInstalled] = useState(true);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const sync = () => setInstalled(standalone.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    const available = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const done = () => { setInstalled(true); setPrompt(null); dialog.current?.close(); };
    sync();
    standalone.addEventListener("change", sync);
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", done);
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => { /* The online app remains usable if installation is unavailable. */ });
    }
    return () => {
      standalone.removeEventListener("change", sync);
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  async function install() {
    if (prompt) {
      setPrompt(null);
      try { await prompt.prompt(); await prompt.userChoice; } catch { dialog.current?.showModal(); }
    } else dialog.current?.showModal();
  }
  return <>{children}{!installed && <footer className="pwa-footer"><button ref={trigger} type="button" onClick={install}>Install {name}</button></footer>}
    <dialog ref={dialog} className="pwa-dialog" aria-labelledby="pwa-title" onClose={() => trigger.current?.focus()}>
      <h2 id="pwa-title">Install {name}</h2>
      <p>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</p>
      <p>On iPhone or iPad, use Safari's Share menu, then <strong>Add to Home Screen</strong>. On Mac, use Safari's File menu, then <strong>Add to Dock</strong>.</p>
      <p className="pwa-note">An internet connection is needed to use {name}.</p>
      <button type="button" autoFocus onClick={() => dialog.current?.close()}>Got it</button>
    </dialog>
  </>;
}
