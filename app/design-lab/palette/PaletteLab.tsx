"use client";

import { useState } from "react";
import { Body } from "@/components/cinematic/Agents";
import type { AgentId } from "@/components/cinematic/agentState";
import { hsl, rgbCss } from "@/components/cinematic/theme";
import { contrast } from "@/lib/ui/contrast";
import { DeskVariants } from "./DeskVariants";
import { PALETTES, pairsOf, type Palette, type Theme } from "./palettes";

type Mode = "dark" | "light";
type State = "approved" | "good" | "new" | "progress";

function vars(p: Palette, mode: Mode): React.CSSProperties {
  const t: Theme = p[mode];
  const units = p.unitHues.map((h, i) => rgbCss(hsl(h, 0.55, mode === "dark" ? (h > 240 ? 0.66 : 0.6) : 0.42 + (i % 2) * 0.02)));
  const v: Record<string, string> = {
    "--desk": t.desk, "--desk-hi": t.deskHi, "--panel": t.panel, "--field": t.field, "--text": t.text, "--dim": t.dim,
    "--paper": t.paper, "--paper-edge": t.paperEdge, "--ink": t.ink, "--ink-muted": t.inkMuted,
    "--accent": t.accent, "--accent-desk": t.accentDesk, "--accent-on": t.accentOn,
    "--ok": t.approved, "--ok-paper": t.approvedPaper, "--err": t.error, "--err-paper": t.errorPaper,
    "--line": mode === "dark" ? "rgb(255 255 255 / 0.12)" : "rgb(0 0 0 / 0.12)",
    "--line-strong": mode === "dark" ? "rgb(255 255 255 / 0.3)" : "rgb(0 0 0 / 0.28)",
    "--paper-line": "rgb(20 26 40 / 0.14)",
    "--shadow": mode === "dark" ? "0 0 0" : "40 50 70",
  };
  units.forEach((u, i) => (v[`--u${i}`] = u));
  for (const [k, c] of Object.entries(p.agents)) v[`--ag-${k}`] = c;
  return v as React.CSSProperties;
}

const WORD: Record<State, string> = { approved: "Approved", good: "Good enough", new: "Not started", progress: "In progress" };

function Mark({ state, label = false }: { state: State; label?: boolean }) {
  return (
    <span className="pl-mark" data-s={state}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        {state === "approved" && <circle cx="6" cy="6" r="4.6" fill="currentColor" />}
        {state === "good" && <path d="M6 1.4a4.6 4.6 0 0 0 0 9.2z" fill="currentColor" />}
        {state === "progress" && <circle cx="6" cy="6" r="1.4" fill="currentColor" />}
      </svg>
      {label && <span>{WORD[state]}</span>}
    </span>
  );
}

function Agent({ id, size = 22 }: { id: AgentId; size?: number }) {
  return (
    <svg viewBox="0 0 40 46" width={size} height={(size * 46) / 40} style={{ ["--c" as string]: `var(--ag-${id})` }} aria-hidden="true">
      <Body id={id} />
    </svg>
  );
}

function Table() {
  const ids: AgentId[] = ["explainer", "quizzer", "examiner", "connector", "librarian"];
  return (
    <div className="pl-table" aria-hidden="true">
      <span className="pl-table-top" />
      {ids.map((id, i) => {
        const a = ((-90 + i * 72) * Math.PI) / 180;
        return (
          <span key={id} className="pl-seat" style={{ transform: `translate(${Math.cos(a) * 46}px, ${Math.sin(a) * 34}px)` }}>
            <Agent id={id} size={13} />
          </span>
        );
      })}
    </div>
  );
}

function Cells({ states }: { states: State[] }) {
  return (
    <span className="pl-cells" aria-hidden="true">
      {states.map((s, i) => (
        <i key={i} data-s={s} />
      ))}
    </span>
  );
}

