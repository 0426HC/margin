"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export type MessageKind = "tutor" | "user" | "action" | "saved";

/**
 * One chat message. Tutor answers are slips of paper; yours are ink; actions and saves are quiet
 * labels. A new message arrives with a short fade and a few px of rise; `fresh={false}` skips it
 * (history that was already there).
 */
export function Message({ kind, label, fresh = false, children }: { kind: MessageKind; label?: string; fresh?: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const arrive = fresh
    ? { initial: { opacity: 0, y: reduced ? 0 : 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: reduced ? 0.1 : 0.2, ease: [0.23, 1, 0.32, 1] as const } }
    : { initial: false as const };
  return (
    <motion.div className={`m-msg ${kind === "tutor" ? "m-slip" : ""}`} data-kind={kind} {...arrive}>
      {kind === "tutor" && label && <span className="m-msg-label">{label}</span>}
      <p>{children}</p>
    </motion.div>
  );
}
