import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NoteToSelf } from "@/components/layers/NoteToSelf";
import { getDb } from "@/lib/db/client";
import { getNoteGuide } from "@/lib/layers/note-to-self";

export const metadata: Metadata = { title: "Note to Self" };

async function Notes({ params }: { params: PageProps<"/p/[id]/notes">["params"] }) {
  await connection();
  const { id } = await params;
  const guide = getNoteGuide(getDb(), id);
  if (!guide) notFound();
  return <NoteToSelf guide={guide} />;
}

export default function NotesPage(props: PageProps<"/p/[id]/notes">) {
  return (
    <Suspense fallback={<div className="m-desk min-h-dvh" />}>
      <Notes params={props.params} />
    </Suspense>
  );
}
