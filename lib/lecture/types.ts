/** A slide (or page) of a lecture file that belongs to a layer. `lines` are its text as written, one per line. */
export interface LectureSlide {
  file: string;
  page: number;
  heading: string | null;
  lines: string[];
}

export interface SlideRef {
  file: string;
  page: number;
}

/** Everything the Lecture tab counts, by code: how much time the slides gave to each idea, what repeats, what is flagged, the examples. */
export interface LectureFacts {
  /** The lecture files the numbers come from, with the slides of each that belong to this layer. */
  files: { name: string; slides: number }[];
  slides: number;
  /** Ideas that come back across slides, most slides first: the term and the slides it is on. */
  terms: { term: string; slides: SlideRef[] }[];
  /** The slides with the most on them. */
  longest: { file: string; page: number; title: string; words: number }[];
  /** Phrases that appear on more than one slide. */
  repeated: { phrase: string; slides: SlideRef[] }[];
  /** Lines the slides mark as important, copied as written. */
  flagged: { file: string; page: number; text: string }[];
  /** Lines that introduce an example, copied as written. */
  examples: { file: string; page: number; text: string }[];
}

/** The student's own notes for the weeks a layer draws on, only the lines about this layer, copied as the student wrote them. */
export interface ClassNotes {
  /** Weeks the layer's files belong to. */
  weeksDrawn: number[];
  weeks: { week: number; date: string | null; lines: string[] }[];
  /** Weeks the layer draws on that have no notes at all. */
  empty: number[];
  /** A gentle line where the notes and the slides seem to say different things. Never an assertion that the notes are wrong. */
  checks: string[];
}
