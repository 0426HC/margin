"use client";

import Link from "next/link";
import { LaptopArt } from "@/components/art/LaptopArt";
import { StoryScene } from "./StoryScene";

export interface TalkSummary {
  /** Questions I have asked. */
  asked: number;
  sources: number;
  topics: number;
  /** Lines on the notepad. */
  noteLines: number;
  /** Quiet previews for the three tabs; null or empty when there is nothing yet. */
  lastChat: string | null;
  lastSource: { text: string; file: string; page: number } | null;
  noteStart: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The Let's talk! scene: one conversation with your professor for the whole course, shown on a laptop open on the real page. */
export function TalkScene({ projectId, course, summary, busy, reduced, sceneRef, enter }: { projectId: string; course: string; summary: TalkSummary; busy: boolean; reduced: boolean; sceneRef: (el: HTMLElement | null) => void; enter?: boolean }) {
  const status = busy
    ? "The Librarian is collecting your sources…"
    : summary.asked || summary.sources || summary.noteLines
      ? `${plural(summary.asked, "question")} · ${plural(summary.sources, "source")} · ${plural(summary.noteLines, "notepad line")}`
      : "Nothing asked yet";
  return (
    <StoryScene
      id="ov-talk"
      eyebrow="Beside the weeks"
      title="Let’s talk!"
      why="Ask your professor about anything in your files, and keep the passages behind every answer."
      status={status}
      action={
        <Link href={`/p/${projectId}/talk`} className="ov-end-primary">
          Open Let&rsquo;s talk!
        </Link>
      }
      art={<LaptopArt course={course} />}
      reduced={reduced}
      sceneRef={sceneRef}
      enter={enter}
    />
  );
}
