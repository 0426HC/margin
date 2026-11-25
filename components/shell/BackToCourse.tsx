"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { cameFromTab, tabHref, type CourseTab } from "@/lib/overview/tabs";

const nothing = () => () => {};

/**
 * Something on top of the page that Escape belongs to: a dialog, the command bar, the source viewer, a practice exam, a menu, the focus
 * timer's panel. Only visible ones count: Next keeps pages visited earlier in the document, hidden.
 */
export const overlayOpen = () =>
  [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"], [role="menu"]')].some((el) => el.checkVisibility?.() ?? true);
/** Typing somewhere: Escape there is the text field's, never a way out of the page. */
export const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

/**
 * The way out of a section page (Note to Self, Let's talk!, Lecture notes, Exam room, a layer, a week synthesis), top left: "← Course name",
 * back to the course page on the tab the student came from (or the section's own tab when the page was opened by its address). The Mac
 * app's window has no back button, so Escape does the same, except while typing or while something is open on top of the page.
 */
export function BackToCourse({ projectId, course, own }: { projectId: string; course: string; /** this section's tab on the course page */ own: CourseTab }) {
  const router = useRouter();
  const tab = useSyncExternalStore(nothing, () => cameFromTab(projectId) ?? own, () => own);
  const href = tabHref(projectId, tab);

  useEffect(() => {
    // Decided before any other handler runs (an overlay may close itself on this very key and be gone by the time the key bubbles up),
    // acted on after them, and only if none of them claimed the key.
    const mine = new WeakSet<KeyboardEvent>();
    const first = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.isComposing && !typing(e.target) && !overlayOpen()) mine.add(e);
    };
    const last = (e: KeyboardEvent) => {
      if (mine.has(e) && !e.defaultPrevented) router.push(href);
    };
    window.addEventListener("keydown", first, true);
    window.addEventListener("keydown", last);
    return () => {
      window.removeEventListener("keydown", first, true);
      window.removeEventListener("keydown", last);
    };
  }, [href, router]);

  return (
    <Link href={href} className="m-back" aria-label={`Back to ${course}`} aria-keyshortcuts="Escape">
      <span className="m-back-arrow" aria-hidden="true">
        ←
      </span>
      <span className="m-back-name">{course}</span>
    </Link>
  );
}
