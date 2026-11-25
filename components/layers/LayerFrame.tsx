"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BackToCourse } from "@/components/shell/BackToCourse";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Workspace } from "@/components/workspace/Workspace";
import { framePeek } from "@/lib/layers/frame-peek";
import { flattenLayers, positionLabel } from "@/lib/layers/order";
import { arrival } from "@/lib/layout/panes";
import { LayerLinks } from "./LayerLinks";
import { LayerList } from "./LayerList";
import { RightPane } from "./RightPane";

const noSubscribe = () => () => {};
const noop = () => {};

/** Quiet bars where text will be. Still: nothing moves inside the workspace while it waits. */
function Lines({
  n,
  className = "m-frame-lines",
}: {
  n: number;
  className?: string;
}) {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          style={{ width: `${[92, 100, 86, 97, 74, 95, 88, 60][i % 8]}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The layer workspace's frame, shown the moment a layer is opened and replaced by the layer once it arrives: the same panes, top bar,
 * layer list, title, big question, tabs and write-back pane, from the course structure the page that opened it already had
 * (`lib/layers/frame-peek.ts`). Opened with nothing known (a fresh tab), the frame is the same with quiet bars for the words. No blank
 * screen in between, in either mode, and the side panes' one settle after the zoom plays here, not again when the layer arrives.
 * Only the layer's own panes wait: the back link (and Escape), the layer list and the course's other rooms work at once.
 */
export function LayerFrame() {
  const peek = useSyncExternalStore(noSubscribe, framePeek, () => null);
  const model = peek?.model ?? null;
  const flat = model ? flattenLayers(model) : [];
  const here = peek ? flat.find((l) => l.id === peek.layerId) : undefined;
  const [arrive] = useState(
    () => peek !== null && arrival.layerId === peek.layerId,
  );
  useEffect(() => {
    if (peek && arrival.layerId === peek.layerId) arrival.layerId = null;
  }, [peek]);

  // The layer's own panes are a picture of what is coming (inert: nothing in them can be focused, clicked or read out); screen readers
  // hear one line. The way out and the way to other layers are real.
  return (
    <div className="m-frame">
      <p className="sr-only" role="status">
        Opening {here?.title ?? "the layer"}…
      </p>
      <div className="m-frame-in">
        <Workspace
          arrive={arrive}
          leftTitle="Layers"
          listName="layer list"
          rightName="write-back pane"
          topbar={
            <>
              {model ? (
                <BackToCourse
                  projectId={model.project.id}
                  course={model.project.name}
                  own="layers"
                />
              ) : (
                <Lines n={1} className="m-frame-lines m-frame-top" />
              )}
              <span
                className="t-label text-panel-muted"
                style={{ marginLeft: "auto" }}
              >
                {here ? positionLabel(flat, here.id) : ""}
              </span>
              <Button variant="quiet" disabled aria-hidden="true" tabIndex={-1}>
                Search <span className="t-label">⌘K</span>
              </Button>
            </>
          }
          left={
            model && peek ? (
              <LayerList model={model} activeId={peek.layerId} />
            ) : (
              <Lines n={6} className="m-frame-lines m-frame-list" />
            )
          }
          leftFooter={model ? <LayerLinks projectId={model.project.id} /> : undefined}
          right={
            <div className="m-frame-wait" inert aria-hidden="true">
              <RightPane
                tab="write"
                onTab={noop}
                writeLabel="Write it back"
                write={<Lines n={4} className="m-frame-lines m-frame-write" />}
                talk={null}
              />
            </div>
          }
        >
          <section
            className="m-paper m-reading-pane"
            aria-label={here?.title ?? "Opening the layer"}
            aria-busy="true"
            inert
            aria-hidden="true"
          >
            <div className="m-scroll">
              <div className="m-reading">
                <header className="m-head">
                  {here ? (
                    <>
                      <p className="m-part-tag">{here.weekLabel}</p>
                      <h1 className="t-h1">{here.title}</h1>
                      <p className="m-subtitle">{here.bigQuestion}</p>
                    </>
                  ) : (
                    <Lines n={3} className="m-frame-lines m-frame-head" />
                  )}
                </header>
                <div className="m-bar">
                  <Segmented
                    label="Show this layer as"
                    idPrefix="layer-frame-view"
                    panelId="layer-frame-panel"
                    value="explained"
                    onChange={noop}
                    options={[
                      { value: "explained", label: "Explained" },
                      { value: "lecture", label: "Lecture" },
                      { value: "source", label: "Source" },
                    ]}
                  />
                  <p className="m-bar-note">Opening the layer…</p>
                </div>
                <div className="m-body" id="layer-frame-panel">
                  <Lines n={8} />
                </div>
              </div>
            </div>
          </section>
        </Workspace>
      </div>
    </div>
  );
}
