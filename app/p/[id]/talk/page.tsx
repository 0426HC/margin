import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { TalkSection, type TalkTab } from "@/components/talk/TalkSection";
import { getDb } from "@/lib/db/client";
import { getStructure } from "@/lib/layers/service";

export const metadata: Metadata = { title: "Let’s talk!" };

async function Talk({ params, searchParams }: { params: PageProps<"/p/[id]/talk">["params"]; searchParams: PageProps<"/p/[id]/talk">["searchParams"] }) {
  await connection();
  const { id } = await params;
  const { tab } = await searchParams;
  const model = getStructure(getDb(), id);
  if (!model) notFound();
  if (!model.parts.length) redirect(`/p/${id}/setup`);
  const initial: TalkTab = tab === "sources" || tab === "notepad" ? tab : "chat";
  return <TalkSection key={id} model={model} initialTab={initial} />;
}

export default function TalkPage(props: PageProps<"/p/[id]/talk">) {
  return (
    <div style={{ height: "100dvh" }}>
      <Suspense fallback={<div className="m-desk" style={{ height: "100dvh" }} />}>
        <Talk params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
