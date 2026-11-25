"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { noteBlocksSchema, searchBlocks, type NoteBlock } from "@/lib/talk/notepad";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Blocks to the page's markup: headings, paragraphs, and consecutive bullets as one list. Text is escaped, so nothing stored is ever markup. */
function toHtml(blocks: NoteBlock[]): string {
  if (!blocks.length) return "<p><br></p>";
  let html = "";
  let list = false;
  for (const b of blocks) {
    if (b.type !== "bullet" && list) (html += "</ul>"), (list = false);
    if (b.type === "bullet") {
      if (!list) (html += "<ul>"), (list = true);
      html += `<li>${esc(b.text) || "<br>"}</li>`;
    } else html += b.type === "heading" ? `<h2>${esc(b.text)}</h2>` : `<p>${esc(b.text) || "<br>"}</p>`;
  }
  return html + (list ? "</ul>" : "");
}

const BLOCKS = "h1,h2,h3,h4,h5,h6,ul,ol,p,div";

/**
 * The page's blocks, each with the element it came from. Only structure and text are read; any pasted markup is ignored.
 * The browser may nest a list inside a paragraph while editing, so a paragraph that holds other blocks is read through, not as text.
 */
function readPage(root: HTMLElement): { block: NoteBlock; el: HTMLElement }[] {
  const out: { block: NoteBlock; el: HTMLElement }[] = [];
  const text = (el: HTMLElement) => (el.innerText ?? el.textContent ?? "").replace(/\n+$/, "");
  const walk = (parent: HTMLElement) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent?.trim()) out.push({ block: { type: "paragraph", text: node.textContent }, el: parent });
        continue;
      }
      if (!(node instanceof HTMLElement)) continue;
      if (/^H[1-6]$/.test(node.tagName)) out.push({ block: { type: "heading", text: text(node) }, el: node });
      else if (node.tagName === "UL" || node.tagName === "OL") for (const li of Array.from(node.children)) out.push({ block: { type: "bullet", text: text(li as HTMLElement) }, el: li as HTMLElement });
      else if (node.querySelector(BLOCKS)) walk(node);
      else out.push({ block: { type: "paragraph", text: text(node) }, el: node });
    }
  };
  walk(root);
  return out;
}

type Status = "loading" | "saved" | "saving" | "error";

/**
 * One never-ending page per project, autosaved. Headings and bullets from the buttons; everything else is plain text. A search box
 * highlights matches on the page and lists the lines that contain them.
 */
