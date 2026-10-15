"use client";
import Link from "next/link";
import { Link as LinkIcon, Lightbulb, FileText, Star, ArrowUpRight } from "lucide-react";
import type { Item, Collection } from "@stash/shared";
export function ItemCard({
  item,
  collections,
  location,
  returnTo,
  onAction,
}: {
  item: Item;
  collections: Collection[];
  location: string;
  returnTo: string;
  onAction: (item: Item) => void;
}) {
  return (
    <article
      className="resource-card"
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "a,button,input,select,textarea,summary",
          ) ||
          window.getSelection()?.isCollapsed === false
        )
          return;
        const link =
          event.currentTarget.querySelector<HTMLAnchorElement>(
            ".resource-open",
          );
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          if (link) window.open(link.href, "_blank", "noopener,noreferrer");
        } else link?.click();
      }}
    >
      <div className="resource-card-top">
        <span className="resource-icon">
          {item.kind === "link" ? (
            <LinkIcon size={19} />
          ) : item.kind === "idea" ? (
            <Lightbulb size={19} />
          ) : (
            <FileText size={19} />
          )}
        </span>
        {["link", "pdf"].includes(item.kind) && (
          <span className={`status ${item.status}`}>
            {item.status === "done"
              ? "Finished"
              : item.status === "reading"
                ? "Reading"
                : "Unread"}
          </span>
        )}
      </div>
      <Link
        className="resource-title resource-open"
        href={`/items/${item.id}?returnTo=${encodeURIComponent(returnTo)}${location === "trash" ? "&trash=true" : ""}`}
      >
        {item.title}
      </Link>
      <div className="resource-domain">
        {item.url
          ? new URL(item.url).hostname
          : item.kind === "idea"
            ? "Idea"
            : item.kind === "pdf"
              ? item.pdf?.filename || "PDF"
              : "Note"}
        {item.projectId && <span> · Project research</span>}
        {item.favourite && <Star size={12} aria-label="Favourite" />}
      </div>
      {(item.body || item.notes || item.description) && (
        <p className="resource-notes">
          {item.body || item.notes || item.description}
        </p>
      )}
      <div className="tags">
        {item.tags.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <footer>
        {item.url && location !== "trash" && (
          <a
            className="resource-source-action"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open source"
          >
            <ArrowUpRight size={16} />
          </a>
        )}
        <span>
          {collections
            .filter((c) => item.collectionIds.includes(c.id))
            .map((c) => c.name)
            .join(", ") || "Unsorted"}{" "}
          ·{" "}
          {new Date(item.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
        <button className="text-button" onClick={() => onAction(item)}>
          {location === "trash" ? "Restore" : "Edit"}
        </button>
      </footer>
    </article>
  );
}
