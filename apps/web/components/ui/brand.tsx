import Link from "next/link";
export function Brand() {
  return (
    <div className="brand">
      <img src="/stash.png" alt="" width="38" height="38" />
      <span>
        stash<span className="brand-dot">.</span>
      </span>
      <span className="release-badge">Alpha</span>
    </div>
  );
}

export function SiteBrand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="site-brand" aria-label="Stash home">
      <img src="/stash.png" alt="" width={32} height={32} />
      <span>
        stash<span className="brand-dot">.</span>
      </span>
      <span className="release-badge">Alpha</span>
    </Link>
  );
}
