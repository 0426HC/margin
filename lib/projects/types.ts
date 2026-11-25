export interface ReviewSection {
  id: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  wordCount: number;
}

export interface ReviewFile {
  id: string;
  name: string;
  relPath: string;
  kind: string | null;
  pageKind: "page" | "slide" | "virtual" | null;
  /** PDFs only: 0 to 1, or null for other kinds. */
  textQuality: number | null;
  lowQuality: boolean;
  sections: ReviewSection[];
}

export interface ReviewUnit {
  id: string;
  title: string;
  isOverview: boolean;
  files: ReviewFile[];
}

export interface ReviewModel {
  project: { id: string; name: string; courseCode: string | null; status: string };
  units: ReviewUnit[];
  /** Files that could not be read, so the review can say so. */
  failed: { id: string; name: string; error: string }[];
}

export interface FileRow {
  id: string;
  name: string;
  relPath: string;
  status: "queued" | "reading" | "done" | "failed";
  error: string | null;
  pageCount: number | null;
  pageKind: "page" | "slide" | "virtual" | null;
}
