import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VoiceLab } from "./VoiceLab";

export const metadata: Metadata = { title: "Voice lab", robots: { index: false } };

// A throwaway experiment to pick a voice by ear. Nothing links here, and it does not exist in a production build.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <VoiceLab />;
}
