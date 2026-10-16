"use client";
import { useEffect, useState } from "react";

let renderer: Promise<typeof import("mermaid")["default"]> | undefined;
function loadRenderer() {
  return renderer ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 30000,
      maxEdges: 200,
      theme: "neutral",
      fontFamily: "Arial, sans-serif",
      htmlLabels: false,
      logLevel: "fatal",
      secure: [...Object.keys(mermaid.mermaidAPI.getConfig()), "secure"],
    });
    return mermaid;
  });
}

export function MermaidDiagram({ source }: { source: string }) {
  const [result, setResult] = useState<{ source: string; image?: string; width?: number; failed?: boolean }>();
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let active = true;
    setZoom(1);
    async function render() {
      try {
        if (source.length > 30000) throw new Error("Diagram too large");
        const mermaid = await loadRenderer();
        const { svg } = await mermaid.render(`stash-diagram-${crypto.randomUUID()}`, source);
        const document = new DOMParser().parseFromString(svg, "image/svg+xml");
        const width = Number(document.documentElement.getAttribute("viewBox")?.trim().split(/[ ,]+/)[2]) || 640;
        if (active) setResult({ source, width, image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
      } catch {
        if (active) setResult({ source, failed: true });
      }
    }
    void render();
    return () => { active = false; };
  }, [source]);
  const current = result?.source === source ? result : undefined;
  return (
    <figure className="mermaid-diagram">
      {current?.image ? <>
        <div className="mermaid-toolbar" role="group" aria-label="Diagram zoom">
          <button type="button" onClick={() => setZoom(Math.max(.5, zoom - .25))} disabled={zoom <= .5} aria-label="Zoom out diagram">−</button>
          <button type="button" onClick={() => setZoom(1)} aria-label="Reset diagram zoom">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => setZoom(Math.min(3, zoom + .25))} disabled={zoom >= 3} aria-label="Zoom in diagram">+</button>
        </div>
        <div className="mermaid-viewport" role="region" aria-label="Mermaid diagram" tabIndex={0}>
          <img src={current.image} alt="Mermaid diagram" style={{ width: `${zoom * 100}%`, maxWidth: `${zoom * (current.width || 640)}px`, minWidth: `${zoom * ((current.width || 640) > 640 ? 640 : 0)}px` }} />
        </div>
      </> : <p role="status">{current?.failed ? "This diagram could not be rendered. Its source is available below." : "Rendering diagram…"}</p>}
      <details key={`${source}-${!!current?.failed}`} open={current?.failed || undefined}>
        <summary>Diagram source</summary>
        <pre tabIndex={0} role="region" aria-label="Diagram source code"><code className="language-mermaid">{source}</code></pre>
      </details>
    </figure>
  );
}
