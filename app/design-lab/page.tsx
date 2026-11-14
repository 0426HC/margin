import type { Metadata } from "next";
import { Workspace } from "./Workspace";

export const metadata: Metadata = { title: "Design lab" };

export default function DesignLabPage() {
  return <Workspace />;
}
