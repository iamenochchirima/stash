"use client";
import { useState } from "react";
import type { Topic } from "@stash/shared";
import { api } from "../../lib/api";
import { useWorkspace } from "../workspace/workspace";
export function TopicPicker({
  selected,
  onChange,
  onPendingChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { user, topics, refresh } = useWorkspace();
  const [query, setQuery] = useState(""),
    [description, setDescription] = useState(""),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const matches = topics.filter((topic) =>
    `${topic.name} ${topic.description || ""}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const missing = selected.filter(
    (id) => !topics.some((topic) => topic.id === id),
  );
  return (
    <fieldset className="topic-picker" disabled={busy}>
      <legend>Topics</legend>
      <input
        aria-label="Find topics"
        placeholder="Find or create a topic…"
        maxLength={80}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setCreating(false);
          setError("");
        }}
      />
      <div className="topic-picker-options">
        {matches.map((topic) => (
          <label key={topic.id}>
            <input
              type="checkbox"
              checked={selected.includes(topic.id)}
              disabled={!selected.includes(topic.id) && selected.length >= 20}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, topic.id]
                    : selected.filter((id) => id !== topic.id),
                )
              }
            />
            <span>
              {topic.name}
              {topic.description && <small>{topic.description}</small>}
            </span>
          </label>
        ))}
      </div>
      {missing.map((id) => (
        <div key={id} className="topic-unavailable">
          <span>Unavailable topic</span>
          <button
            type="button"
            onClick={() => onChange(selected.filter((value) => value !== id))}
          >
            Remove unavailable topic
          </button>
        </div>
      ))}
      {!matches.length && (
        <small>{query ? "No matching topics." : "No topics yet."}</small>
      )}
      {selected.length >= 20 && <small>Up to 20 topics per item.</small>}
      {!creating ? (
        <button
          type="button"
          className="text-button"
          disabled={!query.trim() || selected.length >= 20}
          onClick={() => setCreating(true)}
        >
          Create topic{query.trim() ? ` “${query.trim()}”` : ""}
        </button>
      ) : (
        <div className="topic-inline-create">
          <label>
            Topic description
            <textarea
              rows={2}
              maxLength={4000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What belongs in this topic?"
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                onPendingChange(true);
                setError("");
                try {
                  const result = await api<{ topic: Topic }>("/topics", {
                    method: "POST",
                    headers: { "X-Stash-Account": user.id },
                    body: JSON.stringify({ name: query.trim(), description }),
                  });
                  await refresh();
                  onChange([...new Set([...selected, result.topic.id])]);
                  setCreating(false);
                  setQuery("");
                  setDescription("");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                  onPendingChange(false);
                }
              }}
            >
              {busy ? "Creating…" : "Create and select topic"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
