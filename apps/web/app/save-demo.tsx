"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowUp, ArrowUpRight, BatteryFull, Check, ChevronDown, ChevronRight, Ellipsis, Folder, PanelLeft, Pause, Play, Plus, RotateCcw, Signal, SquarePen, Wifi } from "lucide-react";

const DURATION = 13200;
const END_HOLD = 1800;
const REQUEST = "Stash that article for later. Add it to my Design collection.";
const phaseAt = (time: number) => time < 1600 ? 0 : time < 4300 ? 1 : time < 4800 ? 2 : time < 5600 ? 3 : time < 8800 ? 4 : time < 9500 ? 5 : time < 10800 ? 6 : 7;

export function ProductStory() {
  const position = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const visible = useRef(false);
  const manuallyPaused = useRef(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const phase = phaseAt(time);
  const finished = time >= DURATION;
  const typed = REQUEST.slice(0, Math.max(0, Math.floor((time - 1600) / 39)));


  function seek(next: number) {
    manuallyPaused.current = true;
    setPlaying(false);
    position.current = next;
    setTime(next);
  }
  function toggle() {
    if (reducedMotion) { seek(11000); return; }
    if (playing) { manuallyPaused.current = true; setPlaying(false); return; }
    manuallyPaused.current = false;
    if (finished) { position.current = 0; setTime(0); }
    setPlaying(true);
  }
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      setReducedMotion(media.matches);
      if (media.matches) { setPlaying(false); position.current = 11000; setTime(11000); }
      else if (visible.current && !document.hidden && !manuallyPaused.current) setPlaying(true);
    };
    change();
    media.addEventListener("change", change);
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting && entry.intersectionRatio >= 0.35;
      setPlaying(visible.current && !document.hidden && !media.matches && !manuallyPaused.current);
    }, { threshold: 0.35 });
    if (viewport.current) observer.observe(viewport.current);
    const visibility = () => setPlaying(!document.hidden && visible.current && !media.matches && !manuallyPaused.current);
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); media.removeEventListener("change", change); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    let last = performance.now();
    let published = last;
    const tick = (now: number) => {
      position.current += now - last;
      if (position.current >= DURATION + END_HOLD) position.current = 0;
      last = now;
      if (now - published >= 32) { setTime(Math.min(DURATION, position.current)); published = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  return (
    <section className="product-story" id="how-it-works" aria-labelledby="product-story-title">
      <div className="product-story-heading">
        <p className="site-kicker">A quick look at Stash</p>
        <h2 id="product-story-title">A good find.<br />Saved in a few words.</h2>
        <p className="demo-intro">Keep researching. Let your agent handle the saving.</p>
      </div>
      <div ref={viewport} className={`save-demo phase-${phase} ${reducedMotion ? "demo-reduced-motion" : ""}`} aria-label="Illustrated example of saving a research link with an agent">
        <div className="demo-window-bar"><span className="demo-window-dots" aria-hidden="true"><i /><i /><i /></span><span>A research session</span><span className="demo-example">Example workflow</span></div>
        <div className="demo-stage">
          <div className="demo-chat">
            <div className="demo-chat-heading"><span className="demo-chat-nav" aria-hidden="true"><PanelLeft size={16} /><SquarePen size={16} /></span><strong>ChatGPT <ChevronDown size={12} /></strong><Ellipsis size={18} className="demo-chat-menu" aria-hidden="true" /></div>
            <div className={`demo-research ${phase >= 4 ? "demo-research-condensed" : ""}`}>
              <p>This is a useful read on making long articles easier to follow.</p>
              <div className="demo-source"><span className="demo-source-thumbnail"><Image src="/reading-preview.webp" fill alt="" sizes="54px" /></span><span>Designing better reading experiences</span><ArrowUpRight size={13} /></div>
            </div>
            <div className={`demo-request ${phase >= 2 ? "demo-shown" : ""}`} aria-hidden={phase < 2}><p>{REQUEST}</p></div>
            <div className={`demo-thinking ${phase === 3 ? "demo-shown" : ""}`} aria-hidden={phase !== 3}><span /><span /><span /><small>Preparing your save</small></div>
            <div className={`demo-agent-reply ${phase >= 4 ? "demo-shown" : ""}`} aria-hidden={phase < 4}>
              <p>{phase >= 7 ? "Saved. You can come back to it whenever you're ready." : "I'll keep the article with this note. Ready to save?"}</p>
            </div>
            <div className={`demo-composer ${phase >= 2 ? "demo-composer-sent" : ""}`} aria-label="Example message being typed">
              <span>{phase === 1 ? typed : "Ask anything"}{phase === 1 && <i className="demo-caret" aria-hidden="true" />}</span><div className="demo-composer-tools" aria-hidden="true"><Plus size={18} /><span className={`demo-send ${phase === 1 ? "demo-send-ready" : ""}`}><ArrowUp size={16} /></span></div>
            </div>
          </div>
          <div className="demo-library" aria-label="Stash mobile screen">
            <div className="demo-phone-status" aria-hidden="true"><span>9:41</span><div><Signal size={12} /><Wifi size={12} /><BatteryFull size={17} /></div></div>
            <span className="demo-phone-island" aria-hidden="true" />
            <span className="demo-phone-home" aria-hidden="true" />
            <div className="demo-library-heading"><img src="/stash.png" alt="" width={24} height={24} /><strong>Stash</strong><span>Private library</span></div>
            <div className="demo-library-collection"><Folder size={14} /><span>Design</span><small>{phase >= 7 ? "3 resources" : "2 resources"}</small></div>
            <div className="demo-existing-list" aria-label="Previously saved resources">
              <article className="demo-existing-card"><div className="demo-existing-thumbnail"><Image src="/reading-preview.webp" fill alt="" sizes="76px" /></div><div><span>example.com / typography</span><h3>Typography for better reading</h3><p>Type, spacing, and readable layouts.</p><small>Unread</small></div></article>
              <article className="demo-existing-card"><div className="demo-existing-thumbnail demo-interface-thumbnail" aria-hidden="true"><svg viewBox="0 0 80 90"><rect x="12" y="17" width="56" height="55" rx="4" fill="white" stroke="#d5d4db" /><path d="M12 29H68" stroke="#e3e1e9" /><circle cx="18" cy="23" r="1.5" fill="#bdb6cb" /><circle cx="23" cy="23" r="1.5" fill="#bdb6cb" /><rect x="18" y="36" width="18" height="27" rx="2" fill="#e9e3f1" /><path d="M42 39H60M42 45H57M42 51H60M42 57H53" stroke="#d2cadc" strokeWidth="2" strokeLinecap="round" /></svg></div><div><span>example.com / interfaces</span><h3>Designing a calmer interface</h3><p>Less clutter. Clearer decisions.</p><small>Unread</small></div></article>
            </div>
            <div className={`demo-saved-note ${phase >= 7 ? "demo-shown" : ""}`} aria-hidden={phase < 7}><span><Check size={12} /> Saved to Design</span><p>Unread · Ready when you are</p></div>
          </div>
          <div className={`demo-resource-card ${phase >= 4 ? "demo-card-visible" : ""} ${phase >= 6 ? "demo-card-moving" : ""} ${phase >= 7 ? "demo-card-saved" : ""}`} aria-hidden={phase < 4}>
            <div className="demo-resource-image"><Image src="/reading-preview.webp" width={960} height={540} alt="An open book and research notes on a desk" sizes="(max-width: 700px) 280px, 320px" /><span className="demo-reading-time">8 min read</span></div>
            <div className="demo-resource-content"><span className="demo-resource-domain">example.com / reading</span><h3>Designing better reading experiences</h3><p className="demo-resource-summary">A practical guide to making long articles easier to scan and read.</p><div className="demo-resource-note"><span>Your note</span><p>Useful for the reading view in my next project.</p></div><div className="demo-resource-tags"><span>Design</span><span>Reading</span></div><span className="demo-new-unread">Unread</span></div>
            <div className="demo-confirmation"><span><Folder size={12} /> Design collection</span><button type="button" tabIndex={phase === 4 || phase === 5 ? 0 : -1} disabled={phase >= 6} onClick={() => seek(11000)} aria-label="Confirm example save">{phase >= 6 ? <><Check size={12} /> Saved</> : <>Save to Stash <ChevronRight size={12} /></>}<span className="demo-cursor" aria-hidden="true"><svg viewBox="0 0 24 28"><path d="M2 2L21 17L12 18L8 26Z" fill="#252c28" stroke="white" strokeWidth="1.6" strokeLinejoin="round" /></svg><span /></span></button></div>
          </div>

        </div>
        {!reducedMotion && <button type="button" className="demo-play" onClick={toggle} aria-label={playing ? "Pause demo" : finished ? "Replay demo" : "Play demo"}>{playing ? <Pause size={15} /> : finished ? <RotateCcw size={15} /> : <Play size={15} />}</button>}
      </div>
    </section>
  );
}
