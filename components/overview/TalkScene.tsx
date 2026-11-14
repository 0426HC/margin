"use client";

import { motion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";
import { AgentFigure } from "@/components/cinematic/Stage";

export interface TalkSummary {
  /** Questions I have asked. */
  asked: number;
  sources: number;
  topics: number;
  /** Lines on the notepad. */
  noteLines: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Let's talk! scene: beside Part A and Part B, a full screen of its own with one card. The headline settles in as the scene enters;
 * under reduced motion it is the same content on a plain page.
 */
export function TalkScene({ projectId, summary, busy, reduced, sceneRef }: { projectId: string; summary: TalkSummary; busy: boolean; reduced: boolean; sceneRef: (el: HTMLElement | null) => void }) {
  const ref = useRef<HTMLElement | null>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const scale = useTransform(p, [0, 1], [0.9, 1]);
  const rise = useTransform(p, [0.1, 0.9], [48, 0]);
  const fade = useTransform(p, [0, 0.7], [0, 1]);
  const rows = [
    { tab: "chat", name: "Chat", line: summary.asked ? `${plural(summary.asked, "question")} so far, in one conversation` : "One conversation about all your files" },
    { tab: "sources", name: "Sources", line: summary.sources ? `${plural(summary.sources, "passage")} in ${plural(summary.topics, "topic")}` : "Passages the Librarian collects from what you discuss" },
    { tab: "notepad", name: "Notepad", line: summary.noteLines ? `${plural(summary.noteLines, "line")} of your own notes` : "One page for your own notes" },
  ];
  return (
    <section
      className="ov-talk"
      ref={(el) => {
        ref.current = el;
        sceneRef(el);
      }}
      aria-labelledby="ov-talk-h"
    >
      <motion.div className="ov-talk-head" style={reduced ? undefined : { scale, opacity: fade }}>
        <p className="ov-kicker">Beside the Parts</p>
        <h2 id="ov-talk-h" className="ov-title">
          Let&rsquo;s talk!
        </h2>
        <p className="ov-talk-why">Ask your professor about anything in your files, keep the passages behind the answers, and jot your own notes. One conversation for the whole course; the tab inside every layer continues it.</p>
      </motion.div>
      <motion.div className="ov-end ov-talk-card" style={reduced ? undefined : { y: rise, opacity: fade }}>
        <span className="ov-talk-who">
          <AgentFigure id="librarian" size={52} mood={busy ? "busy" : "idle"} />
          <span className="ov-talk-who-line">{busy ? "The Librarian is collecting your sources…" : "The Librarian gathers the sources when you leave."}</span>
        </span>
        <ul className="ov-talk-rows">
          {rows.map((r) => (
            <li key={r.tab}>
              <Link href={`/p/${projectId}/talk?tab=${r.tab}`} className="ov-talk-row">
                <span className="ov-end-title">{r.name}</span>
                <span className="ov-end-line">{r.line}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href={`/p/${projectId}/talk`} className="ov-end-primary">
          Open Let&rsquo;s talk!
        </Link>
      </motion.div>
    </section>
  );
}
