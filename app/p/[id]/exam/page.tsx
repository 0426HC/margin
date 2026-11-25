import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ExamSection } from "@/components/exam/ExamSection";
import { getDb } from "@/lib/db/client";
import { getExamView, listExams } from "@/lib/exam/service";
import { getStructure } from "@/lib/layers/service";

export const metadata: Metadata = { title: "Exam room" };

async function Exam({ params, searchParams }: { params: PageProps<"/p/[id]/exam">["params"]; searchParams: PageProps<"/p/[id]/exam">["searchParams"] }) {
  await connection();
  const { id } = await params;
  const { e } = await searchParams;
  const db = getDb();
  const model = getStructure(db, id);
  if (!model) notFound();
  if (!model.weeks.some((w) => w.layers.length)) redirect(`/p/${id}/setup`);
  const exams = listExams(db, id);
  const wanted = Array.isArray(e) ? e[0] : e;
  const pick = exams.find((x) => x.id === wanted) ?? exams[0];
  return <ExamSection key={`${id}:${pick?.id ?? "none"}`} model={model} exams={exams} view={pick ? getExamView(db, pick.id) : null} isDemo={model.project.isDemo} />;
}

export default function ExamPage(props: PageProps<"/p/[id]/exam">) {
  return (
    <div style={{ height: "100dvh" }}>
      <Suspense fallback={<div className="m-desk" style={{ height: "100dvh" }} />}>
        <Exam params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
