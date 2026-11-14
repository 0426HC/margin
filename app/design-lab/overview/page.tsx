import type { Metadata } from "next";
import { Suspense } from "react";
import "lenis/dist/lenis.css";
import "@/components/cinematic/overview.css";
import { OverviewRoute } from "./OverviewRoute";

export const metadata: Metadata = { title: "Course overview" };

export default function OverviewPage() {
  return (
    <Suspense>
      <OverviewRoute />
    </Suspense>
  );
}
