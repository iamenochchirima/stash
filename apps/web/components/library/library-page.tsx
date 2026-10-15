"use client";
import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  Plus,
  Search,
  LoaderCircle,
} from "lucide-react";
import type { Item, Collection } from "@stash/shared";

import { ItemCard } from "./item-card";
import { AppShell, useWorkspace } from "../workspace/workspace";
import { useRouter } from "next/navigation";
import { Modal } from "../ui/modal";
import { ErrorNote } from "../ui/error-note";
import { CollectionForm } from "./collection-form";
import { api } from "../../lib/api";

import { Portability } from "./portability";
import {
  LifecycleFeedback,
  recordLifecycle,
} from "../workspace/lifecycle-feedback";

import { ItemEditor } from "../items/item-editor";

const json = JSON.stringify;
export function LibraryPageClient({
  initialQuery = "",
  location: initialLocation = "library",
  favourites: initialFavourites = false,
  collectionId = "",
}: {
  initialQuery?: string;
  location?: string;
  favourites?: boolean;
  collectionId?: string;
}) {
  const { user, collections, refresh } = useWorkspace();
  const router = useRouter();
  const params = new URLSearchParams(initialQuery);
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState(() => params.get("q") || ""),
    [collection, setCollection] = useState(() => collectionId),
    [status, setStatus] = useState(() => params.get("status") || "");
  const [total, setTotal] = useState(0),
    [offset, setOffset] = useState(() =>
      Math.max(0, Math.min(100000, Number(params.get("offset")) || 0)),
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<
      "resource" | "collection" | "portability" | null
    >(null),
    [editing, setEditing] = useState<Item | null>(null);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(
    null,
  );
  const [kind, setKind] = useState(() => params.get("kind") || "");
  const [itemLocation, setItemLocation] = useState(() => initialLocation);
  const [favourites, setFavourites] = useState(() => initialFavourites);
  const [includeProjects, setIncludeProjects] = useState(
    () => params.get("includeProjects") === "true",
  );
  const libraryParams = new URLSearchParams();
  if (query) libraryParams.set("q", query);
  if (query.trim() && includeProjects)
    libraryParams.set("includeProjects", "true");
  if (status) libraryParams.set("status", status);
  if (offset) libraryParams.set("offset", String(offset));
  if (kind) libraryParams.set("kind", kind);
  const basePath = collection
    ? `/library/collections/${collection}`
    : initialFavourites
      ? "/library/favourites"
      : initialLocation !== "library"
        ? `/library/${initialLocation}`
        : "/library";
  const libraryPath = libraryParams.size
    ? `${basePath}?${libraryParams}`
    : basePath;
  useEffect(() => {
    history.replaceState(history.state, "", libraryPath);
  }, [libraryPath]);
  const closeModal = useCallback(() => {
    setModal(null);
    setEditing(null);
  }, []);
  const reloadMeta = refresh;
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
    if (query.trim() && includeProjects) params.set("includeProjects", "true");
    params.set("location", itemLocation);
    const result = await api<{ items: Item[]; total: number }>(
      `/items?${params}`,
    );
    setItems(result.items);
    setTotal(result.total);
  }, [
    query,
    collection,
    status,
    offset,
    kind,
    favourites,
    itemLocation,
    includeProjects,
  ]);
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
        if (query.trim() && includeProjects)
          params.set("includeProjects", "true");
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
  }, [
    query,
    collection,
    status,
    offset,
    kind,
    favourites,
    itemLocation,
    includeProjects,
  ]);
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
    <AppShell
      modalOpen={!!modal}
      onCreateCollection={() => {
        setEditingCollection(null);
        setModal("collection");
      }}
    >
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
          <LifecycleFeedback
            userId={user.id}
            onChanged={async () => {
              await Promise.all([reloadResources(), reloadMeta()]);
            }}
          />
          {notice && (
            <div role="status" className="toast">
              <Check size={16} />
              {notice}
            </div>
          )}
          {
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    {itemLocation === "trash"
                      ? "Trash"
                      : itemLocation === "archive"
                        ? "Archive"
                        : favourites
                          ? "Favourites"
                          : collection
                            ? collections.find((c) => c.id === collection)
                                ?.name || "Collection"
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
                        action: () => router.push("/profile"),
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
                        action: () => router.push("/connections"),
                      },
                      {
                        done: user.onboarding.retrieved,
                        title: "Retrieve your research",
                        action: () => router.push("/connections"),
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
                <select
                  aria-label="Filter by type"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">All types</option>
                  <option value="link">Links</option>
                  <option value="note">Notes</option>
                  <option value="idea">Ideas</option>
                  <option value="pdf">PDFs</option>
                </select>
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
              {query.trim() && (
                <label className="project-search-toggle">
                  <input
                    type="checkbox"
                    checked={includeProjects}
                    onChange={(e) => {
                      setIncludeProjects(e.target.checked);
                      setOffset(0);
                    }}
                  />
                  Include project research
                </label>
              )}
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
                    <ItemCard
                      key={item.id}
                      item={item}
                      collections={collections}
                      location={itemLocation}
                      returnTo={libraryPath}
                      onAction={(item) => {
                        if (itemLocation === "trash") {
                          void mutate(async () => {
                            await api(`/items/${item.id}/lifecycle`, {
                              method: "POST",
                              body: json({ action: "restore" }),
                            });
                            recordLifecycle(user.id, item.id, "restore");
                          });
                          return;
                        }
                        api<{ item: Item }>(`/items/${item.id}`)
                          .then((result) => {
                            setEditing(result.item);
                            setModal("resource");
                          })
                          .catch((e) => setError(e.message));
                      }}
                    />
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
                      : itemLocation === "trash"
                        ? "Items stay here for 30 days before permanent deletion."
                        : itemLocation === "archive"
                          ? "Archived items will appear here."
                          : "Save a link, note or idea, or ask your agent to stash it."}
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
          }
        </div>
        <footer className="main-footer">
          <a href="/help">Help & privacy</a>
        </footer>
      </main>
      {modal === "resource" && (
        <Modal title={editing ? "Edit item" : "Add item"} close={closeModal}>
          <ItemEditor
            userId={user.id}
            collections={collections}
            editing={editing}
            selectedCollection={collection}
            onSaved={async (_item, duplicate) => {
              await Promise.all([reloadResources(), reloadMeta()]);
              closeModal();
              setNotice(
                duplicate
                  ? "Already saved. Your original notes are intact."
                  : editing
                    ? "Changes saved."
                    : "Saved to your library.",
              );
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
          <CollectionForm
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
                      router.push("/library");
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
    </AppShell>
  );
}
