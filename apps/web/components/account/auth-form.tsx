"use client";
import { useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronRight,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { Profile } from "@stash/shared";
import { api } from "../../lib/api";
import { Brand } from "../ui/brand";
import { ErrorNote } from "../ui/error-note";
export function Auth({
  onUser,
  initialMode = "signup",
  returnTo = "",
}: {
  returnTo?: string;
  onUser: (user: Profile) => void;
  initialMode?: "signup" | "login" | "forgot";
}) {
  const mode = initialMode;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  useEffect(() => {
    api<{ emailEnabled: boolean }>("/config")
      .then((result) => setEmailEnabled(result.emailEnabled))
      .catch(() => {});
  }, []);
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
  return (
    <main className="account-page">
      <header className="account-header">
        <Link href="/" aria-label="Stash home">
          <Brand />
        </Link>
        <Link href="/" className="account-back">
          Back to home
        </Link>
      </header>
      <section className="account-panel">
        <div className="auth-card">
          <h1>
            {mode === "signup"
              ? "Create your account"
              : mode === "login"
                ? "Sign in to Stash"
                : "Reset your password"}
          </h1>
          <p>
            {mode === "signup"
              ? "Save links, add notes, and connect your agents."
              : mode === "login"
                ? "Open your private research library."
                : "We'll email you a link to choose a new password."}
          </p>
          {!emailEnabled && (
            <p className="muted">
              Email verification and password recovery are currently
              unavailable.
            </p>
          )}
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
            <Link href="/forgot-password" className="text-button forgot-button">
              Forgot your password?
            </Link>
          )}
          <p className="auth-switch">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <Link
                  href={
                    returnTo
                      ? `/signin?next=${encodeURIComponent(returnTo)}`
                      : "/signin"
                  }
                >
                  Sign in
                </Link>
              </>
            ) : mode === "login" ? (
              <>
                Don't have an account?{" "}
                <Link
                  href={
                    returnTo
                      ? `/signup?next=${encodeURIComponent(returnTo)}`
                      : "/signup"
                  }
                >
                  Sign up
                </Link>
              </>
            ) : (
              <Link href="/signin">Back to sign in</Link>
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
