"use client";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Folder,
  KeyRound,
  Library,
  LogOut,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Link as LinkIcon,
  Bookmark,
  LoaderCircle,
} from "lucide-react";
import type { Profile, Resource, Collection, AgentKey } from "@stash/shared";

import { Landing } from "./landing";
import { api, ApiError } from "./api";
import { AccountLink, ProfileForm } from "./account-ui";
import { Portability } from "./portability-ui";

const json = (data: unknown) => JSON.stringify(data);
function Brand() {
  return (
    <div className="brand">
      <img src="/stash.png" alt="" width="38" height="38" />
      <span>
        stash<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const dialog = document.getElementById("stash-dialog")!;
    dialog
      .querySelector<HTMLElement>("input, button, textarea, select")
      ?.focus();
    function keys(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const focusable = [
          ...dialog.querySelectorAll<HTMLElement>(
            "button,input,textarea,select,a[href]",
          ),
        ].filter((el) => !el.hasAttribute("disabled"));
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      before?.focus();
    };
  }, [close]);
  return (
    <div className="overlay" onClick={close}>
      <section
        id="stash-dialog"
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
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
export default function StashApp() {
  const [user, setUser] = useState<Profile | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [accountLink, setAccountLink] = useState<{
    purpose: "verify" | "reset";
    token: string;
  } | null>(null);
  async function load() {
    setError("");
    try {
      const result = await api<{ user: Profile }>("/me");
      setUser(result.user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else setError((e as Error).message);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("verify") || params.has("reset"))
      setAccountLink({
        purpose: params.has("verify") ? "verify" : "reset",
        token: params.get("verify") || params.get("reset") || "",
      });
    void load();
  }, []);
  if (accountLink)
    return (
      <AccountLink
        {...accountLink}
        onDone={() => {
          setAccountLink(null);
          void load();
        }}
      />
    );
  if (!ready) return <Landing />;
  if (error)
    return (
      <main className="loading">
        <section>
          <ErrorNote message={error} />
          <button className="button primary" onClick={() => void load()}>
            Retry connection
          </button>
        </section>
      </main>
    );
  if (!user) return <Landing />;
  return <Dashboard user={user} setUser={setUser} />;
}
function Dashboard({
  user,
  setUser,
}: {
  user: Profile;
  setUser: (user: Profile | null) => void;
}) {
  const [view, setView] = useState<"library" | "agents" | "profile">("library");
  const [items, setItems] = useState<Resource[]>([]),
    [collections, setCollections] = useState<Collection[]>([]),
    [keys, setKeys] = useState<AgentKey[]>([]);
  const [endpoint, setEndpoint] = useState(""),
    [query, setQuery] = useState(""),
    [collection, setCollection] = useState(""),
    [status, setStatus] = useState("");
  const [total, setTotal] = useState(0),
    [libraryCount, setLibraryCount] = useState(0),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<
      "resource" | "collection" | "key" | "portability" | null
    >(null),
    [editing, setEditing] = useState<Resource | null>(null),
    [newToken, setNewToken] = useState("");
  const [editingCollection, setEditingCollection] = useState<Collection | null>(
    null,
  );
  const closeModal = useCallback(() => {
    setModal(null);
    setEditing(null);
  }, []);
  const reloadMeta = useCallback(async () => {
    const [c, k, r] = await Promise.all([
      api<{ items: Collection[] }>("/collections"),
      api<{ items: AgentKey[]; endpoint: string }>("/keys"),
      api<{ total: number }>("/resources?limit=1"),
    ]);
    setCollections(c.items);
    setKeys(k.items);
    setEndpoint(k.endpoint);
    setLibraryCount(r.total);
    setUser((await api<{ user: Profile }>("/me")).user);
  }, [setUser]);
  const reloadResources = useCallback(async () => {
    const params = new URLSearchParams({
      q: query,
      offset: String(offset),
      limit: "24",
    });
    if (collection) params.set("collectionId", collection);
    if (status) params.set("status", status);
    const result = await api<{ items: Resource[]; total: number }>(
      `/resources?${params}`,
    );
    setItems(result.items);
    setTotal(result.total);
  }, [query, collection, status, offset]);
  useEffect(() => {
    reloadMeta().catch((e) => setError(e.message));
  }, [reloadMeta]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: query,
          offset: String(offset),
          limit: "24",
        });
        if (collection) params.set("collectionId", collection);
        if (status) params.set("status", status);
        const result = await api<{ items: Resource[]; total: number }>(
          `/resources?${params}`,
        );
        if (active) {
          setItems(result.items);
          setTotal(result.total);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, collection, status, offset]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  async function mutate(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await Promise.all([reloadResources(), reloadMeta()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const firstName = user.name.split(" ")[0];
  return (
    <div className="app-layout">
      <aside
        className="sidebar"
        inert={!!modal}
        aria-hidden={modal ? true : undefined}
      >
        <Brand />
        <div className="workspace-label">
          YOUR WORKSPACE <span>PRIVATE</span>
        </div>
        <nav aria-label="Main navigation">
          <button
            className={
              view === "library" && !collection ? "nav-item active" : "nav-item"
            }
            onClick={() => {
              setView("library");
              setCollection("");
              setOffset(0);
            }}
          >
            <Library size={19} />
            All resources<span className="count">{libraryCount}</span>
          </button>
          <button
            className={view === "agents" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setView("agents");
              reloadMeta().catch((e) => setError(e.message));
            }}
          >
            <KeyRound size={19} />
            Agent connections
          </button>
        </nav>
        <div className="collection-heading">
          COLLECTIONS
          <button
            className="icon-button"
            aria-label="Create collection"
            onClick={() => {
              setEditingCollection(null);
              setModal("collection");
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="collection-list">
          {collections.map((c) => (
            <button
              key={c.id}
              className={
                collection === c.id && view === "library"
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() => {
                setView("library");
                setCollection(c.id);
                setOffset(0);
              }}
            >
              <Folder size={18} />
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <Sparkles size={19} />
            <strong>A little less searching.</strong>
            <p>Let your agents find the things you already saved.</p>
            <button onClick={() => setView("agents")}>
              Connect an agent <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className="profile-button"
            aria-label="Open profile"
            onClick={() => setView("profile")}
          >
            <span className="avatar">
              {user.avatar ? (
                <img src={user.avatar} alt="Your avatar" />
              ) : (
                user.name[0].toUpperCase()
              )}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>Personal workspace</small>
            </span>
            <Settings size={17} />
          </button>
        </div>
      </aside>
      <main
        className="main"
        inert={!!modal}
        aria-hidden={modal ? true : undefined}
      >
        <header className="topbar">
          <span>
            Personal workspace <ChevronRight size={14} />{" "}
            {view === "library"
              ? "Library"
              : view === "agents"
                ? "Connections"
                : "Profile"}
          </span>
          <span className="private-badge">
            <ShieldCheck size={14} /> Private by default
          </span>
        </header>
        <div className="content">
          {user.emailEnabled && !user.emailVerified && (
            <div className="verification-banner">
              <span>
                Verify your email to connect agents. You can use your library
                now.
              </span>
              <button
                className="text-button"
                onClick={() =>
                  api("/auth/resend", { method: "POST" })
                    .then(() => setNotice("Verification email sent."))
                    .catch((e) => setError(e.message))
                }
              >
                Resend verification email
              </button>
            </div>
          )}
          <ErrorNote message={error} />
          {notice && (
            <div role="status" className="toast">
              <Check size={16} />
              {notice}
            </div>
          )}
          {view === "library" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A PLACE FOR WHAT YOU FIND</span>
                  <h1>
                    {collection
                      ? collections.find((c) => c.id === collection)?.name
                      : "Your library"}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {collection
                      ? "Everything you saved around this topic."
                      : `Welcome back, ${firstName}. Keep your next good idea close.`}
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal("resource")}
                >
                  <Plus size={18} />
                  Save a resource
                </button>
              </div>
              {!Object.values(user.onboarding).every(Boolean) && (
                <div className="onboarding">
                  <div>
                    <span className="eyebrow">LET’S GET YOU STARTED</span>
                    <h2>Your first find is the beginning.</h2>
                    <p>
                      Use the library right away. Connect your agents whenever
                      you’re ready.
                    </p>
                  </div>
                  <div className="setup-steps">
                    {[
                      {
                        done: user.onboarding.profile,
                        title: "Create your profile",
                        hint: "Make this space yours.",
                        action: () => setView("profile"),
                      },
                      {
                        done: user.onboarding.saved,
                        title: "Save your first resource",
                        hint: "A useful link and a little context.",
                        action: () => setModal("resource"),
                      },
                      {
                        done: user.onboarding.organized,
                        title: "Organize into a collection",
                        hint: "Add a saved resource to a collection.",
                        action: () =>
                          items[0]
                            ? (setEditing(items[0]), setModal("resource"))
                            : setModal("resource"),
                      },
                      {
                        done: user.onboarding.connected,
                        title: "Connect an agent",
                        hint: "Completed after an authenticated request.",
                        action: () => setView("agents"),
                      },
                      {
                        done: user.onboarding.retrieved,
                        title: "Retrieve your research",
                        hint: "Ask your agent to find a saved resource.",
                        action: () => setView("agents"),
                      },
                    ].map((step, index) => (
                      <button key={step.title} onClick={step.action}>
                        <span className={step.done ? "step done" : "step"}>
                          {step.done ? <Check size={16} /> : index + 1}
                        </span>
                        <span>
                          <strong>{step.title}</strong>
                          <small>{step.hint}</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="library-toolbar">
                <button
                  className="button secondary"
                  onClick={() => {
                    setEditingCollection(null);
                    setModal("collection");
                  }}
                >
                  New collection
                </button>
                <button
                  className="button secondary"
                  onClick={() => setModal("portability")}
                >
                  Import / export
                </button>
                {collection && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setEditingCollection(
                        collections.find((c) => c.id === collection) || null,
                      );
                      setModal("collection");
                    }}
                  >
                    Manage collection
                  </button>
                )}
                <div className="search-field">
                  <Search size={18} />
                  <input
                    aria-label="Search your library"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setOffset(0);
                    }}
                    placeholder="Search titles, notes, and tags…"
                  />
                </div>
                <select
                  aria-label="Filter by reading status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">All reading statuses</option>
                  <option value="unread">Unread</option>
                  <option value="reading">Reading</option>
                  <option value="done">Finished</option>
                </select>
              </div>
              <div className="results-heading">
                <span>
                  {total} {total === 1 ? "resource" : "resources"}
                </span>
                <small>Newest first</small>
              </div>
              {loading ? (
                <div className="empty">
                  <LoaderCircle className="spin" />
                  <p>Opening your library…</p>
                </div>
              ) : items.length ? (
                <div className="resource-grid">
                  {items.map((item) => (
                    <article className="resource-card" key={item.id}>
                      <div className="resource-card-top">
                        <span className="resource-icon">
                          <LinkIcon size={19} />
                        </span>
                        <span className={`status ${item.status}`}>
                          {item.status === "done"
                            ? "Finished"
                            : item.status === "reading"
                              ? "Reading"
                              : "Unread"}
                        </span>
                      </div>
                      <a
                        className="resource-title"
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.title}
                        <ArrowUpRight size={17} />
                      </a>
                      <p className="resource-source">
                        Saved from{" "}
                        {item.sourceAgent === "web"
                          ? "dashboard"
                          : item.sourceAgent}{" "}
                        ·{" "}
                        {item.metadataStatus === "extracted"
                          ? "Page details fetched"
                          : item.metadataStatus === "unavailable"
                            ? "Page details unavailable"
                            : "Manual entry"}
                      </p>
                      <div className="resource-domain">
                        {new URL(item.url).hostname}
                      </div>
                      <p className="resource-notes">
                        {item.notes ||
                          item.description ||
                          "No notes yet. Add what made this worth saving."}
                      </p>
                      <div className="tags">
                        {item.tags.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                      <footer>
                        <span>
                          {collections
                            .filter((c) => item.collectionIds.includes(c.id))
                            .map((c) => c.name)
                            .join(", ") || "Unsorted"}{" "}
                          ·{" "}
                          {new Date(item.createdAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                        <button
                          className="text-button"
                          onClick={() => {
                            setEditing(item);
                            setModal("resource");
                          }}
                        >
                          Edit
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <div className="empty-icon">
                    <BookOpen size={30} />
                  </div>
                  <h2>
                    {query || collection || status
                      ? "No matches here yet."
                      : "Worth saving? Stash it."}
                  </h2>
                  <p>
                    {query || collection || status
                      ? "Try another search or save something to this collection."
                      : "Articles, repositories, tools, and ideas. Give your next find a home."}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => setModal("resource")}
                  >
                    <Plus size={17} />
                    Save a resource
                  </button>
                </div>
              )}
              {total > 24 && (
                <div className="pagination">
                  <button
                    className="button secondary"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 24))}
                  >
                    Previous
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + 24, total)} of {total}
                  </span>
                  <button
                    className="button secondary"
                    disabled={offset + 24 >= total}
                    onClick={() => setOffset(offset + 24)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
          {view === "agents" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    SAVE ONCE. ACCESS FROM YOUR AGENTS.
                  </span>
                  <h1>
                    Connected agents<span className="heading-dot">.</span>
                  </h1>
                  <p>
                    Give your agent access to your personal research library.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => {
                    setNewToken("");
                    setModal("key");
                  }}
                >
                  <Plus size={18} />
                  Create an agent key
                </button>
              </div>
              <div className="connection-guide">
                <div>
                  <span className="resource-icon">
                    <KeyRound size={21} />
                  </span>
                  <h2>Your library, in the conversation.</h2>
                  <p>
                    Add Stash as a remote MCP server in a client that supports
                    bearer-token authentication. Use this endpoint and your
                    agent key.
                  </p>
                </div>
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
                <p className="muted">
                  Each client has its own setup. Clients that require OAuth need
                  a future OAuth integration. A key is marked connected after
                  its first authenticated request.
                </p>
              </div>
              <h2 className="section-title">Your agent keys</h2>
              <details className="client-instructions">
                <summary>Setup for Codex and OpenCode</summary>
                <p className="muted">
                  Create a key above, then configure your client to send it as
                  an Authorization bearer token. See{" "}
                  <a href="/help#agents">agent setup instructions</a>.
                  OAuth-only clients are not supported in this release.
                </p>
              </details>
              {!keys.length ? (
                <div className="empty compact">
                  <KeyRound size={27} />
                  <h2>Your agents can join you here.</h2>
                  <p>
                    Create a key, add the connection in your agent, then ask it
                    to list your collections.
                  </p>
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
                          <code>{k.prefix}…</code> ·{" "}
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
            </>
          )}
          {view === "profile" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">MAKE YOURSELF AT HOME</span>
                  <h1>
                    Your profile<span className="heading-dot">.</span>
                  </h1>
                  <p>A few details to make this space yours.</p>
                </div>
              </div>
              <ProfileForm
                user={user}
                onDeleted={() => setUser(null)}
                onUser={(u) => {
                  setUser(u);
                  setNotice("Profile updated.");
                }}
              />
              <button
                className="button secondary logout"
                onClick={() =>
                  api("/auth/logout", { method: "POST" })
                    .then(() => setUser(null))
                    .catch((e) => setError(e.message))
                }
              >
                <LogOut size={17} />
                Sign out
              </button>
            </>
          )}
        </div>
        <footer className="main-footer">
          <span>
            Stash · Keep what matters. <a href="/help">Help and privacy</a>
          </span>
          <span>
            <ShieldCheck size={13} />
            Only you and your connected agents
          </span>
        </footer>
      </main>
      {modal === "resource" && (
        <Modal
          title={
            editing ? "Edit your resource" : "Save something worth keeping"
          }
          close={closeModal}
        >
          <ResourceForm
            collections={collections}
            editing={editing}
            selectedCollection={collection}
            onSave={async (input) => {
              const result = editing
                ? await api(`/resources/${editing.id}`, {
                    method: "PATCH",
                    body: json(input),
                  })
                : await api<{ duplicate: boolean }>("/resources", {
                    method: "POST",
                    body: json(input),
                  });
              await Promise.all([reloadResources(), reloadMeta()]);
              closeModal();
              setNotice(
                (result as { duplicate?: boolean }).duplicate
                  ? "Already saved. Your original notes are intact."
                  : editing
                    ? "Resource updated."
                    : "Saved to your library.",
              );
            }}
            onDelete={
              editing
                ? async () => {
                    await api(`/resources/${editing.id}`, { method: "DELETE" });
                    await Promise.all([reloadResources(), reloadMeta()]);
                    closeModal();
                    setNotice("Resource deleted.");
                  }
                : undefined
            }
          />
        </Modal>
      )}
      {modal === "portability" && (
        <Modal title="Import and export your library" close={closeModal}>
          <Portability
            onImported={async () => {
              await Promise.all([reloadResources(), reloadMeta()]);
            }}
          />
        </Modal>
      )}
      {modal === "collection" && (
        <Modal
          title={
            editingCollection ? "Manage collection" : "Create a collection"
          }
          close={closeModal}
        >
          <SimpleForm
            label="Collection name"
            placeholder="e.g. Agent memory"
            defaultValue={editingCollection?.name}
            onDelete={
              editingCollection
                ? async () => {
                    await api(`/collections/${editingCollection.id}`, {
                      method: "DELETE",
                    });
                    if (collection === editingCollection.id) {
                      setCollection("");
                      setOffset(0);
                    }
                    await reloadMeta();
                    closeModal();
                    setNotice(
                      "Collection deleted. Its resources are preserved.",
                    );
                  }
                : undefined
            }
            onSubmit={async (name) => {
              await api(
                editingCollection
                  ? `/collections/${editingCollection.id}`
                  : "/collections",
                {
                  method: editingCollection ? "PATCH" : "POST",
                  body: json({ name }),
                },
              );
              await reloadMeta();
              closeModal();
              setNotice(
                editingCollection
                  ? "Collection renamed."
                  : "Collection created.",
              );
            }}
          />
        </Modal>
      )}
      {modal === "key" && (
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
            <KeyForm
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
    </div>
  );
}
function ResourceForm({
  collections,
  editing,
  selectedCollection,
  onSave,
  onDelete,
}: {
  collections: Collection[];
  editing: Resource | null;
  selectedCollection: string;
  onSave: (data: unknown) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await onSave({
        ...(!editing && { url: data.get("url") }),
        title: data.get("title"),
        notes: data.get("notes"),
        collectionIds: data.getAll("collectionIds"),
        status: data.get("status"),
        tags: String(data.get("tags"))
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <label>
        Link
        <input
          name="url"
          type="url"
          required
          disabled={!!editing}
          maxLength={2048}
          defaultValue={editing?.url}
          placeholder="https://…"
        />
      </label>
      <label>
        Title
        <input
          name="title"
          maxLength={200}
          defaultValue={editing?.title}
          placeholder="Give this find a useful name"
        />
      </label>
      <label>
        Why it matters
        <textarea
          name="notes"
          maxLength={10000}
          rows={3}
          defaultValue={editing?.notes}
          placeholder="A little context for your future self and your agents"
        />
      </label>
      <div className="form-row">
        <fieldset className="collection-picker">
          <legend>Collections</legend>
          {collections.map((c) => (
            <label key={c.id}>
              <input
                name="collectionIds"
                type="checkbox"
                value={c.id}
                defaultChecked={
                  editing
                    ? editing.collectionIds.includes(c.id)
                    : c.id === selectedCollection
                }
              />
              {c.name}
            </label>
          ))}
        </fieldset>
        <label>
          Reading status
          <select name="status" defaultValue={editing?.status || "unread"}>
            <option value="unread">Unread</option>
            <option value="reading">Reading</option>
            <option value="done">Finished</option>
          </select>
        </label>
      </div>
      <label>
        Tags
        <input
          name="tags"
          defaultValue={editing?.tags.join(", ")}
          placeholder="agents, memory, research"
        />
        <small>Separate with commas.</small>
      </label>
      <ErrorNote message={error} />
      <div className="form-actions">
        {onDelete && (
          <button
            className="button danger"
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!confirm("Permanently delete this resource?")) return;
              setBusy(true);
              try {
                await onDelete();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={16} />
            Delete
          </button>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Save resource"}
        </button>
      </div>
    </form>
  );
}
function SimpleForm({
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
function KeyForm({
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
