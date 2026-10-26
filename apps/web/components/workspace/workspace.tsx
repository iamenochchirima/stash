"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  Children,
  isValidElement,
  cloneElement,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Folder,
  Library,
  Star,
  Archive,
  Trash2,
  KeyRound,
  Plus,
  Settings,
  Hash,
} from "lucide-react";
import type { Profile, Collection, Topic } from "@stash/shared";
import { api, ApiError } from "../../lib/api";
import { scopeItemDraftsToUser } from "../../lib/draft-storage";
import { useAccountSession } from "../../hooks/use-account-session";
import { Brand } from "../ui/brand";
import { Modal } from "../ui/modal";
import { TopicForm } from "../topics/topic-form";
import { CollectionForm } from "../library/collection-form";
type WorkspaceState = {
  user: Profile;
  setUser: (user: Profile) => void;
  collections: Collection[];
  topics: Topic[];
  createTopic: () => void;
  count: number;
  refresh: () => Promise<void>;
  createCollection: () => void;
  collectionOpen: boolean;
};
const WorkspaceContext = createContext<WorkspaceState | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw Error("Workspace provider required");
  return value;
}
export function WorkspaceProvider({
  initialUser,
  children,
}: {
  initialUser: Profile;
  children: ReactNode;
}) {
  const [user, setUser] = useState(initialUser),
    [collections, setCollections] = useState<Collection[]>([]),
    [count, setCount] = useState(0),
    [topics, setTopics] = useState<Topic[]>([]),
    [topicOpen, setTopicOpen] = useState(false),
    [collectionOpen, setCollectionOpen] = useState(false);
  const pathname = usePathname(),
    router = useRouter();
  useAccountSession(user.id);
  const refresh = useCallback(async () => {
    try {
      const [groups, items, profile, topicGroups] = await Promise.all([
        api<{ items: Collection[] }>("/collections"),
        api<{ total: number }>("/items?limit=1"),
        api<{ user: Profile }>("/me"),
        api<{ items: Topic[] }>("/topics"),
      ]);
      setCollections(groups.items);
      setTopics(topicGroups.items);
      setCount(items.total);
      setUser(profile.user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) router.replace("/signin");
      else throw e;
    }
  }, [router]);
  useEffect(() => {
    scopeItemDraftsToUser(user.id);
  }, [user.id]);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [pathname, refresh]);
  return (
    <WorkspaceContext.Provider
      value={{
        user,
        setUser,
        collections,
        topics,
        createTopic: () => setTopicOpen(true),
        count,
        refresh,
        createCollection: () => setCollectionOpen(true),
        collectionOpen: collectionOpen || topicOpen,
      }}
    >
      {children}
      {topicOpen && (
        <Modal title="Create a topic" close={() => setTopicOpen(false)}>
          <TopicForm
            onSubmit={async (input) => {
              const result = await api<{ topic: Topic }>("/topics", {
                method: "POST",
                headers: { "X-Stash-Account": user.id },
                body: JSON.stringify(input),
              });
              await refresh();
              setTopicOpen(false);
              router.push(`/topics/${result.topic.id}`);
            }}
          />
        </Modal>
      )}
      {collectionOpen && (
        <Modal
          title="Create a collection"
          close={() => setCollectionOpen(false)}
        >
          <CollectionForm
            label="Collection name"
            placeholder="e.g. Research"
            onSubmit={async (name) => {
              await api("/collections", {
                method: "POST",
                body: JSON.stringify({ name }),
              });
              await refresh();
              setCollectionOpen(false);
            }}
          />
        </Modal>
      )}
    </WorkspaceContext.Provider>
  );
}
export function AppShell({
  children,
  modalOpen = false,
  onCreateCollection,
}: {
  children: ReactNode;
  modalOpen?: boolean;
  onCreateCollection?: () => void;
}) {
  const {
      user,
      collections,
      topics,
      count,
      createCollection,
      createTopic,
      collectionOpen,
    } = useWorkspace(),
    pathname = usePathname(),
    blocked = modalOpen || collectionOpen;
  const links = [
    { href: "/topics", label: "Topics", icon: Hash },
    { href: "/projects", label: "Projects", icon: Folder },
    { href: "/library", label: "All items", icon: Library },
    { href: "/library/favourites", label: "Favourites", icon: Star },
    { href: "/library/archive", label: "Archive", icon: Archive },
    { href: "/library/trash", label: "Trash", icon: Trash2 },
    { href: "/connections", label: "Agent connections", icon: KeyRound },
  ];
  return (
    <div className="app-layout">
      <aside
        className="sidebar"
        inert={blocked || undefined}
        aria-hidden={blocked || undefined}
      >
        <Brand />
        <nav aria-label="Main navigation">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`nav-item${pathname === href ? " active" : ""}`}
            >
              <Icon size={19} />
              {label}
              {href === "/library" && <span className="count">{count}</span>}
            </Link>
          ))}
        </nav>
        <div className="collection-heading">
          TOPICS
          <button
            className="icon-button"
            aria-label="Create topic"
            onClick={createTopic}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="collection-list">
          {topics.map((topic) => (
            <Link
              key={topic.id}
              href={`/topics/${topic.id}`}
              aria-current={
                pathname === `/topics/${topic.id}` ? "page" : undefined
              }
              className={`nav-item${pathname === `/topics/${topic.id}` ? " active" : ""}`}
            >
              <Hash size={18} />
              <span className="truncate">{topic.name}</span>
            </Link>
          ))}
        </div>
        <div className="collection-heading">
          COLLECTIONS
          <button
            className="icon-button"
            aria-label="Create collection"
            onClick={onCreateCollection || createCollection}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="collection-list">
          {collections.map((c) => (
            <Link
              key={c.id}
              href={`/library/collections/${c.id}`}
              className={`nav-item${pathname === `/library/collections/${c.id}` ? " active" : ""}`}
            >
              <Folder size={18} />
              <span className="truncate">{c.name}</span>
            </Link>
          ))}
        </div>
        <div className="sidebar-bottom">
          <Link
            href="/profile"
            className="profile-button"
            aria-label="Open profile"
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
          </Link>
        </div>
      </aside>
      {Children.map(children, (child) =>
        isValidElement(child) && child.type === "main"
          ? cloneElement(
              child as React.ReactElement<{
                inert?: boolean;
                "aria-hidden"?: boolean;
              }>,
              {
                inert: blocked || undefined,
                "aria-hidden": blocked || undefined,
              },
            )
          : child,
      )}
    </div>
  );
}
