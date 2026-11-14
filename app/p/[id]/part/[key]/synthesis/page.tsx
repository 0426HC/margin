import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SynthesisWorkspace } from "@/components/layers/SynthesisWorkspace";
import { getDb } from "@/lib/db/client";
import { getNoteGuide } from "@/lib/layers/note-to-self";
import { getStructure } from "@/lib/layers/service";
import { synthesisQuestion } from "@/lib/layers/writeback";

export const metadata: Metadata = { title: "Part synthesis" };

async function Synthesis({ params }: { params: PageProps<"/p/[id]/part/[key]/synthesis">["params"] }) {
  await connection();
  const { id, key } = await params;
  const db = getDb();
  const model = getStructure(db, id);
  const part = model?.parts.find((p) => p.key === key);
  const guidePart = getNoteGuide(db, id)?.parts.find((p) => p.key === key);
  if (!model || !part || !guidePart) notFound();
  return <SynthesisWorkspace key={part.id} model={model} partId={part.id} question={synthesisQuestion(part.title)} layers={guidePart.layers} />;
}

export default function SynthesisPage(props: PageProps<"/p/[id]/part/[key]/synthesis">) {
  return (
    <div style={{ height: "100dvh" }}>
      <Suspense fallback={<div className="m-desk" style={{ height: "100dvh" }} />}>
        <Synthesis params={props.params} />
      </Suspense>
    </div>
  );
}
