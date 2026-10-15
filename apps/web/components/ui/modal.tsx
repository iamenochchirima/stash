"use client";
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
export function Modal({
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
