import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import type { OrderedPassage } from "./types";

export const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Every passage of a project in the order the course reads: unit order, then section order, then passage order. */
export function readingOrder(db: Db, projectId: string): OrderedPassage[] {
  return db
    .select({
      passageId: s.passages.id,
      sectionId: s.passages.sectionId,
      unitId: s.units.id,
      unit: s.units.title,
      file: s.files.name,
      fileId: s.files.id,
      category: s.files.category,
      section: s.sections.title,
      fileRole: s.files.role,
      page: s.passages.page,
      text: s.passages.text,
    })
    .from(s.passages)
    .innerJoin(s.sections, eq(s.sections.id, s.passages.sectionId))
    .innerJoin(s.units, eq(s.units.id, s.sections.unitId))
    .innerJoin(s.files, eq(s.files.id, s.passages.fileId))
    .where(eq(s.passages.projectId, projectId))
    .orderBy(asc(s.units.position), asc(s.sections.position), asc(s.passages.ordinal))
    .all()
    .map(({ fileRole, ...p }, i) => ({
      ...p,
      n: i + 1,
      words: wordsOf(p.text),
      role: fileRole === "lecture" ? "lecture" : "reading",
    }));
}

/** Material layers are made of: course files only (the syllabus, optional readings and exam material are read for other things). */
export const isCourseMaterial = (category: string | null | undefined) => category === "course";

/** The course's own material in reading order, numbered from 1. What the plan splits into weeks and layers. */
export function courseOrder(db: Db, projectId: string): OrderedPassage[] {
  return readingOrder(db, projectId)
    .filter((p) => isCourseMaterial(p.category))
    .map((p, i) => ({ ...p, n: i + 1 }));
}
