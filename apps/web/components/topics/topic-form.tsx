"use client";
import { useState } from "react";
import type { Topic } from "@stash/shared";
import { ErrorNote } from "../ui/error-note";
export function TopicForm({
  topic,
  onSubmit,
  onDelete,
}: {
  topic?: Topic;
  onSubmit: (input: { name: string; description: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          await onSubmit({
            name: String(data.get("name")),
            description: String(data.get("description")),
          });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="item-editor-fields" disabled={busy}>
        <label>
          Topic name
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={topic?.name}
          />
        </label>
        <label>
          Description
          <textarea
            aria-label="Description"
            name="description"
            rows={3}
            maxLength={4000}
            defaultValue={topic?.description || ""}
            placeholder="What belongs in this topic?"
          />
        </label>
        <ErrorNote message={error} />
        <div className="form-actions">
          {onDelete && (
            <button
              type="button"
              className="button danger"
              onClick={async () => {
                if (
                  !confirm("Delete this topic? Your saved items will be kept.")
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
              Delete topic
            </button>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : topic ? "Save changes" : "Create topic"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
