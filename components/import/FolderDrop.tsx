"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { fromDrop, fromInput, type PickedFile } from "@/lib/import/pick-files";

/** Drop a folder, or choose one. Folders are walked, so the course's own structure comes with the files. */
export function FolderDrop({ onPick, onOver }: { onPick: (files: PickedFile[]) => void; onOver?: (over: boolean) => void }) {
  const folder = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const [over, setOverState] = useState(false);
  const setOver = (v: boolean) => {
    setOverState(v);
    onOver?.(v);
  };

  return (
    <div
      className="m-drop"
      data-over={over ? "" : undefined}
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        onPick(await fromDrop(e.dataTransfer));
      }}
    >
      <h2 className="t-h3">Drop your course folder here</h2>
      <p className="t-ui mt-2 max-w-[52ch] text-panel-muted">
        PDF, Word, PowerPoint, text and Markdown files. They are read on this computer and stay on it.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={() => folder.current?.click()}>
          Choose a folder
        </Button>
        <Button variant="quiet" onClick={() => files.current?.click()}>
          Choose files instead
        </Button>
      </div>
      <input
        ref={folder}
        type="file"
        multiple
        hidden
        data-testid="folder-input"
        aria-label="Choose a folder"
        {...({ webkitdirectory: "" } as object)}
        onChange={(e) => {
          onPick(fromInput(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={files}
        type="file"
        multiple
        hidden
        data-testid="files-input"
        aria-label="Choose files"
        accept=".pdf,.docx,.pptx,.txt,.md,.markdown"
        onChange={(e) => {
          onPick(fromInput(e.target.files));
          e.target.value = "";
        }}
      />
    </div>
  );
}
