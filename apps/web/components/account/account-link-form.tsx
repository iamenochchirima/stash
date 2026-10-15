"use client";
import { useState } from "react";

import { api } from "../../lib/api";
import { Brand } from "../ui/brand";
import { ErrorNote } from "../ui/error-note";
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
                history.replaceState(null, "", `/account/${purpose}`);
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
                history.replaceState(null, "", `/account/${purpose}`);
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
