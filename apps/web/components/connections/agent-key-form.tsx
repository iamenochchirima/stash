"use client";
import { useState } from "react";
import { ErrorNote } from "../ui/error-note";
export function AgentKeyForm({
  onCreate,
}: {
  onCreate: (input: unknown) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const data = new FormData(e.currentTarget);
        try {
          await onCreate({ name: data.get("name"), scope: data.get("scope") });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">
        Use a separate key for each agent so you can revoke access individually.
      </p>
      <label>
        Agent name
        <input
          name="name"
          required
          maxLength={80}
          placeholder="e.g. My Codex"
        />
      </label>
      <label>
        Access
        <select name="scope" defaultValue="read">
          <option value="read">Read only</option>
          <option value="write">Read, save, and delete resources</option>
        </select>
      </label>
      <ErrorNote message={error} />
      <button className="button primary full" disabled={busy}>
        {busy ? "Creating…" : "Create key"}
      </button>
    </form>
  );
}
