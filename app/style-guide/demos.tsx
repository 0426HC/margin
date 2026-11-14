"use client";

import { useState, type ReactNode } from "react";
import { Message } from "@/components/chat/Message";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { CitedText } from "@/components/ui/Citation";
import { Button } from "@/components/ui/Button";
import { MarginGutter } from "@/components/workspace/MarginGutter";
import { ReadingPane } from "@/components/workspace/ReadingPane";
import { SectionList } from "@/components/workspace/SectionList";
import { ViewToggle, type ViewMode } from "@/components/workspace/ViewToggle";
import { Workspace } from "@/components/workspace/Workspace";
import { FILE, sampleChat, sampleExplained, sampleOriginal, sampleSection, sampleUnits, type SampleMessage } from "@/components/demo/sample";

/** The whole page lives on the desk, and the desk can be swapped for the tan one. */
export function ThemeScope({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  return (
    <div data-theme={theme} className="m-desk min-h-dvh">
      <div className="fixed right-4 top-4 z-10">
        <Button variant="secondary" aria-pressed={theme === "light"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Midnight desk" : "Mist desk"}
        </Button>
      </div>
      {children}
    </div>
  );
}

export function ToggleDemo() {
  const [mode, setMode] = useState<ViewMode>("original");
  return (
    <div className="m-paper p-6">
      <ViewToggle value={mode} onChange={setMode} panelId="demo-panel" />
      <div id="demo-panel" role="tabpanel" aria-labelledby={`view-${mode}`} className="t-body mt-4 max-w-prose">
        {mode === "original" ? "The exact text from your file, with page markers in the margin." : "A plain-English walkthrough. Every claim carries a citation that jumps to the page in the Original."}
      </div>
    </div>
  );
}

export function MarginDemo() {
  const [jumped, setJumped] = useState<number | null>(null);
  return (
    <div className="m-paper p-6">
      <div className="m-row" style={{ gridTemplateColumns: "var(--gutter) minmax(0, 52ch)" }}>
        <MarginGutter marks={[{ kind: "page", page: 38 }]} />
        <p className="t-body" style={{ margin: "0 0 1em" }}>
          Page markers sit in the left margin beside the Original: the file&rsquo;s text, exactly as it is.
        </p>
      </div>
      <div className="m-row" style={{ gridTemplateColumns: "var(--gutter) minmax(0, 52ch)" }}>
        <MarginGutter marks={[{ kind: "cite", page: 39, file: FILE, onJump: setJumped }, { kind: "cite", page: 40, file: FILE, onJump: setJumped }]} />
        <p className="t-body" style={{ margin: 0 }}>
          Citations sit in the same margin beside the Explained text. Click one to jump to its page.
        </p>
      </div>
      <p className="t-label mt-4" style={{ color: "var(--ink-muted)" }} aria-live="polite">
        {jumped ? `Would jump to p. ${jumped} in the Original.` : "No citation clicked yet."}
      </p>
    </div>
  );
}

export function ChatDemo() {
  const [items, setItems] = useState<(SampleMessage & { fresh?: boolean })[]>(sampleChat);
  const [pending, setPending] = useState(false);
  const [cited, setCited] = useState<number | null>(null);
  const add = (m: Omit<SampleMessage, "id">) => setItems((c) => [...c, { ...m, id: `n${c.length}`, fresh: true } as SampleMessage & { fresh?: boolean }]);
  const reply = (text: string) => {
    setPending(true);
    window.setTimeout(() => {
      setPending(false);
      add({ kind: "tutor", text });
    }, 600);
  };
  return (
    <div className="grid gap-4" style={{ height: 520, maxWidth: 460 }}>
      <ChatPanel
        title={sampleSection.title}
        pending={pending}
        onAction={(k) => {
          add({ kind: "action", text: k === "quiz" ? "Quiz me" : k === "teach" ? "Teach it back" : k === "connect" ? "Connect it" : `Explain differently: ${k}` });
          reply("In the app this is answered from your files, with a page for every claim. [federalist-papers.pdf, p. 39]");
        }}
        onSend={(text) => {
          add({ kind: "user", text });
          reply("This is a sample reply. [federalist-papers.pdf, p. 38]");
        }}
      >
        {items.map((m) => (
          <Message key={m.id} kind={m.kind} fresh={m.fresh} label={m.kind === "tutor" ? m.label : undefined}>
            {m.kind === "tutor" ? <CitedText text={m.text} onCite={(p) => setCited(p)} /> : m.text}
          </Message>
        ))}
      </ChatPanel>
      <p className="sr-only" aria-live="polite">{cited ? `Source viewer would open at page ${cited}` : ""}</p>
    </div>
  );
}

export function WorkspaceDemo() {
  const [activeId, setActiveId] = useState("no10-1");
  const [mode, setMode] = useState<ViewMode>("original");
  const [flash, setFlash] = useState<number | null>(null);
  const [items, setItems] = useState<SampleMessage[]>(sampleChat);
  const jump = (page: number) => {
    setMode("original");
    setFlash(page);
    window.setTimeout(() => setFlash(null), 2000);
  };
  return (
    <div className="overflow-hidden rounded-[var(--radius)]" style={{ height: 640 }}>
      <Workspace
        left={<SectionList units={sampleUnits} activeId={activeId} onSelect={setActiveId} />}
        leftFooter={
          <>
            <button type="button" className="m-left-link">Review today <span className="m-count">2</span></button>
            <button type="button" className="m-left-link">Notes <span className="m-count">3</span></button>
          </>
        }
        right={
          <ChatPanel title={sampleSection.title} onAction={() => undefined} onSend={(t) => setItems((c) => [...c, { id: `u${c.length}`, kind: "user", text: t }])}>
            {items.map((m) => (
              <Message key={m.id} kind={m.kind} label={m.kind === "tutor" ? m.label : undefined}>
                {m.kind === "tutor" ? <CitedText text={m.text} onCite={jump} /> : m.text}
              </Message>
            ))}
          </ChatPanel>
        }
      >
        <ReadingPane
          {...sampleSection}
          status="shaky"
          mode={mode}
          onModeChange={setMode}
          original={sampleOriginal}
          explained={sampleExplained}
          file={FILE}
          flashPage={flash}
          onCite={jump}
        />
      </Workspace>
    </div>
  );
}
