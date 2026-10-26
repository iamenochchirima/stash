"use client";
import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  Plus,
  Search,
  LoaderCircle,
  List,
  LayoutGrid,
} from "lucide-react";
import type { Item, Collection, Topic } from "@stash/shared";

import { ItemCard } from "./item-card";
import { AppShell, useWorkspace } from "../workspace/workspace";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "../ui/modal";
import { ErrorNote } from "../ui/error-note";
import { TopicForm } from "../topics/topic-form";
import { CollectionForm } from "./collection-form";
import { api } from "../../lib/api";

import { Portability } from "./portability";
import {
  LifecycleFeedback,
  recordLifecycle,
  clearLifecycleFeedback,
} from "../workspace/lifecycle-feedback";

import { ItemEditor } from "../items/item-editor";

const json = JSON.stringify;
export function LibraryPageClient({
  initialQuery = "",
  location: initialLocation = "library",
  favourites: initialFavourites = false,
  collectionId = "",
  topicId = "",
}: {
  initialQuery?: string;
  location?: string;
  favourites?: boolean;
  collectionId?: string;
  topicId?: string;
}) {
  const { user, collections, topics, refresh } = useWorkspace();
  const router = useRouter();
  const [topic, setTopic] = useState<Topic | null>(null),
    [topicError, setTopicError] = useState("");
  useEffect(() => {
    let active = true;
    if (topicId)
      void api<{ topic: Topic }>(`/topics/${topicId}`)
        .then((result) => {
          if (active) {
            setTopic(result.topic);
            setTopicError("");
          }
        })
        .catch((error) => {
          if (active) {
            setTopic(null);
            setTopicError(error.message);
          }
        });
    return () => {
      active = false;
    };
  }, [topicId, topics]);
  const [view, setView] = useState<"list" | "grid">("list");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionBusy, setSelectionBusy] = useState(false);
  useEffect(() => {
    try {
      setView(
        localStorage.getItem(`stash-library-view:${user.id}`) === "grid"
          ? "grid"
          : "list",
      );
    } catch {
      setView("list");
    }
  }, [user.id]);
  function changeView(next: "list" | "grid") {
    setView(next);
    try {
      localStorage.setItem(`stash-library-view:${user.id}`, next);
    } catch {}
  }
  function toggleItem(item: Item) {
    setSelecting(true);
    setSelected((ids) =>
      ids.includes(item.id)
        ? ids.filter((id) => id !== item.id)
        : [...ids, item.id],
    );
  }

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
      "resource" | "collection" | "portability" | "topic" | null
    >(null),
    [editing, setEditing] = useState<Item | null>(null);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(
    null,
  );
  useEffect(() => {
    setSelected((ids) =>
      ids.filter((id) => items.some((item) => item.id === id)),
    );
  }, [items]);
  const [kind, setKind] = useState(() => params.get("kind") || "");
  const [itemLocation, setItemLocation] = useState(() => initialLocation);
  const [favourites, setFavourites] = useState(() => initialFavourites);
  const [includeProjects, setIncludeProjects] = useState(
    () => params.get("includeProjects") === "true",
  );
  const libraryParams = new URLSearchParams();
  if (query) libraryParams.set("q", query);
  if (!topicId && query.trim() && includeProjects)
    libraryParams.set("includeProjects", "true");
  if (status) libraryParams.set("status", status);
  if (offset) libraryParams.set("offset", String(offset));
  if (kind) libraryParams.set("kind", kind);
  const basePath = topicId
    ? `/topics/${topicId}`
    : collection
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
  useEffect(() => {
    setSelected([]);
    setSelecting(false);
  }, [libraryPath, user.id]);
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
    if (topicId) params.set("topicId", topicId);
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);
    if (favourites) params.set("favourite", "true");
    if (!topicId && query.trim() && includeProjects)
      params.set("includeProjects", "true");
    params.set("location", itemLocation);
    const result = await api<{ items: Item[]; total: number }>(
      `/items?${params}`,
    );
    setItems(result.items);
    setTotal(result.total);
  }, [
    query,
    collection,
    topicId,
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
        if (topicId) params.set("topicId", topicId);
        if (status) params.set("status", status);
        if (kind) params.set("kind", kind);
        if (favourites) params.set("favourite", "true");
        if (!topicId && query.trim() && includeProjects)
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
    topicId,
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
  async function changeLifecycle(targets: Item[]) {
    if (selectionBusy || !targets.length) return;
    setSelectionBusy(true);
    setError("");
    const action = itemLocation === "trash" ? "restore" : "trash";
    const results = await Promise.allSettled(
      targets.map((item) =>
        api(`/items/${item.id}/lifecycle`, {
          method: "POST",
          headers: { "X-Stash-Account": user.id },
          body: json({ action }),
        }),
      ),
    );
    const failed = targets.filter(
      (_, index) => results[index].status === "rejected",
    );
    const succeeded = targets.filter(
      (_, index) => results[index].status === "fulfilled",
    );
    setSelected(failed.map((item) => item.id));
    setSelecting(failed.length > 0);
    if (succeeded.length === 1)
      recordLifecycle(user.id, succeeded[0].id, action);
    else if (succeeded.length) {
      clearLifecycleFeedback(user.id);
      setNotice(
        `${succeeded.length} items ${action === "trash" ? "moved to Trash" : "restored"}.`,
      );
    }
    if (failed.length)
      setError(
        `Could not ${action === "trash" ? "move to Trash" : "restore"} ${failed.length} ${failed.length === 1 ? "item" : "items"}. ${failed.length === 1 ? "It remains" : "They remain"} selected for retry.`,
      );
    try {
      await Promise.all([reloadResources(), reloadMeta()]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSelectionBusy(false);
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
          <ErrorNote message={error || topicError} />
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
                  {topicId && (
                    <Link href="/topics" className="text-button">
                      All topics
                    </Link>
                  )}
                  <h1>
                    {topicId
                      ? topic?.name || "Topic"
                      : itemLocation === "trash"
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
                  {topic?.description && (
                    <p className="topic-description">{topic.description}</p>
                  )}
                </div>
                <button
                  className="button primary"
                  disabled={!!topicId && (!topic || !!topicError)}
                  onClick={() => setModal("resource")}
                >
                  <Plus size={18} />
                  Add item
                </button>
              </div>
              {!topicId && !Object.values(user.onboarding).every(Boolean) && (
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
                {topic && (
                  <button
                    className="button secondary"
                    onClick={() => setModal("topic")}
                  >
                    Manage topic
                  </button>
                )}
                {!topicId && (
                  <>
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
                  </>
                )}
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
              {!topicId && query.trim() && (
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
                <div className="library-view-options">
                  <small>Newest first</small>
                  <button
                    type="button"
                    className="library-select-toggle"
                    disabled={selectionBusy}
                    aria-pressed={selecting}
                    onClick={() => {
                      setSelecting(!selecting);
                      setSelected([]);
                    }}
                  >
                    Select items
                  </button>
                  <div
                    className="library-view-toggle"
                    role="group"
                    aria-label="Library view"
                  >
                    <button
                      type="button"
                      aria-pressed={view === "list"}
                      onClick={() => changeView("list")}
                    >
                      <List size={15} />
                      List
                    </button>
                    <button
                      type="button"
                      aria-pressed={view === "grid"}
                      onClick={() => changeView("grid")}
                    >
                      <LayoutGrid size={15} />
                      Grid
                    </button>
                  </div>
                </div>
              </div>
              {selecting && (
                <div
                  className="library-selection"
                  role="group"
                  aria-label="Selected items"
                >
                  <label>
                    <input
                      type="checkbox"
                      aria-label="Select all items on this page"
                      ref={(input) => {
                        if (input)
                          input.indeterminate =
                            selected.length > 0 &&
                            selected.length < items.length;
                      }}
                      checked={
                        items.length > 0 &&
                        items.every((item) => selected.includes(item.id))
                      }
                      disabled={selectionBusy || loading}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? items.map((item) => item.id)
                            : [],
                        )
                      }
                    />
                    Select all
                  </label>
                  <span aria-live="polite">{selected.length} selected</span>
                  <button
                    type="button"
                    disabled={selectionBusy || !selected.length}
                    onClick={() =>
                      void changeLifecycle(
                        items.filter((item) => selected.includes(item.id)),
                      )
                    }
                  >
                    {selectionBusy
                      ? "Working…"
                      : itemLocation === "trash"
                        ? "Restore selected"
                        : "Move selected to Trash"}
                  </button>
                  <button
                    type="button"
                    disabled={selectionBusy}
                    onClick={() => {
                      setSelecting(false);
                      setSelected([]);
                    }}
                  >
                    Cancel selection
                  </button>
                </div>
              )}
              {loading ? (
                <div className="empty">
                  <LoaderCircle className="spin" />
                  <p>Loading…</p>
                </div>
              ) : items.length ? (
                <div
                  className={`library-items ${view === "grid" ? "resource-grid" : "resource-list"}`}
                  data-view={view}
                >
                  {items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      selecting={selecting}
                      selected={selected.includes(item.id)}
                      busy={selectionBusy}
                      onSelect={toggleItem}
                      onLifecycle={(item) => void changeLifecycle([item])}
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
            selectedTopic={topicId}
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
      {modal === "topic" && topic && (
        <Modal title="Manage topic" close={closeModal}>
          <TopicForm
            topic={topic}
            onSubmit={async (input) => {
              await api(`/topics/${topic.id}`, {
                method: "PATCH",
                headers: { "X-Stash-Account": user.id },
                body: json(input),
              });
              await refresh();
              closeModal();
            }}
            onDelete={async () => {
              await api(`/topics/${topic.id}`, {
                method: "DELETE",
                headers: { "X-Stash-Account": user.id },
              });
              await refresh();
              closeModal();
              router.push("/topics");
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
