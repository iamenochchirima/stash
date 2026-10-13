import Link from "next/link";
import { ArrowRight, ArrowUpRight, MessageSquare, Plug } from "lucide-react";
import { HeroIllustration, ProductStory } from "./product-illustration";

export function Landing() {
  return (
    <div className="site-page">
      <header className="site-header">
        <Link className="site-brand" href="/" aria-label="Stash home"><img src="/stash.png" alt="" width={32} height={32} /><span>stash<span className="brand-dot">.</span></span></Link>
        <nav aria-label="Main navigation">
          <a className="site-about" href="#how-it-works">How it works</a>
          <Link href="/signin">Sign in</Link>
          <Link className="site-button" href="/signup">Sign up <ArrowUpRight size={15} /></Link>
        </nav>
      </header>
      <main>
        <section className="site-hero hero-network">
          <div className="hero-copy">
            <h1>Never lose a good find.<br /><span>Save</span> it as you go.</h1>
            <p className="hero-description">Capture, organise and retrieve valuable knowledge from your favourite AI tools — without breaking your flow.</p>
          </div>
          <HeroIllustration />
          <Link className="site-button network-signup" href="/signup">Start your library <ArrowRight size={17} /></Link>
        </section>
        <ProductStory />
        <section className="site-connect" id="connect" aria-label="Connect your agent">
          <div className="site-connect-setup">
            <div className="site-connect-diagram" aria-hidden="true">
              <div className="site-connect-node"><MessageSquare size={23} /><span>Your agent</span></div>
              <div className="site-connect-wire"><span /><div><Plug size={18} /><small>MCP</small></div><span /></div>
              <div className="site-connect-node site-connect-stash"><img src="/stash.png" width={27} height={27} alt="" /><span>Stash</span></div>
            </div>
          </div>
          <Link href="/signin" className="site-button">Connect your agent <ArrowUpRight size={16} /></Link>
        </section>
        <section className="site-bottom"><div><h2>Keep your next good find.</h2><p>Create an account and save it to Stash.</p></div><Link href="/signup" className="site-button">Sign up <ArrowRight size={16} /></Link></section>
      </main>
      <footer className="site-footer"><span>Stash <span className="footer-divider">/</span> A <a href="https://kasitek.co.za">KasiTek</a> product</span><Link href="/help">Help & privacy <ArrowUpRight size={13} /></Link></footer>
    </div>
  );
}
