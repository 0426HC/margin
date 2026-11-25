import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LayerPlan } from "@/components/setup/LayerPlan";
import { PageFrame } from "@/components/shell/PageFrame";
import { getDb } from "@/lib/db/client";
import { getStructure } from "@/lib/layers/service";
import { getPlanExtras } from "@/lib/projects/plan-page";
import { SortFiles } from "@/components/setup/SortFiles";
import { DraftWithoutFiles } from "@/components/setup/DraftWithoutFiles";
import * as s from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const metadata: Metadata = { title: "Your course plan" };

async function Setup({ params }: { params: PageProps<"/p/[id]/setup">["params"] }) {
  await connection();
  const { id } = await params;
  const db = getDb();
  const model = getStructure(db, id);
  if (!model) notFound();
  if (model.project.isDemo) redirect(`/p/${id}`); // the demo is read-only, so there is nothing to plan
  if (model.project.status === "importing") {
    // a draft left while its files were still being read: sort what was read into weeks and carry on from there
    const read = db.select({ id: s.files.id }).from(s.files).where(and(eq(s.files.projectId, id), eq(s.files.status, "done"))).all();
    if (!read.length) return <DraftWithoutFiles projectId={id} name={model.project.name} />;
    return (
      <div>
        <h1 className="t-h1">Sorting {model.project.name} into weeks</h1>
        <p className="t-body mt-2 max-w-[62ch] text-panel-muted">Claude is reading the syllabus and the files Margin read. The plan opens here when it&rsquo;s done.</p>
        <SortFiles projectId={id} auto />
      </div>
    );
  }
  if (model.project.status === "reviewing") redirect(`/p/${id}/import`);
  return <LayerPlan model={model} extras={getPlanExtras(db, id)} />;
}

export default function SetupPage(props: PageProps<"/p/[id]/setup">) {
  return (
    <PageFrame crumb="New project">
      <Suspense fallback={<p className="t-ui text-panel-muted">Opening the plan…</p>}>
        <Setup params={props.params} />
      </Suspense>
    </PageFrame>
  );
}
