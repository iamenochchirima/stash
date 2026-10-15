"use client";
import { useState } from "react";

import { Trash2 } from "lucide-react";
import type { Profile } from "@stash/shared";
import { api } from "../../lib/api";

import { ErrorNote } from "../ui/error-note";
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
          Permanently delete your account, library, and agent keys. Retained
          backups follow the configured retention schedule.
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
