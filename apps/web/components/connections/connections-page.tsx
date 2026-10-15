"use client";
import { useState, useEffect } from "react";
import { KeyRound, Plus, Copy, Trash2 } from "lucide-react";
import type { AgentKey } from "@stash/shared";
import { api } from "../../lib/api";
import { AppShell } from "../workspace/workspace";
import { Modal } from "../ui/modal";
import { ErrorNote } from "../ui/error-note";
import { AgentKeyForm } from "./agent-key-form";
const json = JSON.stringify;
export function ConnectionsPageClient() {
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<AgentKey[]>([]),
    [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(false),
    [newToken, setNewToken] = useState("");
  async function reloadMeta() {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ items: AgentKey[]; endpoint: string }>(
        "/keys",
      );
      setKeys(result.items);
      setEndpoint(result.endpoint);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reloadMeta().catch((e) => setError(e.message));
  }, []);
  function closeModal() {
    setModal(false);
    setNewToken("");
  }
  async function mutate(action: () => Promise<unknown>) {
    try {
      setError("");
      await action();
      await reloadMeta();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <AppShell modalOpen={modal}>
      <main className="main" inert={modal || undefined}>
        <div className="content">
          <ErrorNote message={error} />
          {notice && <p role="status">{notice}</p>}

          <div className="page-heading">
            <div>
              <h1>Agent connections</h1>
            </div>
            <button
              className="button primary"
              onClick={() => {
                setNewToken("");
                setModal(true);
              }}
            >
              <Plus size={18} />
              Create an agent key
            </button>
          </div>
          <div className="connection-guide">
            <label>
              Remote MCP endpoint
              <div className="copy-field">
                <code>{endpoint}</code>
                <button
                  className="icon-button"
                  aria-label="Copy MCP endpoint"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(endpoint)
                      .then(() => setNotice("Endpoint copied."))
                      .catch(() =>
                        setError(
                          "Clipboard unavailable. Select and copy the endpoint.",
                        ),
                      )
                  }
                >
                  <Copy size={17} />
                </button>
              </div>
            </label>
          </div>
          <h2 className="section-title">Your connections</h2>
          <details className="client-instructions">
            <summary>Setup instructions</summary>
            <p className="muted">
              Choose OAuth in clients that offer sign-in. Use an agent key in
              clients that accept bearer tokens. See{" "}
              <a href="/help#agents">agent setup instructions</a>.
            </p>
          </details>
          {loading ? (
            <p role="status">Loading connections…</p>
          ) : error && !keys.length ? null : !keys.length ? (
            <div className="empty compact">
              <KeyRound size={27} />
              <h2>No agent keys</h2>
              <p>Create a key to connect an agent.</p>
            </div>
          ) : (
            <div className="key-list">
              {keys.map((k) => (
                <div className="key-row" key={k.id}>
                  <span className="resource-icon">
                    <KeyRound size={18} />
                  </span>
                  <div>
                    <strong>{k.name}</strong>
                    <small>
                      {k.authentication === "oauth" ? (
                        "OAuth"
                      ) : (
                        <code>{k.prefix}…</code>
                      )}{" "}
                      ·{" "}
                      {k.scope === "read"
                        ? "Read only"
                        : "Read, save, and delete"}
                    </small>
                  </div>
                  <span
                    className={
                      k.lastUsedAt
                        ? "connection-status connected"
                        : "connection-status"
                    }
                  >
                    {k.lastUsedAt ? "Connected" : "Awaiting first use"}
                  </span>
                  <button
                    className="icon-button danger"
                    aria-label={`Revoke ${k.name}`}
                    onClick={() => {
                      if (
                        confirm(
                          `Revoke access for ${k.name}? This key will stop working immediately.`,
                        )
                      )
                        void mutate(() =>
                          api(`/keys/${k.id}`, { method: "DELETE" }),
                        );
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            className="button secondary"
            onClick={() =>
              reloadMeta()
                .then(() => setNotice("Connection status refreshed."))
                .catch((e) => setError(e.message))
            }
          >
            Refresh connection status
          </button>
        </div>
        <footer className="main-footer">
          <a href="/help">Help & privacy</a>
        </footer>
      </main>{" "}
      {modal && (
        <Modal title="Connect an agent" close={closeModal}>
          {newToken ? (
            <div className="token-result">
              <p>Your key is ready. Copy it now, it won’t be shown again.</p>
              <div className="copy-field">
                <code>{newToken}</code>
                <button
                  className="icon-button"
                  aria-label="Copy agent key"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(newToken)
                      .then(() => setNotice("Key copied."))
                      .catch(() =>
                        setError(
                          "Clipboard unavailable. Select and copy the key.",
                        ),
                      )
                  }
                >
                  <Copy size={17} />
                </button>
              </div>
              <p className="muted">
                Use it as the bearer token in your MCP client. Treat it like a
                password.
              </p>
              <button className="button primary full" onClick={closeModal}>
                I’ve saved my key
              </button>
            </div>
          ) : (
            <AgentKeyForm
              onCreate={async (input) => {
                const data = await api<{ token: string }>("/keys", {
                  method: "POST",
                  body: json(input),
                });
                setNewToken(data.token);
                await reloadMeta();
              }}
            />
          )}
        </Modal>
      )}
    </AppShell>
  );
}
