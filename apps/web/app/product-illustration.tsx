"use client";
import Image from "next/image";
import { FileText, Link2 } from "lucide-react";
export { ProductStory } from "./save-demo";

const assistants = [
  { name: "ChatGPT", logo: "/agents/chatgpt.svg", x: "27%", y: "12%", viaX: "42%", viaY: "22%", delay: "0s", kind: "link", title: "Designing for focus", detail: "Article · Read later" },
  { name: "Claude", logo: "/agents/claude.png", x: "78%", y: "23%", viaX: "70%", viaY: "39%", delay: "4s", kind: "note", title: "An idea worth keeping", detail: "Note · Project research" },
  { name: "Grok", logo: "/agents/grok.svg", x: "83%", y: "76%", viaX: "67%", viaY: "66%", delay: "8s", kind: "link", title: "A fresh perspective", detail: "Reference · Research" },
  { name: "Gemini", logo: "/agents/gemini.png", x: "25%", y: "85%", viaX: "28%", viaY: "63%", delay: "12s", kind: "link", title: "Better reading habits", detail: "Article · Read later" },
  { name: "Lina", logo: "/agents/lina.png", x: "11%", y: "48%", viaX: "28%", viaY: "35%", delay: "16s", kind: "note", title: "Notes from our chat", detail: "Note · Keep for later" },
];

export function HeroIllustration() {
  return (
    <div className="hero-art hero-stream" role="img" aria-label="Links, ideas, and research notes from different agents collecting in your Stash folder">
      <div className="hero-stream-scene" aria-hidden="true">
        <svg className="hero-stream-paths" viewBox="0 0 500 500" fill="none">
          <circle cx="250" cy="250" r="160" stroke="#ebece6" strokeDasharray="2 8" />
          <path d="M135 60 Q170 145 250 250 M390 115 Q350 200 250 250 M415 380 Q330 350 250 250 M125 425 Q170 330 250 250 M55 240 Q155 205 250 250" stroke="#e4e7dd" strokeWidth="1" />
        </svg>
        {assistants.map((agent) => <div key={agent.name} className="hero-agent" style={{ left: agent.x, top: agent.y }}>{agent.logo && <span className="hero-agent-symbol"><img src={agent.logo} width={24} height={24} alt="" /></span>}<span>{agent.name}</span></div>)}
        {assistants.map((agent) => <div key={agent.name} className={`hero-stream-item hero-stream-${agent.kind}`} style={{ "--source-x": agent.x, "--source-y": agent.y, "--via-x": agent.viaX, "--via-y": agent.viaY, animationDelay: agent.delay } as React.CSSProperties}>
          <div className="hero-stream-thumbnail">{agent.kind === "link" ? <img src="/reading-preview.webp" width={38} height={46} alt="" /> : <FileText size={22} />}</div>
          <div className="hero-stream-copy"><span>{agent.kind === "link" ? <Link2 size={9} /> : <FileText size={9} />}{agent.kind === "link" ? "Saved link" : "Saved note"}</span><strong>{agent.title}</strong><small>{agent.detail}</small></div>
        </div>)}
        <div className="hero-folder-glow" />
        <div className="hero-center-folder"><Image src="/stash-hero.webp" width={1000} height={985} alt="" sizes="(max-width: 560px) 150px, 225px" preload /></div>
        <div className="hero-center-folder hero-folder-front"><Image src="/stash-hero.webp" width={1000} height={985} alt="" sizes="(max-width: 560px) 150px, 225px" /></div>
      </div>
    </div>
  );
}
