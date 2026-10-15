"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../../../lib/api";
import { BookOpen, Check, PenLine } from "lucide-react";
type Pending = {
  clientName: string;
  redirectHost: string;
  canWrite: boolean;
  emailVerified: boolean;
  email: string;
};
export function Consent() {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null),
    [nonce, setNonce] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [write, setWrite] = useState(false),
    [busy, setBusy] = useState(false);
  async function load() {
    setError("");
    const request = new URLSearchParams(location.search).get("request") || "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(request)) {
      setError(
        "This connection request is invalid. Start again in your agent.",
      );
      return;
    }
    setNonce(request);
    try {
      setPending(await api<Pending>(`/oauth/requests/${request}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        router.replace(
          `/signin?next=${encodeURIComponent(`/oauth/consent?request=${request}`)}`,
        );
      else setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function decide(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ redirect: string }>(
        `/oauth/requests/${nonce}`,
        {
          method: "POST",
          body: JSON.stringify({ approve, write: approve && write }),
        },
      );
      location.assign(result.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <header className="account-header">
        <Link className="site-brand" href="/" aria-label="Stash home">
          <img src="/stash.png" width={32} height={32} alt="" />
          <span>
            stash<span className="brand-dot">.</span>
          </span>
        </Link>
      </header>
      <section className="account-panel">
        <div className="oauth-consent">
          {pending ? (
            <>
              <h1>Connect {pending.clientName}</h1>
              <p className="muted">Signed in as {pending.email}</p>
              <p className="oauth-client-host">
                Returns to {pending.redirectHost}
              </p>
              <div className="oauth-permission">
                <BookOpen size={18} aria-hidden="true" />
                <div>
                  <strong>Read your library</strong>
                  <p>Find saved resources and browse your collections.</p>
                </div>
                <Check size={15} aria-hidden="true" />
              </div>
              {pending.canWrite && (
                <label className="oauth-write">
                  <input
                    type="checkbox"
                    checked={write}
                    onChange={(e) => setWrite(e.target.checked)}
                    disabled={busy}
                  />
                  <PenLine size={17} aria-hidden="true" />
                  <span>
                    <strong>Also save and delete resources</strong>
                    <small>Allow this agent to change your library.</small>
                  </span>
                </label>
              )}
              {!pending.emailVerified && (
                <div className="oauth-verification">
                  <p>Verify your email before allowing access.</p>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      api("/auth/resend", { method: "POST" })
                        .then(() => setNotice("Verification email sent."))
                        .catch((e) => setError(e.message))
                    }
                  >
                    Resend verification email
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void load()}
                  >
                    I've verified my email
                  </button>
                </div>
              )}
              <p className="oauth-revoke-note">
                You can revoke access in Agent connections.
              </p>
              {notice && <p role="status">{notice}</p>}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <div className="oauth-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void decide(false)}
                >
                  Cancel
                </button>
                <button
                  className="site-button"
                  disabled={busy || !pending.emailVerified}
                  onClick={() => void decide(true)}
                >
                  {busy ? "Connecting…" : "Allow access"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>Connect your agent</h1>
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : (
                <p>Opening your connection request…</p>
              )}
              <Link href="/">Back to Stash</Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
