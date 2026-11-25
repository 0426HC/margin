import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { WeeksSection } from "@/components/weeks/WeeksSection";
import { getDb } from "@/lib/db/client";
import { getStructure } from "@/lib/layers/service";
import { weekSummary } from "@/lib/weeks/notes";

export const metadata: Metadata = { title: "Lecture notes" };

async function Weeks({ params, searchParams }: { params: PageProps<"/p/[id]/lecture-notes">["params"]; searchParams: PageProps<"/p/[id]/lecture-notes">["searchParams"] }) {
  await connection();
  const { id } = await params;
  const { at } = await searchParams;
  const db = getDb();
  const model = getStructure(db, id);
  if (!model) notFound();
  if (!model.weeks.some((w) => w.layers.length)) redirect(`/p/${id}/setup`);
  const weeks = weekSummary(db, id);
  // the counter starts at week 1; coming back from a week's page ("All weeks") it starts at that week
  const start = Math.min(weeks.length, Math.max(1, Number(Array.isArray(at) ? at[0] : at) || 1));
  return <WeeksSection key={id} model={model} weeks={weeks} view={{ kind: "all", start }} />;
}

export default function WeeksPage(props: PageProps<"/p/[id]/lecture-notes">) {
  return (
    <div style={{ height: "100dvh" }}>
      <Suspense fallback={<div className="m-desk" style={{ height: "100dvh" }} />}>
        <Weeks params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
