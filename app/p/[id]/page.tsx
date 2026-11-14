import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import "lenis/dist/lenis.css";
import "@/components/cinematic/overview.css";
import { OverviewView, type OverviewData } from "@/components/overview/OverviewView";
import { getDb } from "@/lib/db/client";
import { getNoteToSelf } from "@/lib/layers/note-to-self";
import { countStates } from "@/lib/layers/progress";
import { getStructure } from "@/lib/layers/service";
import { getTalk } from "@/lib/talk/service";
import { getNotepad } from "@/lib/talk/notepad";
import { getSources } from "@/lib/talk/sources";

export const metadata: Metadata = { title: "Course overview" };

async function Overview({ params }: { params: PageProps<"/p/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const db = getDb();
  const model = getStructure(db, id);
  if (!model) notFound();
  if (model.project.status === "importing") redirect("/new");
  if (model.project.status === "reviewing") redirect(`/p/${id}/import`);
  if (model.project.status === "building" || !model.parts.length) redirect(`/p/${id}/setup`);
  const layers = model.parts.flatMap((p) => p.layers);
  const sources = getSources(db, id);
  const data: OverviewData = {
    project: { id, name: model.project.name, courseCode: model.project.courseCode },
    parts: model.parts.map((p) => ({
      id: p.id,
      label: p.span || p.title,
      name: p.title,
      why: p.about,
      layers: p.layers.map((l) => ({ id: l.id, title: l.title, focus: l.bigQuestion, state: l.state })),
    })),
    progress: countStates(layers.map((l) => l.state)),
    resume: model.resume,
    noted: getNoteToSelf(db, id).reduce((n, p) => n + p.layers.length, 0),
    talk: {
      asked: getTalk(db, id).filter((m) => m.role === "user").length,
      sources: sources.reduce((n, g) => n + g.sources.length, 0),
      topics: sources.length,
      noteLines: getNotepad(db, id).blocks.filter((b) => b.text.trim()).length,
    },
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
