import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FilesPanel } from "@/components/setup/FilesPanel";
import { WeekCountField } from "@/components/setup/WeekCountField";
import { BackToCourse } from "@/components/shell/BackToCourse";
import { PageFrame } from "@/components/shell/PageFrame";
import { Surface } from "@/components/ui/Surface";
import { getDb } from "@/lib/db/client";
import { getStructure } from "@/lib/layers/service";
import { getPlanExtras } from "@/lib/projects/plan-page";
import { courseTitle } from "@/lib/projects/title";

export const metadata: Metadata = { title: "Files, weeks and types" };

async function Files({ params }: { params: PageProps<"/p/[id]/files">["params"] }) {
  await connection();
  const { id } = await params;
  const db = getDb();
  const model = getStructure(db, id);
  if (!model) notFound();
  if (model.project.isDemo) redirect(`/p/${id}`); // the demo is read-only
  const extras = getPlanExtras(db, id);
  return (
    <div>
      <BackToCourse projectId={id} course={model.project.name} own="layers" />
      <p className="t-label mt-4 text-panel-muted">{courseTitle(model.project.name, model.project.courseCode)}</p>
      <h1 className="t-h1 mt-1">Files, weeks and types</h1>
      <p className="t-body mt-2 max-w-[62ch] text-panel-muted">
        Margin read {extras.summary.charAt(0).toLowerCase() + extras.summary.slice(1)} Change a week or a type here and the layers&rsquo; week labels, the Lecture tab and the Weeks view follow at once.
      </p>
      <Surface kind="paper" raised className="mt-8 px-10 py-7">
        <WeekCountField projectId={id} weekCount={extras.weekCount} />
        <div className="mt-4">
          <FilesPanel projectId={id} files={extras.files} weekCount={extras.weekCount ?? 0} />
        </div>
      </Surface>
    </div>
  );
}

export default function FilesPage(props: PageProps<"/p/[id]/files">) {
  return (
    <PageFrame crumb="Course files">
      <Suspense fallback={<p className="t-ui text-panel-muted">Opening the files…</p>}>
        <Files params={props.params} />
      </Suspense>
    </PageFrame>
  );
}
