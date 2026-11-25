import { desc } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as s from "@/lib/db/schema";
import { getStructure } from "./service";
import type { ProjectCard } from "./types";

/** The projects on the home page: where each opens, the week it is in, its progress, and where to continue. */
export function listProjectCards(db: Db): ProjectCard[] {
  const rows = db.select().from(s.projects).orderBy(desc(s.projects.createdAt)).all();
  return rows.map((p) => {
    const model = getStructure(db, p.id);
    const ready = p.status === "ready" && !!model?.weeks.some((w) => w.layers.length);
    // anything not ready is a draft left part-way through setting up; Continue setup picks it up where it stopped
    const step = `/p/${p.id}/setup`;
    return {
      id: p.id,
      name: p.name,
      courseCode: p.courseCode,
      isDemo: p.isDemo,
      href: ready ? `/p/${p.id}` : step,
      ready,
      draft: !ready && !p.isDemo,
      currentWeek: model?.currentWeek ?? 1,
      weekCount: model?.weekCount ?? 0,
      progress: model?.progress ?? { total: 0, saved: 0, notSaved: 0 },
      resume: ready ? (model?.resume?.title ?? "Everything is finished. Open the overview to review it.") : "Plan the layers",
    };
  });
}
