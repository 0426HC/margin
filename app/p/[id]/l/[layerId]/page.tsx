import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LayerWorkspace } from "@/components/layers/LayerWorkspace";
import { getDb } from "@/lib/db/client";
import { getLayer, getStructure } from "@/lib/layers/service";
import { getViewModes } from "@/lib/layers/view-mode";

export const metadata: Metadata = { title: "Layer" };

async function Layer({ params }: { params: PageProps<"/p/[id]/l/[layerId]">["params"] }) {
  await connection();
  const { id, layerId } = await params;
  const db = getDb();
  const layer = getLayer(db, layerId);
  const model = getStructure(db, id);
  if (!layer || !model || layer.projectId !== id) notFound();
  return <LayerWorkspace key={layer.id} model={model} layer={layer} initialTab={getViewModes(db, id)[layer.id] ?? "explained"} />;
}

export default function LayerPage(props: PageProps<"/p/[id]/l/[layerId]">) {
  return (
    <div style={{ height: "100dvh" }}>
      <Suspense fallback={<div className="m-desk" style={{ height: "100dvh" }} />}>
        <Layer params={props.params} />
      </Suspense>
    </div>
  );
}
