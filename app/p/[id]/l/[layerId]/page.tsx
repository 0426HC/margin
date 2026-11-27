import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LayerFrame } from "@/components/layers/LayerFrame";
import { LayerWorkspace } from "@/components/layers/LayerWorkspace";
import { getDb } from "@/lib/db/client";
import { focusLayer } from "@/lib/layers/background";
import { getLayer, getStructure } from "@/lib/layers/service";
import { getViewModes } from "@/lib/layers/view-mode";
import { getWeekLecture } from "@/lib/lecture/service";

export const metadata: Metadata = { title: "Layer" };

async function Layer({ params }: { params: PageProps<"/p/[id]/l/[layerId]">["params"] }) {
  await connection();
  const { id, layerId } = await params;
  const db = getDb();
  const layer = getLayer(db, layerId);
  const model = getStructure(db, id);
  if (!layer || !model || layer.projectId !== id) notFound();
  focusLayer(db, layerId); // while this layer is read, the next one in its week is written first
  return <LayerWorkspace key={layer.id} model={model} layer={layer} lecture={getWeekLecture(db, id, layer.week.week)} initialTab={getViewModes(db, id)[layer.id] ?? "explained"} />;
}

export default function LayerPage(props: PageProps<"/p/[id]/l/[layerId]">) {
  return (
    <div style={{ height: "100dvh" }}>
      {/* the workspace's frame (panes, title, tabs) shows the moment the layer is opened; the layer fills it when it arrives */}
      <Suspense fallback={<LayerFrame />}>
        <Layer params={props.params} />
      </Suspense>
    </div>
  );
}