export function NotepadTab({ projectId, endpoint = `/api/projects/${projectId}/notepad`, name = "Notepad", panelId = "talk-panel-notepad", labelledBy = "talk-tab-notepad" }: { projectId: string; /** Where the page is read and saved. The Let's talk! notepad by default; the lecture notes use one page per week. */ endpoint?: string; name?: string; panelId?: string; labelledBy?: string }) {
  const page = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef(false);
  const [status, setStatus] = useState<Status>("loading");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ index: number; text: string }[]>([]);

  const save = useCallback(
    async (keepalive = false) => {
      if (!page.current || !dirty.current) return;
      const blocks = readPage(page.current).map((x) => x.block);
      if (!noteBlocksSchema.safeParse(blocks).success) return setStatus("error");
      dirty.current = false;
      try {
        const r = await fetch(endpoint, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ blocks }), keepalive });
        if (!r.ok) throw new Error();
        setStatus(dirty.current ? "saving" : "saved");
      } catch {
        dirty.current = true;
        setStatus("error");
      }
    },
    [endpoint],
  );

  useEffect(() => {
    let gone = false;
    void fetch(endpoint, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { blocks: NoteBlock[] }) => {
        if (gone || !page.current) return;
        page.current.innerHTML = toHtml(d.blocks);
        document.execCommand("defaultParagraphSeparator", false, "p");
        setStatus("saved");
      })
      .catch(() => !gone && setStatus("error"));
    const onHide = () => void save(true);
    window.addEventListener("pagehide", onHide);
    const el = page.current;
    return () => {
      gone = true;
      window.removeEventListener("pagehide", onHide);
      clearTimeout(timer.current);
      if (el && dirty.current) void save(true);
    };
  }, [endpoint, save]);

  const highlight = useCallback((q: string) => {
    const root = page.current;
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (typeof CSS !== "undefined" && "highlights" in CSS) {
      CSS.highlights.delete("notepad-search");
      if (root && words.length) {
        const ranges: Range[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const lower = (n.textContent ?? "").toLowerCase();
          for (const w of words) for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + w.length)) {
            const r = new Range();
            r.setStart(n, i);
            r.setEnd(n, i + w.length);
            ranges.push(r);
          }
        }
        CSS.highlights.set("notepad-search", new Highlight(...ranges));
      }
    }
  }, []);

  const research = useCallback(
    (q: string) => {
      setHits(page.current ? searchBlocks(readPage(page.current).map((x) => x.block), q) : []);
      highlight(q);
    },
    [highlight],
  );

  useEffect(() => () => void (typeof CSS !== "undefined" && "highlights" in CSS && CSS.highlights.delete("notepad-search")), []);

  // typing "->" turns it into an arrow, right where the caret is
  const arrows = () => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!sel || !node || node.nodeType !== Node.TEXT_NODE || !page.current?.contains(node)) return;
    const text = node.textContent ?? "";
    const at = sel.anchorOffset;
    if (at < 2 || text.slice(at - 2, at) !== "->") return;
    node.textContent = `${text.slice(0, at - 2)}→${text.slice(at)}`;
    const r = document.createRange();
    r.setStart(node, at - 1);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  };

  const changed = () => {
    arrows();
    dirty.current = true;
    setStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
    if (query.trim()) research(query);
  };

  const format = (cmd: "heading" | "bullet") => {
    page.current?.focus();
    if (cmd === "bullet") document.execCommand("insertUnorderedList");
    else document.execCommand("formatBlock", false, document.queryCommandValue("formatBlock").toLowerCase() === "h2" ? "p" : "h2");
    changed();
  };

  const jump = (index: number) => {
    if (!page.current) return;
    const el = readPage(page.current)[index]?.el;
    el?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    if (el && el !== page.current) {
      el.setAttribute("data-flash", "");
      setTimeout(() => el.removeAttribute("data-flash"), 1200);
    }
  };

  return (
    <div className="m-tt-body m-scroll m-np-body" role="tabpanel" id={panelId} aria-labelledby={labelledBy}>
      <div className="m-np-wrap">
        <div className="m-np-tools">
          <div className="m-np-format" role="group" aria-label="Format">
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => format("heading")}>
              Heading
            </Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => format("bullet")}>
              Bullets
            </Button>
          </div>
          <input
            type="search"
            className="m-input m-np-search"
            aria-label={`Search the ${name.toLowerCase()}`}
            placeholder={`Search the ${name.toLowerCase()}`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              research(e.target.value);
            }}
          />
          <p className="m-np-status" role="status" aria-live="polite">
            {status === "loading" ? "Loading…" : status === "saving" ? "Saving…" : status === "error" ? "Not saved. Check the app is running." : "Saved"}
          </p>
        </div>
        {query.trim() && (
          <div className="m-np-hits" aria-label="Search results">
            <p>{hits.length === 0 ? "No lines contain that." : `${hits.length} ${hits.length === 1 ? "line" : "lines"}`}</p>
            {hits.slice(0, 8).map((h) => (
              <button key={h.index} type="button" onClick={() => jump(h.index)}>
                {h.text || "(empty line)"}
              </button>
            ))}
          </div>
        )}
        <div
          ref={page}
          className="m-np-page"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={name}
          spellCheck
          onInput={changed}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          }}
        />
      </div>
    </div>
  );
}
