import type { Metadata } from "next";
import { ImportFlow } from "@/components/import/ImportFlow";

export const metadata: Metadata = { title: "New project" };

export default function NewProjectPage() {
  return <ImportFlow />;
}
