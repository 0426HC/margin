import type { FileRole } from "@/lib/import/types";
import type { FileType } from "@/lib/projects/file-kinds";
import type { WeekRow } from "@/lib/updates/service";

export type { WeekRow };

/** One new or changed file in the review list. */
export interface ReviewItem {
  key: string;
  file: File;
  relPath: string;
  name: string;
  hash: string;
  group: "new" | "changed";
  /** The stored file a changed file replaces. */
  storedId?: string;
  include: boolean;
  /** What Claude read it as (or the student chose). Null: not labelled yet. */
  type: FileType | null;
  /** The week it goes in, or null. */
  week: number | null;
  /** Claude wasn't sure: shown as "check this". */
  check: boolean;
  /** Why it got its week and type, in plain words. */
  reason: string;
  /** The file could not be read. It is shown, and left out. */
  error?: string;
}

export interface RemovedItem {
  id: string;
  name: string;
  relPath: string;
  week: number | null;
  role: FileRole;
  passages: number;
  layers: number;
  include: boolean;
  keep: boolean;
}

export interface ProposedLayer {
  id: string;
  title: string;
  bigQuestion: string;
  buildsOn: string;
  /** "Week 3 · Congress": the week it would join. */
  week: string;
  weekNumber: number | null;
  /** Made from a lecture file only: shown as "Your Week 3 lecture covers something new". */
  fromLecture: boolean;
  passages: number;
  files: string[];
}
export interface PendingModel {
  unplaced: number;
  proposed: ProposedLayer[];
  layers: { id: string; title: string; week: string }[];
}
export interface CommitSummary {
  committed: {
    added: string[];
    replaced: string[];
    examSheets: { id: string; name: string; kind: string }[];
    removed: number;
    kept: number;
    emptiedLayers: string[];
    deletedLayers: string[];
  };
  placed: { toLayers: { layerId: string; title: string; week: string; files: string[]; passages: number }[]; proposed: ProposedLayer[]; fellBack: boolean };
  pending: PendingModel;
}
