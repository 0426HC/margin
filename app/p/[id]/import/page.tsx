import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReviewSheet } from "@/components/import/ReviewSheet";
import { PageFrame } from "@/components/shell/PageFrame";
import { getDb } from "@/lib/db/client";
import { getStructure } from "@/lib/layers/service";
import { getReview } from "@/lib/projects/service";

export const metadata: Metadata = { title: "Check the units" };

async function Review({ params }: { params: PageProps<"/p/[id]/import">["params"] }) {
  await connection();
  const { id } = await params;
  const review = getReview(getDb(), id);
  if (!review) notFound();
  if (getStructure(getDb(), id)?.project.isDemo) redirect(`/p/${id}`); // the demo is read-only
  if (review.project.status === "importing") redirect(`/p/${id}/setup`);
  return <ReviewSheet review={review} />;
}

export default function ReviewPage(props: PageProps<"/p/[id]/import">) {
  return (
    <PageFrame crumb="New project">
      <Suspense fallback={<p className="t-ui text-panel-muted">Opening the review…</p>}>
        <Review params={props.params} />
      </Suspense>
    </PageFrame>
  );
}
