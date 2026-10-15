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
  Trash2,
  X,
  Link as LinkIcon,
  Bookmark,
  LoaderCircle,
  Star,
  Archive,
  FileText,
  Lightbulb,
} from "lucide-react";
import type { Profile, Item, Collection, AgentKey } from "@stash/shared";

import Link from "next/link";
import { Landing } from "./landing";
import { api, ApiError } from "./api";
import { AccountLink, ProfileForm } from "./account-ui";
import { Portability } from "./portability-ui";
import { ItemEditor, clearItemDrafts } from "./item-editor";

const json = (data: unknown) => JSON.stringify(data);
function Brand() {
  return (
    <div className="brand">
      <img src="/stash.png" alt="" width="38" height="38" />
      <span>
        stash<span className="brand-dot">.</span>
      </span>
      <span className="release-badge">Alpha</span>
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
  const [items, setItems] = useState<Item[]>([]),
    [collections, setCollections] = useState<Collection[]>([]),
    [keys, setKeys] = useState<AgentKey[]>([]);
  const [endpoint, setEndpoint] = useState(""),
    [query, setQuery] = useState(() => new URLSearchParams(location.search).get("q") || ""),
    [collection, setCollection] = useState(() => new URLSearchParams(location.search).get("collectionId") || ""),
    [status, setStatus] = useState(() => new URLSearchParams(location.search).get("status") || "");
  const [total, setTotal] = useState(0),
    [libraryCount, setLibraryCount] = useState(0),
    [offset, setOffset] = useState(() => Math.max(0, Math.min(100000, Number(new URLSearchParams(location.search).get("offset")) || 0))),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<
      "resource" | "collection" | "key" | "portability" | null
    >(null),
    [editing, setEditing] = useState<Item | null>(null),
    [newToken, setNewToken] = useState("");
  const [editingCollection, setEditingCollection] = useState<Collection | null>(
    null,
  );
  const [kind, setKind] = useState(() => new URLSearchParams(location.search).get("kind") || "");
  const [itemLocation, setItemLocation] = useState(() => new URLSearchParams(location.search).get("location") || "library");
  const [favourites, setFavourites] = useState(() => new URLSearchParams(location.search).get("favourite") === "true");
  const libraryParams = new URLSearchParams();
  if (query) libraryParams.set("q", query);
  if (collection) libraryParams.set("collectionId", collection);
  if (status) libraryParams.set("status", status);
  if (offset) libraryParams.set("offset", String(offset));
  if (kind) libraryParams.set("kind", kind);
  if (itemLocation !== "library") libraryParams.set("location", itemLocation);
  if (favourites) libraryParams.set("favourite", "true");
  const libraryPath = libraryParams.size ? `/?${libraryParams}` : "/";
  useEffect(() => {
    history.replaceState(history.state, "", libraryPath);
  }, [libraryPath]);
  const closeModal = useCallback(() => {
    setModal(null);
    setEditing(null);
  }, []);
  const reloadMeta = useCallback(async () => {
    const [c, k, r] = await Promise.all([
      api<{ items: Collection[] }>("/collections"),
      api<{ items: AgentKey[]; endpoint: string }>("/keys"),
      api<{ total: number }>("/items?limit=1"),
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
    if (kind) params.set("kind", kind);
    if (favourites) params.set("favourite", "true");
    params.set("location", itemLocation);
    const result = await api<{ items: Item[]; total: number }>(
      `/items?${params}`,
    );
    setItems(result.items);
    setTotal(result.total);
  }, [query, collection, status, offset, kind, favourites, itemLocation]);
  useEffect(() => {
    try {
      const previous = sessionStorage.getItem("stash-active-user");
      if (previous && previous !== user.id) clearItemDrafts();
      sessionStorage.setItem("stash-active-user", user.id);
    } catch { /* Library access does not depend on browser draft storage. */ }
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
    if (kind) params.set("kind", kind);
    if (favourites) params.set("favourite", "true");
    params.set("location", itemLocation);
        const result = await api<{ items: Item[]; total: number }>(
          `/items?${params}`,
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
  }, [query, collection, status, offset, kind, favourites, itemLocation]);
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
  return (
    <div className="app-layout">
      <aside
        className="sidebar"
        inert={!!modal}
        aria-hidden={modal ? true : undefined}
      >
        <Brand />
        <nav aria-label="Main navigation">
          <button
            className={
              view === "library" && !collection && itemLocation === "library" && !favourites ? "nav-item active" : "nav-item"
            }
            onClick={() => {
              setView("library");
              setItemLocation("library"); setFavourites(false);
              setCollection("");
              setOffset(0);
            }}
          >
            <Library size={19} />
            All items<span className="count">{libraryCount}</span>
          </button>
          {[{ label: "Favourites", location: "library", favourite: true, icon: Star }, { label: "Archive", location: "archive", favourite: false, icon: Archive }, { label: "Trash", location: "trash", favourite: false, icon: Trash2 }].map(tab => <button key={tab.label} className={view === "library" && itemLocation === tab.location && favourites === tab.favourite && (tab.favourite || tab.location !== "library") ? "nav-item active" : "nav-item"} onClick={() => { setView("library"); setItemLocation(tab.location); setFavourites(tab.favourite); setCollection(""); setOffset(0); }}><tab.icon size={19} />{tab.label}</button>)}
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
                setItemLocation("library"); setFavourites(false);
                setOffset(0);
              }}
            >
              <Folder size={18} />
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
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
                  <h1>
                    {itemLocation === "trash" ? "Trash" : itemLocation === "archive" ? "Archive" : favourites ? "Favourites" : collection
                      ? collections.find((c) => c.id === collection)?.name
                      : "Your library"}
                  </h1>
                </div>
                <button
                  className="button primary"
                  onClick={() => setModal("resource")}
                >
                  <Plus size={18} />
                  Add item
                </button>
              </div>
              {!Object.values(user.onboarding).every(Boolean) && (
                <details className="onboarding">
                  <summary>Getting started</summary>
                  <div className="setup-steps">
                    {[
                      {
                        done: user.onboarding.profile,
                        title: "Create your profile",
                        action: () => setView("profile"),
                      },
                      {
                        done: user.onboarding.saved,
                        title: "Save your first resource",
                        action: () => setModal("resource"),
                      },
                      {
                        done: user.onboarding.organized,
                        title: "Organize into a collection",
                        action: () =>
                          items[0]
                            ? (setEditing(items[0]), setModal("resource"))
                            : setModal("resource"),
                      },
                      {
                        done: user.onboarding.connected,
                        title: "Connect an agent",
                        action: () => setView("agents"),
                      },
                      {
                        done: user.onboarding.retrieved,
                        title: "Retrieve your research",
                        action: () => setView("agents"),
                      },
                    ].map((step, index) => (
                      <button key={step.title} onClick={step.action}>
                        <span className={step.done ? "step done" : "step"}>
                          {step.done ? <Check size={16} /> : index + 1}
                        </span>
                        <span>
                          <strong>{step.title}</strong>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                </details>
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
                    placeholder="Search your saved items…"
                  />
                </div>
                <select aria-label="Filter by type" value={kind} onChange={e => { setKind(e.target.value); setOffset(0); }}><option value="">All types</option><option value="link">Links</option><option value="note">Notes</option><option value="idea">Ideas</option><option value="pdf">PDFs</option></select>
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
                  {total} {total === 1 ? "item" : "items"}
                </span>
                <small>Newest first</small>
              </div>
              {loading ? (
                <div className="empty">
                  <LoaderCircle className="spin" />
                  <p>Loading…</p>
                </div>
              ) : items.length ? (
                <div className="resource-grid">
                  {items.map((item) => (
                    <article className="resource-card" key={item.id}>
                      <div className="resource-card-top">
                        <span className="resource-icon">
                          {item.kind === "link" ? <LinkIcon size={19} /> : item.kind === "idea" ? <Lightbulb size={19} /> : <FileText size={19} />}
                        </span>
                        {["link", "pdf"].includes(item.kind) && <span className={`status ${item.status}`}>
                          {item.status === "done"
                            ? "Finished"
                            : item.status === "reading"
                              ? "Reading"
                              : "Unread"}
                        </span>}
                      </div>
                      <Link
                        className="resource-title resource-open"
                        href={`/items/${item.id}?returnTo=${encodeURIComponent(libraryPath)}${itemLocation === "trash" ? "&trash=true" : ""}`}
                      >
                        {item.title}
                      </Link>
                      <div className="resource-domain">{item.url ? new URL(item.url).hostname : item.kind === "idea" ? "Idea" : item.kind === "pdf" ? item.pdf?.filename || "PDF" : "Note"}{item.favourite && <Star size={12} aria-label="Favourite" />}</div>
                      {(item.body || item.notes || item.description) && <p className="resource-notes">{item.body || item.notes || item.description}</p>}
                      <div className="tags">
                        {item.tags.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                      <footer>
                        {item.url && itemLocation !== "trash" && <a className="resource-source-action" href={item.url} target="_blank" rel="noopener noreferrer" aria-label="Open source"><ArrowUpRight size={16} /></a>}
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
                            if (itemLocation === "trash") { void mutate(() => api(`/items/${item.id}/lifecycle`, { method: "POST", body: json({ action: "restore" }) })); return; }
                            api<{ item: Item }>(`/items/${item.id}`).then(result => { setEditing(result.item); setModal("resource"); }).catch(e => setError(e.message));
                          }}
                        >
                          {itemLocation === "trash" ? "Restore" : "Edit"}
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
                      ? "No results"
                      : "No items yet"}
                  </h2>
                  <p>
                    {query || collection || status
                      ? "Try another search or filter."
                      : itemLocation === "trash" ? "Items stay here for 30 days before permanent deletion." : itemLocation === "archive" ? "Archived items will appear here." : "Save a link, note or idea, or ask your agent to stash it."}
                  </p>
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
                  <h1>Agent connections</h1>
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
                  Choose OAuth in clients that offer sign-in. Use an agent key in clients that accept bearer tokens. See{" "}
                  <a href="/help#agents">agent setup instructions</a>.

                </p>
              </details>
              {!keys.length ? (
                <div className="empty compact">
                  <KeyRound size={27} />
                  <h2>No agent keys</h2>
                  <p>
                    Create a key to connect an agent.
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
                          {k.authentication === "oauth" ? "OAuth" : <code>{k.prefix}…</code>} ·{" "}
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
                  <h1>Profile</h1>
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
        <footer className="main-footer"><a href="/help">Help & privacy</a></footer>
      </main>
      {modal === "resource" && (
        <Modal
          title={
            editing ? "Edit item" : "Add item"
          }
          close={closeModal}
        >
          <ItemEditor
            userId={user.id}
            collections={collections}
            editing={editing}
            selectedCollection={collection}
            onSaved={async (_item, duplicate) => {
              await Promise.all([reloadResources(), reloadMeta()]); closeModal(); setNotice(duplicate ? "Already saved. Your original notes are intact." : editing ? "Changes saved." : "Saved to your library.");
            }}
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
