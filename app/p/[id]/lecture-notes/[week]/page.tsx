import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { WeeksSection } from "@/components/weeks/WeeksSection";
import { getDb } from "@/lib/db/client";
import { getStructure } from "@/lib/layers/service";
import { weekSummary } from "@/lib/weeks/notes";

export const metadata: Metadata = { title: "Lecture notes" };

async function WeekPage({ params }: { params: PageProps<"/p/[id]/lecture-notes/[week]">["params"] }) {
  await connection();
  const { id, week } = await params;
  const db = getDb();
  const model = getStructure(db, id);
  if (!model) notFound();
  if (!model.weeks.some((w) => w.layers.length)) redirect(`/p/${id}/setup`);
  const weeks = weekSummary(db, id);
  const n = Number(week);
  if (!Number.isInteger(n) || n < 1 || n > weeks.length) notFound();
  return <WeeksSection key={id} model={model} weeks={weeks} view={{ kind: "week", week: n }} />;
}

export default function Page(props: PageProps<"/p/[id]/lecture-notes/[week]">) {
  return (
    <div style={{ height: "100dvh" }}>
      <Suspense fallback={<div className="m-desk" style={{ height: "100dvh" }} />}>
        <WeekPage params={props.params} />
      </Suspense>
    </div>
  );
}
