"use client";

import { AnimatePresence, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExplainedView, OriginalView } from "./Views";
import { MasteryMark } from "./MasteryMark";
import { ViewToggle } from "./ViewToggle";
import { explained, original, section, type Mode, type Status } from "./data";

const storeKey = (id: string) => `margin.view.${id}`;

export function ReadingPane({
  sectionId,
  title,
  status,
  why,
  hasContent,
  jump,
  viewCmd,
}: {
  sectionId: string;
  title: string;
  status: Status;
  why: string;
  hasContent: boolean;
  jump: { page: number; n: number } | null;
  viewCmd: { mode: Mode; n: number } | null;
}) {
  const reduced = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Mode>("original");
  const [flash, setFlash] = useState<{ page: number; n: number } | null>(null);
  const memory = useRef<Partial<Record<Mode, number>>>({});
  const pendingJump = useRef<number | null>(null);

  // The choice is remembered per section.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storeKey(sectionId));
    } catch {}
    setView(saved === "explained" ? "explained" : "original");
    memory.current = {};
  }, [sectionId]);

  const change = useCallback(
    (next: Mode) => {
      if (next === view) return;
      const el = scrollRef.current;
      if (el) memory.current[view] = el.scrollTop;
      setView(next);
      try {
        localStorage.setItem(storeKey(sectionId), next);
      } catch {}
    },
    [view, sectionId],
  );

  const scrollToPage = useCallback(
    (page: number) => {
      const el = scrollRef.current;
      const target = el?.querySelector<HTMLElement>(`[data-page-first="${page}"]`);
      if (!el || !target) return;
      const barH = barRef.current?.offsetHeight ?? 0;
      const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - barH - 20;
      el.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
      setFlash({ page, n: Date.now() });
    },
    [reduced],
  );

  // Called whenever a view finishes mounting: restore scroll, or land on a jump target.
  const onEnter = useCallback(
    (mode: Mode) => {
      const el = scrollRef.current;
      if (!el) return;
      if (mode === "original" && pendingJump.current !== null) {
        const page = pendingJump.current;
        pendingJump.current = null;
        scrollToPage(page);
        return;
      }
      const saved = memory.current[mode];
      const bodyTop = (bodyRef.current?.offsetTop ?? 0) - (barRef.current?.offsetHeight ?? 0);
      if (saved !== undefined) el.scrollTop = saved;
      else if (el.scrollTop > bodyTop) el.scrollTop = bodyTop;
    },
    [scrollToPage],
  );

  const goToPage = useCallback(
    (page: number) => {
      if (view === "original") {
        scrollToPage(page);
      } else {
        const el = scrollRef.current;
        if (el) memory.current.explained = el.scrollTop;
        pendingJump.current = page;
        setView("original");
        try {
          localStorage.setItem(storeKey(sectionId), "original");
        } catch {}
      }
    },
    [view, scrollToPage, sectionId],
  );

  // Citations clicked in the chat jump to the page in Original.
  const lastJump = useRef<number | null>(null);
  useEffect(() => {
    if (!jump || jump.n === lastJump.current) return;
    lastJump.current = jump.n;
    goToPage(jump.page);
  }, [jump, goToPage]);

  // Cmd+K can switch the view too.
  const lastViewCmd = useRef<number | null>(null);
  useEffect(() => {
    if (!viewCmd || viewCmd.n === lastViewCmd.current) return;
    lastViewCmd.current = viewCmd.n;
    change(viewCmd.mode);
  }, [viewCmd, change]);

  return (
    <section className="paper" aria-label={title}>
      <div className="scroll" ref={scrollRef}>
        <div className="reading">
          <header className="head">
            <h1>{title}</h1>
            {hasContent && <p className="subtitle">{section.subtitle}</p>}
            <p className="source">
              {hasContent && (
                <>
                  <span>
                    {section.source}, pp. {section.pages[0]}–{section.pages[1]}
                  </span>
                  <span>about {section.minutes} min</span>
                </>
              )}
              <MasteryMark status={status} withLabel />
            </p>
            <aside className="why" aria-labelledby="why-h">
              <h2 id="why-h">Why this section matters</h2>
              <p>{why}</p>
            </aside>
          </header>

          {hasContent ? (
            <>
              <div className="bar" ref={barRef}>
                <ViewToggle value={view} onChange={change} panelId="reading-panel" />
                <p className="bar-note" aria-live="polite">
                  {view === "original"
                    ? "The exact text from your file."
                    : "In plain English. Every page number jumps to the original."}
                </p>
              </div>
              <div className="body" ref={bodyRef}>
                <AnimatePresence mode="wait" initial={false}>
                  {view === "original" ? (
                    <OriginalView key="original" blocks={original} flash={flash} onEnter={() => onEnter("original")} />
                  ) : (
                    <ExplainedView key="explained" paras={explained} onCite={goToPage} onEnter={() => onEnter("explained")} />
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <div className="empty">
              <p>This section&rsquo;s text isn&rsquo;t in the mockup. The demo has one real section, Federalist No. 10, part 1 of 3.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
