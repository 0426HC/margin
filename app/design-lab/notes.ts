// Notes and ( ) questions: the same rule everywhere you can type.
import { useSyncExternalStore } from "react";

export type Note = { id: string; text: string; kind: "note" | "question"; answer?: string };

/** "note to self …" is a note. Text inside ( ) is a question. A note can contain questions. */
export function parseEntry(raw: string): { isNote: boolean; questions: string[] } {
  const text = raw.trim();
  const isNote = /^note to self\b/i.test(text);
  const questions = [...text.matchAll(/\(([^()]+)\)/g)].map((m) => m[1].trim()).filter(Boolean);
  return { isNote, questions };
}

const MOCK_ANSWER =
  "Answered from your files, with page citations, once the AI is connected. This mockup only has canned replies.";

let notes: Note[] = [
  { id: "n1", kind: "note", text: "note to self: compare this with how Hamilton treats faction in No. 9" },
  { id: "n2", kind: "note", text: "note to self: faction can be a majority or a minority" },
  {
    id: "n3",
    kind: "question",
    text: "Is a faction always a majority?",
    answer:
      "No. Madison says “a number of citizens, whether amounting to a majority or a minority of the whole”. [federalist-papers.pdf, p. 39]",
  },
];
let seq = 10;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function saveEntry(raw: string) {
  const { isNote, questions } = parseEntry(raw);
  const added: Note[] = [];
  if (isNote) added.push({ id: `n${seq++}`, kind: "note", text: raw.trim() });
  for (const q of questions) added.push({ id: `n${seq++}`, kind: "question", text: q });
  notes = [...added, ...notes];
  emit();
  for (const a of added.filter((n) => n.kind === "question")) {
    window.setTimeout(() => {
      notes = notes.map((n) => (n.id === a.id ? { ...n, answer: MOCK_ANSWER } : n));
      emit();
    }, 900);
  }
  return { notes: added.filter((n) => n.kind === "note").length, questions: questions.length };
}

export function savedMessage(r: { notes: number; questions: number }) {
  if (r.notes && r.questions) return "Saved to Notes. The question is being answered there.";
  if (r.questions) return "Question saved to Notes. The answer appears under it.";
  return "Saved to Notes.";
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getNotes = () => notes;
export const useNotes = () => useSyncExternalStore(subscribe, getNotes, getNotes);
