"use client";

import { useSearchParams } from "next/navigation";
import { OverviewView } from "./OverviewView";

/** Reads `?project=` so each course opens with its own look. Must sit inside a Suspense boundary. */
export function OverviewRoute() {
  return <OverviewView projectId={useSearchParams().get("project") ?? undefined} />;
}
