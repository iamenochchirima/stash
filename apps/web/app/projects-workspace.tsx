"use client";
import { LifecycleFeedback } from "./lifecycle-feedback";
import { useAccountSession } from "./session-guard";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Folder, Search, Archive } from "lucide-react";
import type { Project, Item, Profile } from "@stash/shared";
import { api, ApiError } from "./api";
import { ItemEditor, scopeItemDraftsToUser } from "./item-editor";
export function ProjectsWorkspace({ id }: { id?: string }) {
  const router = useRouter(),
    [userId, setUserId] = useState(""),
    [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [items, setItems] = useState<Item[]>([]);
  useAccountSession(userId);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [archived, setArchived] = useState(false),
    [query, setQuery] = useState(() =>
      typeof window !== "undefined"
        ? new URLSearchParams(location.search).get("q") || ""
        : "",
    ),
    [offset, setOffset] = useState(() =>
      typeof window !== "undefined"
        ? Math.max(
            0,
            Math.min(
              100000,
              Number(new URLSearchParams(location.search).get("offset")) || 0,
            ),
          )
        : 0,
    ),
    [total, setTotal] = useState(0),
    [trash, setTrash] = useState(
      () =>
        typeof window !== "undefined" &&
        new URLSearchParams(location.search).get("trash") === "true",
    );
  const [creating, setCreating] = useState(false),
    [editing, setEditing] = useState(false),
    [capture, setCapture] = useState(false),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [repositoryUrl, setRepositoryUrl] = useState("");
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (trash) params.set("trash", "true");
  if (offset) params.set("offset", String(offset));
  const returnPath = `/projects/${id}${params.size ? `?${params}` : ""}`;
  useEffect(() => {
    if (id) history.replaceState(history.state, "", returnPath);
  }, [id, returnPath]);
  const load = useCallback(async () => {
    setError("");
    try {
      const me = await api<{ user: Profile }>("/me");
      setUserId(me.user.id);scopeItemDraftsToUser(me.user.id);
      if (id) {
        const [p, r] = await Promise.all([
          api<{ project: Project }>(`/projects/${id}`),
          api<{ items: Item[]; total: number }>(
            `/items?projectId=${id}&includeArchived=true&location=${trash ? "trash" : "library"}&q=${encodeURIComponent(query)}&offset=${offset}`,
          ),
        ]);
        setProject(p.project);
        setItems(r.items);
        setTotal(r.total);
      } else
        setProjects(
          (await api<{ items: Project[] }>(`/projects?archived=${archived}`))
            .items,
        );
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(
          `/signin?next=${encodeURIComponent(id ? `/projects/${id}` : "/projects")}`,
        );
        return;
      }
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, query, offset, archived, trash, router]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ project: Project }>(
        id ? `/projects/${id}` : "/projects",
        {
          method: id ? "PATCH" : "POST",
          body: JSON.stringify({
            name,
            description,
            repositoryUrl: repositoryUrl || null,
            ...(id && { revision: project!.revision }),
          }),
        },
      );
      setCreating(false);
      setEditing(false);
      if (!id) router.push(`/projects/${r.project.id}`);
      else await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!project) return;
    setBusy(true);
    try {
      const r = await api<{ project: Project }>(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          revision: project.revision,
          archived: !project.archivedAt,
        }),
      });
      setProject(r.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const form = (creating || editing) && (
    <section className="project-form">
      <h2>{id ? "Edit project" : "New project"}</h2>
      <form onSubmit={save}>
        <label>
          Project name
          <input
            autoFocus
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={4000}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional context for your research"
          />
        </label>
        <label>
          Repository URL
          <input
            type="url"
            maxLength={2048}
            value={repositoryUrl}
            onChange={(e) => setRepositoryUrl(e.target.value)}
            placeholder="Optional"
          />
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setCreating(false);
              setEditing(false);
            }}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : id ? "Save project" : "Create project"}
          </button>
        </div>
      </form>
    </section>
  );
  return (
    <div className="project-shell">
      <header className="item-header">
        <Link href="/" className="site-brand">
          <img src="/stash.png" width={30} height={30} alt="" />
          <span>
            stash<span className="brand-dot">.</span>
          </span>
          <span className="release-badge">Alpha</span>
        </Link>
        <Link className="item-back" href={id ? "/projects" : "/"}>
          <ArrowLeft size={16} />
          {id ? "All projects" : "Back to library"}
        </Link>
      </header>
      <main className="project-main"><LifecycleFeedback userId={userId} onChanged={load}/>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading projects…</p>
        ) : id && !project ? (
          <h1>Project not found</h1>
        ) : (
          <>
            <div className="project-heading">
              <div>
                <p className="project-eyebrow">
                  {id ? "Project research" : "Workspace"}
                </p>
                <h1>{id ? project!.name : "Projects"}</h1>
              </div>
              {id ? (
                <div className="project-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      setName(project!.name);
                      setDescription(project!.description);
                      setRepositoryUrl(project!.repositoryUrl || "");
                      setEditing((v) => !v);
                    }}
                  >
                    Edit project
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void archive()}
                  >
                    <Archive size={15} />
                    {project!.archivedAt ? "Reopen project" : "Archive project"}
                  </button>
                </div>
              ) : (
                <button
                  className="button primary"
                  onClick={() => {
                    setCreating((v) => !v);
                    setName("");
                    setDescription("");
                    setRepositoryUrl("");
                  }}
                >
                  <Plus size={16} />
                  New project
                </button>
              )}
            </div>
            {!id && (
              <p className="project-description">
                A separate place for research and work in progress.
              </p>
            )}
            {id && project!.description && (
              <p className="project-description">{project!.description}</p>
            )}
            {id && project!.repositoryUrl && (
              <a
                className="project-repository"
                href={project!.repositoryUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Repository ↗
              </a>
            )}
            {id && project!.archivedAt && (
              <p role="status" className="project-archived">
                Archived. Reopen this project to add or edit research.
              </p>
            )}
            {form}
            {!id ? (
              <>
                <div className="project-tabs">
                  <button
                    className={!archived ? "active" : ""}
                    onClick={() => setArchived(false)}
                  >
                    Active
                  </button>
                  <button
                    className={archived ? "active" : ""}
                    onClick={() => setArchived(true)}
                  >
                    Archived
                  </button>
                </div>
                <div className="project-grid">
                  {projects.map((p) => (
                    <Link
                      className="project-card"
                      key={p.id}
                      href={`/projects/${p.id}`}
                    >
                      <Folder size={21} />
                      <h2>{p.name}</h2>
                      {p.description && <p>{p.description}</p>}
                      <small>
                        {p.itemCount} {p.itemCount === 1 ? "item" : "items"}
                      </small>
                    </Link>
                  ))}
                </div>
                {!projects.length && (
                  <div className="project-empty">
                    <p>
                      {archived
                        ? "No archived projects."
                        : "Create a project to keep related research together."}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="project-tabs">
                  <button
                    className={!trash ? "active" : ""}
                    onClick={() => {
                      setTrash(false);
                      setOffset(0);
                    }}
                  >
                    Research
                  </button>
                  <button
                    className={trash ? "active" : ""}
                    onClick={() => {
                      setTrash(true);
                      setOffset(0);
                    }}
                  >
                    Trash
                  </button>
                </div>
                <div className="project-tools">
                  <label className="project-search">
                    <Search size={17} />
                    <input
                      aria-label="Search project"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setOffset(0);
                      }}
                      placeholder="Search this project"
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={!!project!.archivedAt || trash}
                    onClick={() => setCapture((v) => !v)}
                  >
                    <Plus size={16} />
                    Add research
                  </button>
                </div>
                {capture && (
                  <section className="project-form">
                    <div className="project-heading">
                      <h2>Add research</h2>
                      <button
                        className="button secondary"
                        onClick={() => setCapture(false)}
                      >
                        Close
                      </button>
                    </div>
                    <ItemEditor
                      userId={userId}
                      projectId={id}
                      collections={[]}
                      onSaved={async (item) => {
                        setCapture(false);
                        router.push(
                          `/items/${item.id}?returnTo=${encodeURIComponent(returnPath)}`,
                        );
                      }}
                    />
                  </section>
                )}
                <div className="project-items">
                  {items.map((item) => (
                    <Link
                      className="project-item"
                      key={item.id}
                      href={`/items/${item.id}?returnTo=${encodeURIComponent(returnPath)}${trash ? "&trash=true" : ""}`}
                    >
                      <div>
                        <span className="project-kind">
                          {item.kind}
                          {item.archivedAt ? " · Archived" : ""}
                        </span>
                        <h2>{item.title}</h2>
                        {(item.body || item.notes) && (
                          <p>
                            {(item.body || item.notes).replace(/^#+\s*/gm, "")}
                          </p>
                        )}
                      </div>
                      <small>
                        {new Date(item.updatedAt).toLocaleDateString()}
                      </small>
                    </Link>
                  ))}
                </div>
                {!items.length && !capture && (
                  <div className="project-empty">
                    <p>
                      {query
                        ? "No matching research."
                        : "Save sources, develop an idea or add your research notes."}
                    </p>
                  </div>
                )}
                {total > 24 && (
                  <nav className="pdf-pagination" aria-label="Project pages">
                    <button
                      className="button secondary"
                      disabled={!offset}
                      onClick={() => setOffset((v) => Math.max(0, v - 24))}
                    >
                      Previous
                    </button>
                    <span>
                      {offset + 1}–{Math.min(offset + 24, total)} of {total}
                    </span>
                    <button
                      className="button secondary"
                      disabled={offset + 24 >= total}
                      onClick={() => setOffset((v) => v + 24)}
                    >
                      Next
                    </button>
                  </nav>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
