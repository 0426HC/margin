/**
 * What a file is to the course. `type` is what the student sees and changes (and what the AI decides at import); `category` and `role`
 * follow from it and say where the file's text goes: into layers (course material), beside them (optional), or nowhere (the rest).
 * Shared by the server, the AI prompt and the files list.
 *
 * "Lecture material" is anything the professor posts for a lecture, whatever its format (slides, slides with notes underneath, a document
 * of notes and key points): it is course material, so it goes into the week's layers and the layer's Lecture tab. Only "My notes", notes
 * the student wrote, go to the Lecture notes tab.
 */
export const FILE_TYPES = ["reading", "lecture", "my-notes", "syllabus", "exam", "optional"] as const;
export type FileType = (typeof FILE_TYPES)[number];

export const TYPE_LABEL: Record<FileType, string> = {
  reading: "Reading",
  lecture: "Lecture material",
  "my-notes": "My notes",
  syllabus: "Syllabus",
  exam: "Exam material",
  optional: "Optional reading",
};
export const TYPE_CHOICES = FILE_TYPES.map((value) => ({ value, label: TYPE_LABEL[value] }));
/** Course material: what layers are made of, so it always has a week. */
export const COURSE_TYPES: readonly FileType[] = ["reading", "lecture"];

/**
 * Where a file's text goes. `course` files are what layers are made of; a `duplicate` is a second copy of a file (the same bytes) that is
 * used once. A null category is a file not labelled yet (the AI's answer failed): it sits in the files list until the student labels it.
 */
export type FileCategory = "course" | "syllabus" | "exam" | "optional" | "notes" | "duplicate";
export type FileRoleOf = "lecture" | "reading" | "exam" | null;

export function placementOf(type: FileType): { category: FileCategory; role: FileRoleOf } {
  switch (type) {
    case "reading":
      return { category: "course", role: "reading" };
    case "lecture":
      return { category: "course", role: "lecture" };
    case "optional":
      return { category: "optional", role: "reading" };
    case "my-notes":
      return { category: "notes", role: null };
    case "syllabus":
      return { category: "syllabus", role: null };
    case "exam":
      return { category: "exam", role: "exam" };
  }
}

export interface CourseFileRow {
  id: string;
  name: string;
  folder: string;
  week: number | null;
  /** Null when the file has no label yet. */
  type: FileType | null;
  /** The AI wasn't sure: shown as "check this" until the student changes the week or type. */
  check: boolean;
  /** Why the file got its week and type, in plain words. */
  reason: string | null;
}
