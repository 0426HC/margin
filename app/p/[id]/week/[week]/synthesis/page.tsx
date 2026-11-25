import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SynthesisWorkspace } from "@/components/layers/SynthesisWorkspace";
import { getDb } from "@/lib/db/client";
import { getNoteGuide } from "@/lib/layers/note-to-self";
import { getStructure } from "@/lib/layers/service";
import { synthesisQuestion } from "@/lib/layers/writeback";

export const metadata: Metadata = { title: "Week synthesis" };

async function Synthesis({ params }: { params: PageProps<"/p/[id]/week/[week]/synthesis">["params"] }) {
  await connection();
  const { id, week: n } = await params;
  const db = getDb();
  const model = getStructure(db, id);
  const week = model?.weeks.find((w) => w.week === Number(n) && w.id);
  const guideWeek = getNoteGuide(db, id)?.weeks.find((w) => w.week === Number(n));
  if (!model || !week?.id || !guideWeek) notFound();
  return <SynthesisWorkspace key={week.id} model={model} weekId={week.id} question={synthesisQuestion(week.label)} layers={guideWeek.layers} />;
}

/** The optional synthesis of one week: its layers' titles and questions (with what the student saved), and a write box reviewed like a layer. */
export default function SynthesisPage(props: PageProps<"/p/[id]/week/[week]/synthesis">) {
  return (
    <div style={{ height: "100dvh" }}>
      <Suspense fallback={<div className="m-desk" style={{ height: "100dvh" }} />}>
        <Synthesis params={props.params} />
      </Suspense>
    </div>
  );
}