function MiniHome() {
  const projects = [
    { code: "POL101", name: "The Federalist Papers", u: 1, states: ["approved", "approved", "good", "new"] as State[], next: "Faction and the large republic" },
    { code: "GOV240", name: "Comparative government", u: 4, states: ["approved", "new", "new", "new", "new"] as State[], next: "Varieties of capitalism" },
    { code: "HIS210", name: "Europe after 1945", u: 6, states: ["new", "new", "new", "new"] as State[], next: "The settlement of 1945" },
  ];
  return (
    <div className="pl-mini pl-desk pl-home">
      <p className="pl-mini-h">Your projects</p>
      <div className="pl-cards">
        {projects.map((p) => (
          <div key={p.code} className="pl-card" style={{ ["--unit" as string]: `var(--u${p.u})` }}>
            <Table />
            <span className="pl-code">{p.code}</span>
            <b className="pl-card-title">{p.name}</b>
            <Cells states={p.states} />
            <span className="pl-continue">Continue: {p.next}</span>
          </div>
        ))}
        <div className="pl-card pl-card-new">
          <b className="pl-card-title">New project</b>
          <span className="pl-continue">Drop a course folder</span>
        </div>
      </div>
    </div>
  );
}

function MiniOverview() {
  const layers: { t: string; s: State }[] = [
    { t: "Why a new constitution", s: "approved" },
    { t: "Faction", s: "good" },
    { t: "The large republic", s: "progress" },
    { t: "Checks and balances", s: "new" },
  ];
  return (
    <div className="pl-mini pl-desk pl-ov" style={{ ["--unit" as string]: "var(--u2)" }}>
      <div className="pl-ov-text">
        <span className="pl-code">Week 1 to Week 6</span>
        <b className="pl-ov-title">Part A</b>
        <Cells states={layers.map((l) => l.s)} />
        <span className="pl-counts">
          <Mark state="approved" /> 1 approved <Mark state="good" /> 1 good enough <Mark state="new" /> 2 not yet
        </span>
      </div>
      <div className="pl-stack">
        {layers.map((l, i) => (
          <div key={l.t} className="pl-sheet-row" style={{ top: `${i * 70}px` }}>
            <span className="pl-iso" />
            <span className="pl-leader" />
            <span className="pl-sheet-label">
              <Mark state={l.s} /> {l.t}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniWorkspace() {
  return (
    <div className="pl-mini pl-desk pl-ws">
      <div className="pl-pane pl-list">
        <span className="pl-code">Part A</span>
        {(
          [
            ["Why a new constitution", "approved"],
            ["Faction", "good"],
            ["The large republic", "progress"],
            ["Checks and balances", "new"],
          ] as [string, State][]
        ).map(([t, s], i) => (
          <span key={t} className="pl-row" data-active={i === 2 ? "" : undefined}>
            <Mark state={s} /> {t}
          </span>
        ))}
        <span className="pl-code pl-list-foot">Note to Self</span>
      </div>
      <div className="pl-read pl-paper">
        <b className="pl-read-title">The large republic</b>
        <span className="pl-read-q">Why does Madison think a bigger country controls faction better?</span>
        <span className="pl-seg">
          <i data-on="">Explained</i>
          <i>Source</i>
        </span>
        <div className="pl-gutter-row">
          <span className="pl-cite">[No. 10, p. 3]</span>
          <span className="pl-text">A faction is a group of citizens, a majority or a minority, united by a shared passion or interest that works against the rights of others.</span>
        </div>
        <div className="pl-gutter-row">
          <span className="pl-cite">[No. 10, p. 5]</span>
          <span className="pl-text">Extend the sphere and you take in a greater variety of parties and interests.</span>
        </div>
      </div>
      <div className="pl-pane pl-chat">
        <span className="pl-code">Write this layer back</span>
        <div className="pl-slip">
          <b>Fixes</b>
          <span className="pl-fix">Name Madison as the author of No. 10.</span>
          <b>So what</b>
          <span className="pl-fix">This is the hinge between faction and the design of the new government.</span>
          <span className="pl-verdict">
            <Mark state="approved" label />
          </span>
        </div>
        <span className="pl-error">Needs work: the second sentence has no subject.</span>
        <span className="pl-btns">
          <i className="pl-btn-accent">Submit</i>
          <i className="pl-btn-quiet">I don&rsquo;t get it</i>
        </span>
      </div>
    </div>
  );
}

function MiniNotes() {
  return (
    <div className="pl-mini pl-desk pl-notes">
      <div className="pl-notes-head">
        <b className="pl-notes-title">Note to Self</b>
        <span className="pl-librarian">
          <Agent id="librarian" size={26} />
        </span>
      </div>
      <div className="pl-tallies">
        <span>
          <b>Part A</b> 2/4 layers done
          <Cells states={["approved", "good", "new", "new"]} />
        </span>
        <span>
          <b>Part B</b> 0/5 layers done
          <Cells states={["new", "new", "new", "new", "new"]} />
        </span>
      </div>
      <div className="pl-paper pl-note-sheet">
        <div className="pl-gutter-row">
          <Mark state="approved" label />
          <span>
            <b className="pl-entry-title">Why a new constitution</b>
            <span className="pl-text">The Articles left Congress unable to tax or enforce, so the states acted alone.</span>
          </span>
        </div>
        <div className="pl-gutter-row">
          <Mark state="good" label />
          <span>
            <b className="pl-entry-title">Faction</b>
            <span className="pl-text">Faction can&rsquo;t be removed without removing liberty, so it has to be controlled.</span>
          </span>
        </div>
        <div className="pl-gutter-row" data-waiting="">
          <Mark state="new" label />
          <span>
            <b className="pl-entry-title">The large republic</b>
            <span className="pl-q">Why does a bigger country control faction better?</span>
            <span className="pl-blank" />
          </span>
        </div>
      </div>
    </div>
  );
}

function Swatches({ p, mode }: { p: Palette; mode: Mode }) {
  const t = p[mode];
  const list: [string, string][] = [
    ["Desk", t.desk],
    ["Panel", t.panel],
    ["Text", t.text],
    ["Quiet text", t.dim],
    ["Paper", t.paper],
    ["Ink", t.ink],
    ["Accent", t.accent],
    ["Approved", t.approved],
    ["Approved, paper", t.approvedPaper],
    ["Error", t.error],
  ];
  return (
    <ul className="pl-swatches">
      {list.map(([n, hex]) => (
        <li key={n}>
          <i style={{ background: hex }} />
          <span>
            {n}
            <code>{hex}</code>
          </span>
        </li>
      ))}
      <li>
        <span className="pl-hues">
          {p.unitHues.map((_, i) => (
            <i key={i} style={{ background: `var(--u${i})` }} />
          ))}
        </span>
        <span>Project accents</span>
      </li>
    </ul>
  );
}

function Contrast({ t }: { t: Theme }) {
  const rows = pairsOf(t).map((r) => ({ ...r, ratio: contrast(r.fg, r.bg) }));
  const fails = rows.filter((r) => r.ratio < r.min);
  return (
    <details className="pl-contrast">
      <summary>{fails.length ? `${fails.length} contrast pair${fails.length === 1 ? "" : "s"} below minimum` : "All text and mark pairs pass contrast"}</summary>
      <ul>
        {rows.map((r) => (
          <li key={r.label} data-fail={r.ratio < r.min ? "" : undefined}>
            <span>{r.label}</span>
            <code>
              {r.ratio.toFixed(1)}:1 (needs {r.min})
            </code>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PaletteLab() {
  const [mode, setMode] = useState<Mode>("dark");
  return (
    <main className="pl">
      <header className="pl-top">
        <div>
          <h1>Palette lab</h1>
          <p>Three cool palettes for Margin, each on the same four screens. No gold, brown, olive or green. Pick one and it goes into the tokens.</p>
        </div>
        <div className="pl-toggle" role="group" aria-label="Theme">
          {(["dark", "light"] as Mode[]).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
      </header>
      <DeskVariants />
      {PALETTES.map((p, i) => (
        <section key={p.id} className="pl-palette" style={vars(p, mode)} aria-labelledby={`pl-${p.id}`}>
          <div className="pl-palette-head">
            <h2 id={`pl-${p.id}`}>
              <span className="pl-letter">{String.fromCharCode(65 + i)}</span> {p.name}
            </h2>
            <p>{p.idea}</p>
          </div>
          <Swatches p={p} mode={mode} />
          <div className="pl-grid">
            <figure>
              <MiniHome />
              <figcaption>Home</figcaption>
            </figure>
            <figure>
              <MiniOverview />
              <figcaption>Part overview</figcaption>
            </figure>
            <figure>
              <MiniWorkspace />
              <figcaption>Layer workspace</figcaption>
            </figure>
            <figure>
              <MiniNotes />
              <figcaption>Note to Self</figcaption>
            </figure>
          </div>
          <Contrast t={p[mode]} />
        </section>
      ))}
    </main>
  );
}
