import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LayerPlan } from "@/components/setup/LayerPlan";
import { PageFrame } from "@/components/shell/PageFrame";
import { getDb } from "@/lib/db/client";
import { getStructure } from "@/lib/layers/service";

export const metadata: Metadata = { title: "Plan the layers" };

async function Setup({ params }: { params: PageProps<"/p/[id]/setup">["params"] }) {
  await connection();
  const { id } = await params;
  const model = getStructure(getDb(), id);
  if (!model) notFound();
  if (model.project.isDemo) redirect(`/p/${id}`); // the demo is read-only, so there is nothing to plan
  if (model.project.status === "importing") redirect("/new");
  if (model.project.status === "reviewing") redirect(`/p/${id}/import`);
  return <LayerPlan model={model} />;
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
