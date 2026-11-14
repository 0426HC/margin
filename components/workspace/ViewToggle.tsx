"use client";

import { Segmented } from "@/components/ui/Segmented";

export type ViewMode = "original" | "explained";

const options = [
  { value: "original" as const, label: "Original" },
  { value: "explained" as const, label: "Explained" },
];

/** Original | Explained. The thumb slides; the content below crossfades (see ReadingPane). */
export function ViewToggle({ value, onChange, panelId }: { value: ViewMode; onChange: (m: ViewMode) => void; panelId: string }) {
  return <Segmented options={options} value={value} onChange={onChange} label="Show this section as" idPrefix="view" panelId={panelId} />;
}
