"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { Play, RotateCcw } from "lucide-react";

export function HeroIllustration() {
  return <div className="hero-art"><Image src="/stash-hero.webp" width={1000} height={985} alt="A folder holding saved references, links, and notes" sizes="(max-width: 560px) 320px, (max-width: 850px) 440px, 510px" preload /></div>;
}

const steps = [
  { label: "Save", title: "Keep the link and the context.", description: "Ask your agent to stash a useful link while you chat. Add a note so you remember why it matters." },
  { label: "Organize", title: "Give it a place in your work.", description: "Add it to a collection with related links. One resource can belong to several collections." },
  { label: "Retrieve", title: "Find it when you need it.", description: "Pick it up in another conversation. Ask your agent to find it, or search your library yourself." },
];
export function ProductStory() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (step < 2) setStep(step + 1);
      else setPlaying(false);
    }, 1800);
    return () => clearTimeout(timer);
  }, [playing, step]);
  function selectStep(index: number) { setPlaying(false); setStep(index); }
  function play() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStep(2); return; }
    setStep(0); setPlaying(true);
  }
  return (
    <section className="product-story" id="how-it-works" aria-labelledby="product-story-title">
      <div className="product-story-heading"><p className="site-kicker">How it works</p><h2 id="product-story-title">From this conversation<br />to the next.</h2></div>
      <div className="story-demo">
        <div className="story-graphic">
          <svg viewBox="0 0 600 330" role="img" aria-label={`Example: ${steps[step].title}`}>
            <g className={`scene-layer ${step === 0 ? "scene-visible" : ""}`}>
              <rect x="65" y="60" width="205" height="205" rx="9" fill="white" stroke="#dce1d5" strokeWidth="1.5" />
              <path d="M65 89H270" stroke="#e7ebe2" strokeWidth="1.5" /><circle cx="80" cy="75" r="3" fill="#d0d7c7" /><circle cx="91" cy="75" r="3" fill="#d0d7c7" /><circle cx="102" cy="75" r="3" fill="#d0d7c7" />
              <rect x="85" y="108" width="165" height="59" rx="3" fill="#f1f3eb" /><path d="M85 188H218M85 202H242M85 216H219M85 230H175" stroke="#e2e7db" strokeWidth="3" strokeLinecap="round" />
              <path d="M287 162H317M309 155L317 162L309 169" fill="none" stroke="#9ba88f" strokeWidth="1.5" strokeLinecap="round" />
            </g>
            <g className={`scene-layer ${step === 1 ? "scene-visible" : ""}`}>
              <path d="M151 138Q151 125 164 125H260L279 104H430Q443 104 443 117V262Q443 275 430 275H164Q151 275 151 262Z" fill="#e9edde" stroke="#ccd5be" strokeWidth="1.5" />
              <path d="M165 248H431" stroke="#d6dec9" strokeWidth="1.5" />
              <text x="177" y="255" fill="#526047" fontSize="12" fontFamily="sans-serif">Reading list</text>
            </g>
            <g className={`scene-layer ${step === 2 ? "scene-visible" : ""}`}>
              <rect x="110" y="61" width="380" height="44" rx="6" fill="white" stroke="#d4dcc9" strokeWidth="1.5" />
              <circle cx="132" cy="81" r="6" fill="none" stroke="#76866a" strokeWidth="1.5" /><path d="M136 86L141 91" stroke="#76866a" strokeWidth="1.5" />
              <text x="153" y="88" fill="#43513c" fontSize="12" fontFamily="sans-serif">Find my saved article</text>
              <path d="M300 117V135M294 129L300 135L306 129" fill="none" stroke="#9ba88f" strokeWidth="1.5" strokeLinecap="round" />
            </g>
            <g className="saved-link" style={{ transform: step === 0 ? "translate(337px, 113px)" : step === 1 ? "translate(206px, 75px) rotate(-4deg)" : "translate(175px, 151px)" }}>
              <rect width="245" height="140" rx="8" fill="white" stroke="#cfd7c5" strokeWidth="1.5" />
              <rect x="18" y="18" width="29" height="29" rx="5" fill="#f0f3e8" />
              <g transform="translate(25 25)" stroke="#758668" strokeWidth="1.5" strokeLinecap="round" fill="none"><path d="M5 10L10 5M3 8L2 9a4 4 0 006 6l2-2M12 7l1-1a4 4 0 00-6-6L5 2" /></g>
              <text x="57" y="31" fontSize="12" fontWeight="600" fill="#303b2a" fontFamily="sans-serif">A useful article</text>
              <text x="57" y="46" fontSize="10" fill="#68745f" fontFamily="sans-serif">Source saved with your notes</text>
              <path d="M18 67H227" stroke="#e7ebe2" /><text x="18" y="87" fontSize="10" fill="#68745f" fontFamily="sans-serif">A reference for my next project.</text>
              <rect x="18" y="105" width="83" height="20" rx="3" fill="#f0edf8" /><text x="29" y="118" fontSize="9" fill="#645185" fontFamily="sans-serif">Research</text>
              <g className={`scene-layer ${step === 2 ? "scene-visible" : ""}`}><circle cx="224" cy="-3" r="13" fill="#68795a" /><path d="M218-3L222 1L230-7" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" /></g>
            </g>
          </svg>
        </div>
        <div className="story-explanation">
          <div className="story-controls" role="group" aria-label="Explore how Stash works">
            {steps.map((item, index) => <button key={item.label} type="button" aria-pressed={step === index} onClick={() => selectStep(index)}><span>0{index + 1}</span>{item.label}</button>)}
          </div>
          <div className="story-description" aria-live="polite"><h3>{steps[step].title}</h3><p>{steps[step].description}</p></div>
          <button type="button" className="story-play" onClick={play} disabled={playing}>{step === 2 ? <RotateCcw size={14} /> : <Play size={14} />}{playing ? "Playing…" : step === 2 ? "Replay walkthrough" : "Play walkthrough"}</button>
        </div>
      </div>
    </section>
  );
}
