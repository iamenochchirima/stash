"use client";
import { useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { Profile } from "@stash/shared";
import { api } from "./api";
function Brand() {
  return (
    <div className="brand">
      <img src="/stash.png" alt="" width={38} height={38} />
      <span>
        stash<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function ErrorNote({ message }: { message: string }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}
export function Auth({ onUser, initialMode = "signup" }: { onUser: (user: Profile) => void; initialMode?: "signup" | "login" }) {
  const [mode, setMode] = useState<"signup" | "login" | "forgot">(initialMode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [emailEnabled,setEmailEnabled]=useState(true);
  useEffect(()=>{ api<{emailEnabled:boolean}>("/config").then(result=>setEmailEnabled(result.emailEnabled)).catch(()=>{}); },[]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "forgot") {
        const result = await api<{ message: string }>("/auth/forgot", {
          method: "POST",
          body: JSON.stringify({ email: data.get("email") }),
        });
        setMessage(result.message);
      } else {
        const result = await api<{ user: Profile }>(`/auth/${mode}`, {
          method: "POST",
          body: JSON.stringify({
            name: data.get("name"),
            email: data.get("email"),
            password: data.get("password"),
          }),
        });
        onUser(result.user);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function switchMode(mode: "signup" | "login" | "forgot") {
    setMode(mode);
    setError("");
    setMessage("");
  }
  return (
    <main className="account-page">
      <header className="account-header">
        <Link href="/" aria-label="Stash home"><Brand /></Link>
        <Link href="/" className="account-back">Back to home</Link>
      </header>
      <section className="account-panel">
        <div className="auth-card">
          <h1>{mode === "signup" ? "Create your account" : mode === "login" ? "Sign in to Stash" : "Reset your password"}</h1>
          <p>{mode === "signup" ? "Save links, add notes, and connect your agents." : mode === "login" ? "Open your private research library." : "We'll email you a link to choose a new password."}</p>
          {!emailEnabled && <p className="muted">Email verification and password recovery are currently unavailable.</p>}
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={80}
                  placeholder="What should we call you?"
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                placeholder="you@example.com"
              />
            </label>
            {mode !== "forgot" && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  required
                  minLength={mode === "signup" ? 8 : 1}
                  maxLength={128}
                  placeholder={
                    mode === "signup"
                      ? "At least 8 characters"
                      : "Your password"
                  }
                />
              </label>
            )}
            <ErrorNote message={error} />
            {message && (
              <p role="status" className="success-note">
                {message}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : mode === "signup" ? (
                "Create account"
              ) : mode === "login" ? (
                "Sign in"
              ) : (
                "Send reset link"
              )}
              {!busy && <ChevronRight size={18} />}
            </button>
          </form>
          {mode === "login" && emailEnabled && (
            <button
              className="text-button forgot-button"
              onClick={() => switchMode("forgot")}
            >
              Forgot your password?
            </button>
          )}
          <p className="auth-switch">
            {mode === "signup" ? <>Already have an account? <Link href="/signin">Sign in</Link></> : mode === "login" ? <>Don't have an account? <Link href="/signup">Sign up</Link></> : <button onClick={() => switchMode("login")}>Back to sign in</button>}
          </p>
          <div className="privacy-note">
            <ShieldCheck size={16} />
            Your library is private. Only agents you connect can access it.
          </div>
          <a className="help-link" href="/help">
            Privacy and account help <ArrowUpRight size={12} />
          </a>
        </div>
      </section>
    </main>
  );
}
export function AccountLink({
  purpose,
  token,
  onDone,
}: {
  purpose: "verify" | "reset";
  token: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  return (
    <main className="loading">
      <section className="panel account-link">
        <Brand />
        <h1>
          {purpose === "verify" ? "Verify your email" : "Choose a new password"}
        </h1>
        {done ? (
          <>
            <p role="status">
              {purpose === "verify"
                ? "Your email is verified. You can now connect agents."
                : "Password changed. Previous sessions and agent keys have been revoked."}
            </p>
            <button className="button primary" onClick={onDone}>
              Continue to Stash
            </button>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              setBusy(true);
              setError("");
              try {
                await api(`/auth/${purpose}`, {
                  method: "POST",
                  body: JSON.stringify({
                    token,
                    ...(purpose === "reset" && {
                      password: data.get("password"),
                    }),
                  }),
                });
                setDone(true);
                history.replaceState(null, "", "/");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {purpose === "reset" && (
              <label>
                New password
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
            )}
            <ErrorNote message={error} />
            <button className="button primary full" disabled={busy}>
              {busy
                ? "Working…"
                : purpose === "verify"
                  ? "Verify my email"
                  : "Reset password"}
            </button>
            <button
              type="button"
              className="button secondary full"
              onClick={() => {
                history.replaceState(null, "", "/");
                onDone();
              }}
            >
              Back to Stash
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
export function ProfileForm({
  user,
  onUser,
  onDeleted,
}: {
  user: Profile;
  onUser: (user: Profile) => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form
        className="profile-form panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          await perform(async () => {
            const result = await api<{ user: Profile }>("/me", {
              method: "PATCH",
              body: JSON.stringify({
                name: data.get("name"),
                bio: data.get("bio"),
                interests: String(data.get("interests"))
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }),
            });
            onUser(result.user);
          });
        }}
      >
        <div className="profile-intro">
          {user.avatar ? (
            <img className="avatar large" src={user.avatar} alt="Your avatar" />
          ) : (
            <span className="avatar large">{user.name[0].toUpperCase()}</span>
          )}
          <div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
          </div>
        </div>
        <label>
          Profile photo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = "";
              await perform(async () => {
                if (file.size > 2097152)
                  throw new Error("Avatar must be at most 2 MiB.");
                const image = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result));
                  reader.onerror = () =>
                    reject(new Error("Could not read this file."));
                  reader.readAsDataURL(file);
                });
                const result = await api<{ user: Profile }>("/me/avatar", {
                  method: "POST",
                  body: JSON.stringify({ image }),
                });
                onUser(result.user);
              });
            }}
          />
          <small>Static PNG, JPEG, or WebP. Up to 2 MiB.</small>
        </label>
        {user.avatar && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              perform(async () =>
                onUser(
                  (
                    await api<{ user: Profile }>("/me/avatar", {
                      method: "DELETE",
                    })
                  ).user,
                ),
              )
            }
          >
            Remove photo
          </button>
        )}
        <label>
          Name
          <input name="name" required maxLength={80} defaultValue={user.name} />
        </label>
        <label>
          Bio
          <textarea
            name="bio"
            maxLength={300}
            rows={3}
            defaultValue={user.bio}
            placeholder="A short introduction"
          />
        </label>
        <label>
          Interests
          <input
            name="interests"
            defaultValue={user.interests.join(", ")}
            placeholder="AI agents, design, open source"
          />
          <small>Separate with commas. Up to 10 interests.</small>
        </label>
        <ErrorNote message={error} />
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </button>
      </form>
      <div className="panel deletion-panel">
        <h2>Delete your account</h2>
        <p>
          Permanently delete your account, library, and agent keys.
          Retained backups follow the configured retention schedule.
        </p>
        {!deleting ? (
          <button className="button danger" onClick={() => setDeleting(true)}>
            Delete account
          </button>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              await perform(async () => {
                await api("/me", {
                  method: "DELETE",
                  body: JSON.stringify({
                    password: data.get("password"),
                    confirmation: data.get("confirmation"),
                  }),
                });
                onDeleted();
              });
            }}
          >
            <label>
              Current password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              Type DELETE to confirm
              <input name="confirmation" required pattern="DELETE" />
            </label>
            <button className="button danger" disabled={busy}>
              <Trash2 size={16} />
              Permanently delete account
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setDeleting(false)}
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </>
  );
}
