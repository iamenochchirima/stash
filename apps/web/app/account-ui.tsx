"use client";
import { useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
  Bookmark,
  Sparkles,
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
export function Auth({ onUser }: { onUser: (user: Profile) => void }) {
  const [mode, setMode] = useState<"signup" | "login" | "forgot">("signup"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
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
    <main className="auth-layout">
      <div className="auth-story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow">
            <Sparkles size={14} /> A HOME FOR YOUR CURIOSITY
          </span>
          <h1>
            Good finds.
            <br />
            Always within
            <br />
            <em>reach.</em>
          </h1>
          <p>
            Save the things worth coming back to. Find them in one private
            library, from whichever AI agent you use next.
          </p>
          <div className="story-pill">
            <Bookmark size={18} /> Save once. Pick up anywhere.
          </div>
        </div>
        <small>YOUR RESEARCH. YOUR SPACE.</small>
      </div>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="eyebrow">WELCOME TO STASH</span>
          <h2>
            {mode === "signup"
              ? "Make yourself at home."
              : mode === "login"
                ? "Welcome back."
                : "Get back to your library."}
          </h2>
          <p>
            {mode === "signup"
              ? "Create your profile and save your first find."
              : mode === "login"
                ? "Your next idea might already be in your library."
                : "Enter your email to request a password reset link."}
          </p>
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
                "Create my Stash"
              ) : mode === "login" ? (
                "Sign in"
              ) : (
                "Send reset link"
              )}
              {!busy && <ChevronRight size={18} />}
            </button>
          </form>
          {mode === "login" && (
            <button
              className="text-button forgot-button"
              onClick={() => switchMode("forgot")}
            >
              Forgot your password?
            </button>
          )}
          <p className="auth-switch">
            {mode === "signup" ? "Already have a Stash?" : "New here?"}{" "}
            <button
              onClick={() => switchMode(mode === "signup" ? "login" : "signup")}
            >
              {mode === "signup" ? "Sign in" : "Create an account"}
            </button>
            {mode === "forgot" && (
              <button onClick={() => switchMode("login")}>
                Back to sign in
              </button>
            )}
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
          A little about you
          <textarea
            name="bio"
            maxLength={300}
            rows={3}
            defaultValue={user.bio}
            placeholder="What are you working on or curious about?"
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
          This permanently removes your profile, library, collections, and agent
          keys from the live database. Sessions stop working immediately.
          Retained backups expire within the configured retention period,
          planned at 7 days for launch.
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
