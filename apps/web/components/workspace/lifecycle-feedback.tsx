"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
type Action = "archive" | "unarchive" | "trash" | "restore" | "purge";
type Feedback = {
  userId: string;
  id: string;
  message: string;
  undo: Action | null;
  expiresAt: number;
};
const key = "stash-lifecycle-feedback";
export function clearLifecycleFeedback(userId: string) {
  try { sessionStorage.removeItem(key); } catch {}
  window.dispatchEvent(new CustomEvent("stash-lifecycle", { detail: { userId, clear: true } }));
}
export function recordLifecycle(userId: string, id: string, action: Action) {
  const messages = {
      archive: "Archived.",
      unarchive: "Returned to your library.",
      trash: "Moved to Trash.",
      restore: "Restored from Trash.",
      purge: "Permanently deleted.",
    },
    undo: Record<Action, Action | null> = {
      archive: "unarchive",
      unarchive: "archive",
      trash: "restore",
      restore: "trash",
      purge: null,
    };
  const value: Feedback = {
    userId,
    id,
    message: messages[action],
    undo: undo[action],
    expiresAt: Date.now() + 30000,
  };
  if (action === "purge")
    try {
      sessionStorage.removeItem(`stash-draft:${userId}:${id}`);
    } catch {}
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
  window.dispatchEvent(new CustomEvent("stash-lifecycle", { detail: value }));
}
export function LifecycleFeedback({
  userId,
  onChanged,
}: {
  userId: string;
  onChanged?: () => Promise<void>;
}) {
  const [value, setValue] = useState<Feedback | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const accept = (raw: unknown) => {
      const next = raw as Feedback;
      if (
        next &&
        typeof next.message === "string" &&
        next.message.length <= 80 &&
        next.userId === userId &&
        typeof next.id === "string" &&
        /^[0-9a-f-]{36}$/.test(next.id) &&
        next.expiresAt > Date.now() &&
        next.expiresAt <= Date.now() + 30000 &&
        [null, "archive", "unarchive", "trash", "restore"].includes(next.undo)
      ) {
        setValue(next);
        setError("");
      }
    };
    try {
      accept(JSON.parse(sessionStorage.getItem(key) || "null"));
    } catch {}
    const handle = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.userId === userId && detail.clear === true) setValue(null);
      else accept(detail);
    };
    window.addEventListener("stash-lifecycle", handle);
    return () => window.removeEventListener("stash-lifecycle", handle);
  }, [userId]);
  useEffect(() => {
    if (!value) return;
    const timer = setTimeout(
      () => {
        setValue(null);
        try {
          sessionStorage.removeItem(key);
        } catch {}
      },
      Math.max(0, value.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [value]);
  if (!value) return null;
  return (
    <div className="lifecycle-feedback" role="status">
      <span>{error || value.message}</span>
      {value.undo && (
        <button
          className="text-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api(`/items/${value.id}/lifecycle`, {
                method: "POST",
                headers: { "X-Stash-Account": userId },
                body: JSON.stringify({ action: value.undo }),
              });
              try {
                sessionStorage.removeItem(key);
              } catch {}
              setValue({ ...value, message: "Change undone.", undo: null });
              await onChanged?.();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
