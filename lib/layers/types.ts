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
  /** Where the student is with this layer: not started, in progress, or finished as Approved or Good enough. */
  state: LayerState;
  /** Where the text comes from, for the margin: file and page range. */
  sources: { file: string; pages: string }[];
  warnings: string[];
}

export interface StructurePart {
  id: string;
  key: "A" | "B";
  title: string;
  status: "proposed" | "approved";
  /** "Week 1 to Week 3": the first and last unit this Part draws on. */
  span: string;
  words: number;
  layers: StructureLayer[];
  warnings: string[];
  progress: ProgressCounts;
  /** Where the Part synthesis stands. Counted separately from the layers. */
  synthesis: LayerState;
  /** A short, plain line about what the Part covers, built from its layers' big questions. */
  about: string;
}

export interface StructureModel {
  project: { id: string; name: string; courseCode: string | null; status: string; isDemo: boolean };
  parts: StructurePart[];
  /** The first layer not yet done, in course order. Where "Continue" goes. */
  resume: { layerId: string; title: string } | null;
  /** Set when the AI's plan could not be used for a Part and a plain split by unit stands in. */
  note: string | null;
}

export interface LayerView {
  id: string;
  projectId: string;
  title: string;
  bigQuestion: string;
  contentStatus: "none" | "writing" | "ready" | "stale";
  part: { key: "A" | "B"; status: "proposed" | "approved" };
  previous: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
  content: { explained: ExplainedLayer; source: SourceQuote[]; writtenAt: number } | null;
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
  parts: { key: "A" | "B"; progress: ProgressCounts }[];
  /** The line under the progress: where to continue. */
  resume: string;
}
