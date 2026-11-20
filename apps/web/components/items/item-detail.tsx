"use client";
import { SiteBrand } from "../ui/brand";
import { LifecycleFeedback, recordLifecycle } from "../workspace/lifecycle-feedback";
import { useWorkspace } from "../workspace/workspace";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowUpRight, Copy, LoaderCircle, Pencil, X, Star, Archive, Trash2, RotateCcw, ListTodo } from "lucide-react";
import type { Item, Collection } from "@stash/shared";
import { api, ApiError } from "../../lib/api";
import { SummaryPanel } from "./summary-panel";
import { PdfReader } from "./pdf-reader";
import { MermaidDiagram } from "./mermaid-diagram";
import { UpdatedTime } from "../ui/updated-time";
import { ProjectDocumentActions } from "../projects/project-document-actions";
import { ItemEditor } from "./item-editor";
export function ItemDetail({ id }: { id: string }) {
  const router = useRouter();
  const { user, topics } = useWorkspace();
  const userId = user.id;
  const [item, setItem] = useState<Item | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  const [returnTo, setReturnTo] = useState("/library"),
    [trash, setTrash] = useState(false),
    [projectArchived, setProjectArchived] = useState(false);
  const load = useCallback(async () => {
    setError("");
    const inTrash =
      new URLSearchParams(location.search).get("trash") === "true";
    setTrash(inTrash);
    try {
      const [resource, groups] = await Promise.all([
        api<{ item: Item }>(`/items/${id}${inTrash ? "?trash=true" : ""}`),
        api<{ items: Collection[] }>("/collections"),
      ]);
      setItem(resource.item);
      if (resource.item.projectId) {
        const p = await api<{ project: { archivedAt: string | null } }>(
          `/projects/${resource.item.projectId}`,
        );
        setProjectArchived(!!p.project.archivedAt);
      }
      if (
        resource.item.projectId &&
        !new URLSearchParams(location.search).get("returnTo")
      )
        setReturnTo(`/projects/${resource.item.projectId}`);
      setCollections(groups.items);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(`/signin?next=${encodeURIComponent(`/items/${id}`)}`);
        return;
      }
      setError(
        e instanceof ApiError && [400, 404].includes(e.status)
          ? "Item not found."
          : e instanceof ApiError && e.status === 429
            ? e.message
            : "Could not load this item. Try again.",
      );
    }
  }, [id, router]);
  useEffect(() => {
    const candidate = new URLSearchParams(location.search).get("returnTo");
    if (candidate) {
      const url = new URL(candidate, location.origin);
      if (
        url.origin === location.origin &&
        (url.pathname === "/" ||
          /^(?:\/library(?:\/(?:archive|trash|favourites|collections\/[a-f0-9-]{36}))?|\/todos|\/topics\/[a-f0-9-]{36})$/.test(
            url.pathname,
          ) ||
          /^\/projects\/[0-9a-f-]{36}$/.test(url.pathname))
      )
        setReturnTo(url.pathname + url.search);
    }
    void load();
  }, [load]);
  async function action(
    type: "archive" | "unarchive" | "trash" | "restore" | "purge",
  ) {
    if (
      type === "purge" &&
      !confirm("Permanently delete this item? It cannot be restored.")
    )
      return;
    setBusy(true);
    setNotice("");
    try {
      await api(`/items/${id}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ action: type }),
      });
      const menu = document.querySelector<HTMLDetailsElement>(".item-more");
      if (menu) menu.open = false;
      recordLifecycle(userId, id, type);
      if (["trash", "restore", "purge"].includes(type)) router.push(returnTo);
      else await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="item-shell">
      <header className="item-header">
        <SiteBrand href="/library" />
        <Link className="item-back" href={returnTo}>
          <ArrowLeft size={16} />
          {item?.projectId ? "Back to project" : "Back to library"}
        </Link>
      </header>
      <main className="item-reading">
        <LifecycleFeedback userId={userId} onChanged={load} />
        {error ? (
          <section>
            <h1>
              {error === "Item not found."
                ? "Item not found"
                : "Unable to open item"}
            </h1>
            <p role="alert">{error}</p>
            {error !== "Item not found." && (
              <button className="button secondary" onClick={() => void load()}>
                Try again
              </button>
            )}
          </section>
        ) : !item ? (
          <p role="status">
            <LoaderCircle className="spin" size={18} /> Loading item…
          </p>
        ) : (
          <>
            {editing ? (
              <>
                <div className="item-heading">
                  <h1>Edit item</h1>
                  <button
                    className="button secondary"
                    onClick={() => {
                      if (
                        confirm(
                          "Close the editor? Your draft will remain on this device until sign-out.",
                        )
                      )
                        setEditing(false);
                    }}
                  >
                    <X size={16} />
                    Close editor
                  </button>
                </div>
                <ItemEditor
                  key={item.id}
                  userId={userId}
                  editing={item}
                  collections={collections}
                  onSaved={(saved) => {
                    setItem(saved);
                    setEditing(false);
                    setNotice("Changes saved.");
                  }}
                />
              </>
            ) : (
              <>
                <div className="item-context">
                  <span>
                    {item.kind === "link"
                      ? "Saved link"
                      : item.kind === "note"
                        ? "Note"
                        : item.kind === "idea"
                          ? "Idea"
                          : "PDF"}
                  </span>
                  {item.url && <span>{new URL(item.url).hostname}</span>}
                  {item.archivedAt && <span>Archived</span>}
                  {trash && <span>In Trash</span>}
                </div>
                <h1>{item.title}</h1>
                <div className="item-actions">
                  {trash ? (
                    <>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => void action("restore")}
                      >
                        <RotateCcw size={16} />
                        Restore
                      </button>
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={() => void action("purge")}
                      >
                        <Trash2 size={16} />
                        Delete permanently
                      </button>
                    </>
                  ) : (
                    <>
                      {item.url && (
                        <a
                          className="button primary"
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open source <ArrowUpRight size={16} />
                        </a>
                      )}
                      <button className="button secondary" onClick={()=>router.push(`/todos?sourceId=${encodeURIComponent(item.id)}${item.projectId?`&projectId=${encodeURIComponent(item.projectId)}`:""}`)}><ListTodo size={15}/>Create task</button>
                      <button
                        className="button secondary"
                        disabled={projectArchived}
                        onClick={() => setEditing(true)}
                      >
                        <Pencil size={15} />
                        Edit
                      </button>
                      <button
                        className="button secondary"
                        disabled={busy}
                        aria-pressed={item.favourite}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const r = await api<{ item: Item }>(
                              `/items/${id}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  revision: item.revision,
                                  favourite: !item.favourite,
                                }),
                              },
                            );
                            setItem(r.item);
                          } catch (e) {
                            setNotice((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <Star
                          size={15}
                          fill={item.favourite ? "currentColor" : "none"}
                        />
                        {item.favourite ? "Favourited" : "Favourite"}
                      </button>
                      <button
                        className="button secondary"
                        onClick={() =>
                          navigator.clipboard
                            .writeText(`${location.origin}/items/${id}`)
                            .then(() => setNotice("Stash link copied."))
                            .catch(() =>
                              setNotice(
                                "Clipboard unavailable. Copy the address from your browser.",
                              ),
                            )
                        }
                      >
                        <Copy size={15} />
                        Copy Stash link
                      </button>
                      <details className="item-more">
                        <summary>More</summary>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              item.archivedAt ? "unarchive" : "archive",
                            )
                          }
                        >
                          <Archive size={15} />
                          {item.archivedAt ? "Unarchive" : "Archive"}
                        </button>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => void action("trash")}
                        >
                          <Trash2 size={15} />
                          Move to Trash
                        </button>
                      </details>
                    </>
                  )}
                </div>
                {item.kind === "pdf" && !trash && (
                  <PdfReader item={item} onReady={load} page={pdfPage} />
                )}
                {["link", "pdf"].includes(item.kind) && !trash && (
                  <SummaryPanel
                    item={item}
                    onPdfPage={(page) => {
                      setPdfPage(page);
                      document
                        .getElementById(`pdf-page-${page}`)
                        ?.scrollIntoView({ block: "start" });
                    }}
                  />
                )}
                {item.body && (
                  <div className="item-markdown">
                    <Markdown
                      skipHtml
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre: ({ children, node }) => {
                          const code = node?.children[0];
                          if (code?.type === "element" && code.tagName === "code" &&
                            Array.isArray(code.properties.className) && code.properties.className.includes("language-mermaid")) {
                            const source = code.children.map(child => child.type === "text" ? child.value : "").join("");
                            return <MermaidDiagram source={source} />;
                          }
                          return <pre tabIndex={0} role="region" aria-label="Code block">{children}</pre>;
                        },
                        input: ({ checked }) => (
                          <input type="checkbox" disabled checked={checked} aria-label={checked ? "Completed task" : "Incomplete task"} />
                        ),
                        table: ({ children }) => (
                          <div
                            className="item-markdown-table"
                            role="region"
                            aria-label="Markdown table"
                            tabIndex={0}
                          >
                            <table>{children}</table>
                          </div>
                        ),
                        img: ({ src, alt, title }) => (
                          src ? (
                            <img
                              src={src}
                              alt={alt || ""}
                              title={title}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : <span>{alt}</span>
                        ),
                        a: ({ children, href }) => (
                          <a
                            href={href}
                            target={href?.startsWith("#") ? undefined : "_blank"}
                            rel="noopener noreferrer"
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {item.body}
                    </Markdown>
                  </div>
                )}
                {(item.notes || item.description) && (
                  <section className="item-body">
                    <h2>{item.notes ? "Your notes" : "About this link"}</h2>
                    <p>{item.notes || item.description}</p>
                  </section>
                )}
                <ProjectDocumentActions item={item} />
                {item.topicIds.length > 0 && <nav className="item-topics" aria-label="Item topics">{topics.filter(topic => item.topicIds.includes(topic.id)).map(topic => <Link key={topic.id} href={`/topics/${topic.id}`}>{topic.name}</Link>)}</nav>}
                <div className="item-tags">
                  {item.tags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </div>
                <footer className="item-meta">
                  <span>
                    {collections
                      .filter((c) => item.collectionIds.includes(c.id))
                      .map((c) => c.name)
                      .join(", ") || "Unsorted"}
                  </span>
                  {["link", "pdf"].includes(item.kind) && (
                    <span>
                      {item.status === "done"
                        ? "Finished"
                        : item.status === "reading"
                          ? "Reading"
                          : "Unread"}
                    </span>
                  )}
                  <UpdatedTime value={item.updatedAt} />
                </footer>
              </>
            )}
            {notice && (
              <p role="status" className="item-notice">
                {notice}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
