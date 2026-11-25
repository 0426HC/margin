"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

const noSubscribe = () => () => {};

/**
 * A confirmation in Margin's own style, never a browser pop-up. It is a native modal <dialog>, so focus stays inside it, Escape cancels
 * and the page behind cannot be reached. Focus starts on Cancel, so a stray Enter never deletes anything, and returns to where it was.
 * It is drawn at the end of the page, outside whatever screen opened it, so the home and overview pages' own button styles never reach it.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  busyLabel = "Deleting…",
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** What the safe button says. */
  cancelLabel?: string;
  busy?: boolean;
  /** What the confirm button says while it works. */
  busyLabel?: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const host = useSyncExternalStore(noSubscribe, () => document.body, () => null); // the page it is drawn on exists only in the browser

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>("[data-initial]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, host]);

  if (!host) return null;
  return createPortal(
    <dialog
      ref={ref}
      className="m-dialog m-paper"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      onCancel={(e) => {
        e.preventDefault(); // Escape: let the page decide, so a delete in progress is not interrupted
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onCancel(); // a click on the dimmed page behind
      }}
      onKeyDown={(e) => {
        // keep Tab inside the dialog: from the last button back to the first, and Shift+Tab the other way
        if (e.key !== "Tab") return;
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
        if (!items.length) return e.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLElement);
        const wrap = e.shiftKey ? items[items.length - 1] : items[0];
        if ((e.shiftKey && at <= 0) || (!e.shiftKey && at === items.length - 1)) {
          e.preventDefault();
          wrap.focus();
        }
      }}
    >
      {open && (
        <div className="m-dialog-body">
          <h2 id={`${id}-title`} className="t-h3">
            {title}
          </h2>
          <div id={`${id}-text`} className="m-dialog-text">
            {children}
          </div>
          {error && (
            <p className="m-field-error" role="alert">
              {error}
            </p>
          )}
          <div className="m-dialog-actions">
            <Button data-initial onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button variant="accent" onClick={onConfirm} disabled={busy}>
              {busy ? busyLabel : confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>,
    host,
  );
}
