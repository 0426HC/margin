"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { MarginGutter } from "@/components/workspace/MarginGutter";

const FILE = "federalist-papers.pdf";

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

export function MarginDemo() {
  const [jumped, setJumped] = useState<number | null>(null);
  return (
    <div className="m-paper p-6">
      <div className="m-row" style={{ gridTemplateColumns: "var(--gutter) minmax(0, 52ch)" }}>
        <MarginGutter marks={[{ kind: "page", page: 38 }]} />
        <p className="t-body" style={{ margin: "0 0 1em" }}>
          Page markers sit in the left margin beside the Source: the file&rsquo;s text, exactly as it is.
        </p>
      </div>
      <div className="m-row" style={{ gridTemplateColumns: "var(--gutter) minmax(0, 52ch)" }}>
        <MarginGutter marks={[{ kind: "cite", page: 39, file: FILE, onJump: setJumped }, { kind: "cite", page: 40, file: FILE, onJump: setJumped }]} />
        <p className="t-body" style={{ margin: 0 }}>
          Citations sit in the same margin beside the Explained text. Click one to jump to its page.
        </p>
      </div>
      <p className="t-label mt-4" style={{ color: "var(--ink-muted)" }} aria-live="polite">
        {jumped ? `Would open p. ${jumped} of the original.` : "No citation clicked yet."}
      </p>
    </div>
  );
}

