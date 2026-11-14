import type { Metadata } from "next";
import "lenis/dist/lenis.css";
import "@/components/cinematic/overview.css";
import "@/components/cinematic/home.css";
import { HomeView } from "./HomeView";

export const metadata: Metadata = { title: "Margin" };

export default function HomePage() {
  return <HomeView />;
}
