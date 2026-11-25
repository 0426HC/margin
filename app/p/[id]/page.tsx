import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import "@/components/cinematic/overview.css";
import { OverviewView, type OverviewData } from "@/components/overview/OverviewView";
import { getDb } from "@/lib/db/client";
import { getNoteGuide, getNoteToSelf } from "@/lib/layers/note-to-self";
import { countStates } from "@/lib/layers/progress";
import { writingStatus } from "@/lib/layers/background";
import { getStructure, startedLayers } from "@/lib/layers/service";
import { getTalk } from "@/lib/talk/service";
import { getNotepad } from "@/lib/talk/notepad";
import { getSources } from "@/lib/talk/sources";
import { weekSummary } from "@/lib/weeks/notes";
import { getExamView, listExams } from "@/lib/exam/service";
import { currentWeek } from "@/lib/weeks/current";

export const metadata: Metadata = { title: "Course overview" };

async function Overview({ params }: { params: PageProps<"/p/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const db = getDb();
  const model = getStructure(db, id);
  if (!model) notFound();
  if (model.project.status === "importing") redirect("/new");
  if (model.project.status === "reviewing") redirect(`/p/${id}/import`);
  if (model.project.status === "building" || !model.weeks.some((w) => w.layers.length)) redirect(`/p/${id}/setup`);
  const layers = model.weeks.flatMap((w) => w.layers);
  const started = startedLayers(db, layers.map((l) => l.id));
  const sources = getSources(db, id);
  const talkLog = getTalk(db, id);
  const lastSource = sources.at(-1)?.sources.at(-1) ?? null;
  const weeks = weekSummary(db, id);
  const exams = listExams(db, id);
  const clip = (t: string | null, n: number) => (t === null ? null : t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);
  const writing = writingStatus(db, id);
  const data: OverviewData = {
    project: { id, name: model.project.name, courseCode: model.project.courseCode, isDemo: model.project.isDemo },
    writing,
    weekScenes: model.weeks.map((w) => ({
      id: w.id ?? w.key,
      week: w.week,
      label: `Week ${w.week} of ${model.weekCount}`,
      name: w.label,
      why: w.about,
      layers: w.layers.map((l) => ({ id: l.id, title: l.title, focus: l.bigQuestion, state: l.state, started: started.has(l.id) })),
      read: writing.brain.readWeeks.includes(w.week),
    })),
    progress: countStates(layers.map((l) => l.state)),
    resume: model.resume,
    noted: getNoteToSelf(db, id).reduce((n, p) => n + p.layers.length, 0),
    talk: {
      asked: talkLog.filter((m) => m.role === "user").length,
      sources: sources.reduce((n, g) => n + g.sources.length, 0),
      topics: sources.length,
      noteLines: getNotepad(db, id).blocks.filter((b) => b.text.trim()).length,
      lastChat: clip(talkLog.filter((m) => m.role === "assistant" || m.role === "user").at(-1)?.content ?? null, 150),
      lastSource: lastSource ? { ...lastSource, text: clip(lastSource.text, 150)! } : null,
      noteStart: getNotepad(db, id).blocks.filter((b) => b.text.trim()).slice(0, 3).map((b) => clip(b.text, 70)!),
    },
    weeks,
    exams,
    currentWeek: currentWeek(weeks),
    // only this course's own sheet: a course without one shows an empty desk, never another course's exam
    examSheet: (exams[0] && getExamView(db, exams[0].id)?.summary) || null,
    // the real pages, shown inside the tabs in lock in
    model,
    examView: exams[0] ? getExamView(db, exams[0].id) : null,
    noteGuide: getNoteGuide(db, id)!,
  };
  return <OverviewView data={data} />;
}

export default function ProjectPage(props: PageProps<"/p/[id]">) {
  return (
    <Suspense fallback={<div className="m-desk" style={{ minHeight: "100dvh" }} />}>
      <Overview params={props.params} />
    </Suspense>
  );
}
