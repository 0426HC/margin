import { desc } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getStructure } from "./service";
import type { ProjectCard } from "./types";

/** The projects on the home page: where each opens, its progress by Part, and where to continue. */
export function listProjectCards(db: Db): ProjectCard[] {
  const rows = db.select().from(s.projects).orderBy(desc(s.projects.createdAt)).all().filter((p) => p.status !== "importing");
  return rows.map((p) => {
    const model = getStructure(db, p.id);
    const ready = p.status === "ready" && !!model?.parts.length;
    const step = p.status === "reviewing" ? `/p/${p.id}/import` : `/p/${p.id}/setup`;
    return {
      id: p.id,
      name: p.name,
      courseCode: p.courseCode,
      isDemo: p.isDemo,
      href: ready ? `/p/${p.id}` : step,
      ready,
      parts: (model?.parts ?? []).map((x) => ({ key: x.key, progress: x.progress })),
      resume: ready ? (model?.resume?.title ?? "Everything is finished. Open the overview to review it.") : p.status === "reviewing" ? "Check the units" : "Plan the layers",
    };
  });
}
