"use client";
import { useEffect, useId, useRef, useState } from "react";
import { UpdatedTime } from "../ui/updated-time";
import Link from "next/link";
import { Link as LinkIcon, Lightbulb, FileText, Star, ArrowUpRight, Ellipsis } from "lucide-react";
import type { Item, Collection } from "@stash/shared";

export function ItemCard({ item, collections, location, returnTo, onAction, selecting, selected, busy, onSelect, onLifecycle }: {
  item: Item; collections: Collection[]; location: string; returnTo: string;
  onAction: (item: Item) => void; selecting: boolean; selected: boolean; busy: boolean;
  onSelect: (item: Item) => void; onLifecycle: (item: Item) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuId = useId(), menuRef = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 }), suppressClick = useRef(false);
  const stopHold = () => { clearTimeout(hold.current); };
  useEffect(() => () => clearTimeout(hold.current), []);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMenu(null);
    };
    const dismiss = () => setMenu(null);
    const scrollPosition = { x: window.scrollX, y: window.scrollY };
    const scroll = (event: Event) => {
      if (event.target === document && window.scrollX === scrollPosition.x && window.scrollY === scrollPosition.y) return;
      setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMenu(null); trigger.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [menu]);
  const showMenu = (x: number, y: number) => {
    if (!busy) setMenu({ x: Math.max(8, Math.min(x, innerWidth - 208)), y: Math.max(8, Math.min(y, innerHeight - 158)) });
  };
  const choose = (action: () => void) => { setMenu(null); trigger.current?.focus({ preventScroll: true }); action(); };
  const groupNames = collections.filter(c => item.collectionIds.includes(c.id)).map(c => c.name).join(", ") || "Unsorted";
  return (
    <article className={`resource-card${selected ? " is-selected" : ""}`}
      onContextMenu={event => {
        if ((event.target as HTMLElement).closest("input,.resource-source-action") || ((event.nativeEvent as PointerEvent).pointerType !== "touch" && window.getSelection()?.isCollapsed === false)) return;
        event.preventDefault(); stopHold();
        if ((event.nativeEvent as PointerEvent).pointerType === "touch") suppressClick.current = true;
        const rect = event.currentTarget.getBoundingClientRect();
        showMenu(event.clientX || rect.x + 24, event.clientY || rect.y + 24);
      }}
      onPointerDown={event => {
        if (event.pointerType !== "touch" || (event.target as HTMLElement).closest("button,input,.resource-source-action")) return;
        stopHold(); origin.current = { x: event.clientX, y: event.clientY };
        hold.current = setTimeout(() => { suppressClick.current = true; showMenu(origin.current.x, origin.current.y); }, 550);
      }}
      onPointerMove={event => { if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) stopHold(); }}
      onPointerUp={() => { stopHold(); if (menu) requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })); }} onPointerCancel={stopHold} onPointerLeave={stopHold}
      onClickCapture={event => {
        if (suppressClick.current) {
          suppressClick.current = false;
          if (!(event.target as HTMLElement).closest("button,input,[role=menu]")) { event.preventDefault(); event.stopPropagation(); }
        }
      }}
      onClick={event => {
        if ((event.target as HTMLElement).closest("a,button,input,select,textarea,summary") || window.getSelection()?.isCollapsed === false || busy) return;
        if (selecting) { onSelect(item); return; }
        const link = event.currentTarget.querySelector<HTMLAnchorElement>(".resource-open");
        if (event.metaKey || event.ctrlKey || event.shiftKey) { if (link) window.open(link.href, "_blank", "noopener,noreferrer"); }
        else link?.click();
      }}>
      {selecting && <input className="resource-select" type="checkbox" aria-label={`Select ${item.title}`} checked={selected} disabled={busy} onChange={() => onSelect(item)} />}
      <div className="resource-content">
        <div className="resource-heading">
          <span className="resource-icon" aria-hidden="true">{item.kind === "link" ? <LinkIcon size={17} /> : item.kind === "idea" ? <Lightbulb size={17} /> : <FileText size={17} />}</span>
          <Link className="resource-title resource-open" href={`/items/${item.id}?returnTo=${encodeURIComponent(returnTo)}${location === "trash" ? "&trash=true" : ""}`}
            onClick={event => { if (selecting || busy) { event.preventDefault(); if (!busy) onSelect(item); } }}>
            {item.title}
          </Link>
          {item.favourite && <Star size={12} aria-label="Favourite" />}
        </div>
        {(item.body || item.notes || item.description) && <p className="resource-notes">{item.body || item.notes || item.description}</p>}
        <div className="resource-metadata">
          <span className="resource-domain">{item.url ? new URL(item.url).hostname : item.kind === "idea" ? "Idea" : item.kind === "pdf" ? item.pdf?.filename || "PDF" : "Note"}{item.projectId && " · Project research"}</span>
          <span className="resource-collection" title={groupNames}>{groupNames}</span>
          <UpdatedTime value={item.updatedAt} />
        </div>
        {item.tags.length > 0 && <div className="tags">{item.tags.slice(0, 2).map(t => <span key={t}>{t}</span>)}{item.tags.length > 2 && <span aria-label={`${item.tags.length - 2} more tags`}>+{item.tags.length - 2}</span>}</div>}
      </div>
      <footer className="resource-actions">
        {["link", "pdf"].includes(item.kind) && <span className={`status ${item.status}`}>{item.status === "done" ? "Finished" : item.status === "reading" ? "Reading" : "Unread"}</span>}
        {item.url && location !== "trash" && <a className="resource-source-action" href={item.url} target="_blank" rel="noopener noreferrer" aria-label="Open source"><ArrowUpRight size={16} /></a>}
        <button className="text-button" disabled={busy} onClick={() => onAction(item)}>{location === "trash" ? "Restore" : "Edit"}</button>
        <button className="resource-menu-trigger" ref={trigger} disabled={busy} aria-label={`More actions for ${item.title}`} aria-haspopup="menu" aria-expanded={!!menu} aria-controls={menu ? menuId : undefined}
          onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); if (menu) setMenu(null); else showMenu(rect.right - 200, rect.bottom + 4); }}><Ellipsis size={18} /></button>
      </footer>
      {menu && <div id={menuId} ref={menuRef} role="menu" aria-label={`Actions for ${item.title}`} className="resource-menu" style={{ left: menu.x, top: menu.y }}
        onKeyDown={event => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus({ preventScroll: true });
          }
          if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); setMenu(null); trigger.current?.focus({ preventScroll: true }); }
        }}>
        <button role="menuitem" onClick={() => choose(() => onSelect(item))}>{selected ? "Deselect item" : "Select item"}</button>
        {location !== "trash" && <button role="menuitem" onClick={() => choose(() => onAction(item))}>Edit</button>}
        <button role="menuitem" onClick={() => choose(() => onLifecycle(item))}>{location === "trash" ? "Restore" : "Move to Trash"}</button>
      </div>}
    </article>
  );
}
