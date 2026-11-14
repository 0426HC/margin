import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { fail } from "./api";

type Where = { projectId?: string; fileId?: string; unitId?: string };

/** The demo's files, units and layers are read-only. This returns the 403 to send if the request would change them, or null if it's fine. */
export function refuseIfDemo(db: Db, where: Where): Response | null {
  let projectId = where.projectId;
  if (!projectId && where.fileId) projectId = db.select({ p: s.files.projectId }).from(s.files).where(eq(s.files.id, where.fileId)).get()?.p;
  if (!projectId && where.unitId) projectId = db.select({ p: s.units.projectId }).from(s.units).where(eq(s.units.id, where.unitId)).get()?.p;
  if (!projectId) return null;
  const isDemo = db.select({ d: s.projects.isDemo }).from(s.projects).where(eq(s.projects.id, projectId)).get()?.d;
  return isDemo ? fail("The demo is read-only. Start a new project to change things.", 403) : null;
}
