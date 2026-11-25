import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import "lenis/dist/lenis.css";
import "@/components/cinematic/overview.css";
import "@/components/cinematic/home.css";
import { HomeView } from "@/components/home/HomeView";
import { getDb } from "@/lib/db/client";
import { listProjectCards } from "@/lib/layers/home";

export const metadata: Metadata = { title: "Margin" };

async function Home() {
  await connection();
  const projects = listProjectCards(getDb());
  // The demo is offered until it has been opened once.
  return <HomeView projects={projects} showDemoOffer={!projects.some((p) => p.isDemo)} />;
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="m-desk" style={{ minHeight: "100dvh" }} />}>
      <Home />
    </Suspense>
  );
}
