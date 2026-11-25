import { splitCitations } from "@/lib/ai/citations";

/** Page numbers of every citation in a text. */
export const citationsOf = (t: string): number[] => splitCitations(t).flatMap((p) => ("cite" in p ? [p.cite.page] : []));
