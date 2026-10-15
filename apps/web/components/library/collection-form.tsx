"use client";
import { useState } from "react";
import { ErrorNote } from "../ui/error-note";
export function CollectionForm({
  label,
  placeholder,
  onSubmit,
  defaultValue,
  onDelete,
}: {
  label: string;
  placeholder: string;
  defaultValue?: string;
  onDelete?: () => Promise<void>;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await onSubmit(String(data.get("name")));
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {label}
        <input
          name="name"
          required
          maxLength={80}
          placeholder={placeholder}
          defaultValue={defaultValue}
        />
      </label>
      <ErrorNote message={error} />
      <button className="button primary full" disabled={busy}>
        {busy
          ? "Saving…"
          : defaultValue
            ? "Rename collection"
            : "Create collection"}
      </button>
      {onDelete && (
        <button
          type="button"
          className="button danger full"
          disabled={busy}
          onClick={async () => {
            if (
              !confirm("Delete this collection? Your resources will be kept.")
            )
              return;
            setBusy(true);
            setError("");
            try {
              await onDelete();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete collection
        </button>
      )}
    </form>
  );
}
