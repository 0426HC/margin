import type { LayerState, ProgressCounts } from "./progress";
import type { ExplainedLayer } from "@/lib/ai/schemas";
import type { SourceQuote } from "@/lib/db/schema";

export interface Range {
  from: number;
  to: number;
}

/** One passage in the project's reading order (units, then sections, then passages). `n` counts from 1. */
export interface OrderedPassage {
  n: number;
  passageId: string;
  sectionId: string;
  unitId: string;
  unit: string;
  file: string;
  fileId?: string;
  category?: string | null;
  /** The heading of the section the passage is in, as the import cut it. */
  section?: string;
  /** Lecture or Reading, from the file's label. */
  role?: "lecture" | "reading";
  page: number;
  text: string;
  words: number;
}

export interface StructureLayer {
  id: string;
  position: number;
  title: string;
  bigQuestion: string;
  buildsOn: string;
  words: number;
  minutes: number;
  passages: number;
  contentStatus: "none" | "writing" | "ready" | "stale";
  /** Files were added to (or taken from) this layer after its tabs were written. */
  newMaterial: boolean;
  /** Where the student is with this layer: not started, in progress, or finished as Approved or Good enough. */
  state: LayerState;
  /** The course weeks its passages' files belong to, sorted; empty when none of them has a week. */
  weeks: number[];
  /** Where the text comes from, for the margin: file and page range. */
  sources: { file: string; pages: string }[];
  /** Made from an optional reading ("Add as optional layer"). */
  optional: boolean;
  /** Optional readings attached to this layer, by file name. */
  extras: string[];
}

/** One week of the course, with its layers in idea order. */
export interface StructureWeek {
  /** The week's row, or null for a week with no layers yet ("Material not added yet"). */
  id: string | null;
  week: number;
  /** "W3". */
  key: string;
  /** The week's topic from the syllabus or its folder ("The Constitution"), or "" when none is stated. */
  title: string;
  /** "Week 3 · The Constitution", or "Week 3". */
  label: string;
  status: "proposed" | "approved";
  /** Whether any of the course's material is in this week yet. */
  hasMaterial: boolean;
  /** Whether the week's layers have a Lecture tab: the week has lecture material or the student's lecture notes. */
  lecture: boolean;
  words: number;
  layers: StructureLayer[];
  progress: ProgressCounts;
  /** Where the week synthesis stands (optional; never counted in progress). */
  synthesis: LayerState;
  /** A short, plain line about what the week covers, built from its layers' big questions. */
  about: string;
}

export interface StructureModel {
  project: { id: string; name: string; courseCode: string | null; status: string; isDemo: boolean };
  /** Every week of the course in order, including weeks whose material hasn't been added yet. */
  weeks: StructureWeek[];
  /** Saved and not saved, over every layer of the course. */
  progress: ProgressCounts;
  /** The first layer not yet done, in course order. Where "Continue" goes. */
  resume: { layerId: string; title: string } | null;
  /** How many weeks the course has. 0 when nothing says yet. */
  weekCount: number;
  /** The week the student is in: the last week whose syllabus date has passed, else the latest week with material. */
  currentWeek: number;
  /** Set when the AI's plan could not be used for a week and a plain split by file stands in. */
  note: string | null;
  /** Optional readings no required material covers: attached to the closest layer, offered as an optional layer of their own. */
  looseOptional: { fileId: string; name: string; layerId: string | null; layerTitle: string | null }[];
}

export interface LayerView {
  id: string;
  projectId: string;
  title: string;
  bigQuestion: string;
  contentStatus: "none" | "writing" | "ready" | "stale";
  newMaterial: boolean;
  week: { week: number; key: string; label: string; status: "proposed" | "approved" };
  previous: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
  content: { explained: ExplainedLayer; source: SourceQuote[]; writtenAt: number } | null;
  /** Optional readings attached to this layer: a few of their passages, copied verbatim by code, labelled Optional in Source. */
  optional: OptionalQuote[];
}

export interface OptionalQuote {
  passageId: string;
  file: string;
  page: number;
  text: string;
}

/** One project on the home page. */
export interface ProjectCard {
  id: string;
  name: string;
  courseCode: string | null;
  isDemo: boolean;
  /** Where the tile opens: the course overview, or the next step of setting it up. */
  href: string;
  ready: boolean;
  /** Setting it up was left part-way: shown as "Draft · not finished" with Continue setup and Discard. */
  draft: boolean;
  /** "Week 3 of 11": the week the student is in, and how many the course has (0 when unknown). */
  currentWeek: number;
  weekCount: number;
  /** Layers saved over the whole course. */
  progress: ProgressCounts;
  /** The line under the progress: where to continue. */
  resume: string;
}
