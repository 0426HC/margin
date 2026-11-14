"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileHit } from "@/lib/layers/search";
import type { StructureModel } from "@/lib/layers/types";

type Item = { id: string; group: string; title: string; sub?: string; href: string | null };

/**
 * Cmd+K: jump to a layer, open Note to Self, or search the files. A small optional extra: nothing depends on it,
 * and nothing in it animates.
 */
export function CommandBar({ model, onClose }: { model: StructureModel; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<FileHit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const projectId = model.project.id;

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/projects/${projectId}/search?q=${encodeURIComponent(text)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d: { hits: FileHit[] }) => setHits(d.hits))
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, projectId]);

  const shownHits = q.trim().length < 2 ? [] : hits;
  const items = useMemo<Item[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (text: string) => words.every((w) => text.toLowerCase().includes(w));
    const layers = model.parts.flatMap((p) =>
      p.layers.filter((l) => match(`${l.title} ${l.bigQuestion} ${p.title}`)).map((l): Item => ({ id: `l:${l.id}`, group: "Layers", title: l.title, sub: `${p.title} · ${l.bigQuestion}`, href: `/p/${projectId}/l/${l.id}` })),
    );
    const note: Item[] = match("note to self study guide") ? [{ id: "note", group: "Go to", title: "Note to Self", sub: "Your final writing, by Part and layer", href: `/p/${projectId}/notes` }] : [];
    const files = shownHits.map((h, i): Item => ({ id: `h:${i}`, group: "In your files", title: `${h.file}, p. ${h.page}`, sub: `${h.layerTitle ? `${h.layerTitle}: ` : ""}${h.snippet}`, href: h.layerId ? `/p/${projectId}/l/${h.layerId}` : null }));
    return [...note, ...layers.slice(0, 12), ...files];
  }, [q, model, shownHits, projectId]);

  const go = (item: Item | undefined) => {
    if (!item?.href) return;
    onClose();
    router.push(item.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    }
  };

  useEffect(() => {
    document.getElementById(`cmd-item-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastGroup = "";
  return (
    <div className="m-cmd-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m-cmd" role="dialog" aria-modal="true" aria-label="Command bar" onKeyDown={onKey}>
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="cmd-list"
          aria-activedescendant={items[active] ? `cmd-item-${active}` : undefined}
          aria-label="Jump to a layer or search your files"
          placeholder="Jump to a layer, or search your files"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
        />
        {items.length ? (
          <ul id="cmd-list" role="listbox" aria-label="Results">
            {items.map((it, i) => {
              const heading = it.group !== lastGroup;
              lastGroup = it.group;
              return (
                <li key={it.id} role="presentation">
                  {heading && <p className="m-cmd-group">{it.group}</p>}
                  <button id={`cmd-item-${i}`} type="button" role="option" aria-selected={i === active} tabIndex={-1} disabled={!it.href} onMouseMove={() => setActive(i)} onClick={() => go(it)}>
                    <span>{it.title}</span>
                    {it.sub && <span className="m-cmd-sub">{it.sub}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-cmd-empty">{q.trim().length < 2 ? "Type to find a layer." : "Nothing matches. Try a word from the text."}</p>
        )}
      </div>
    </div>
  );
}
