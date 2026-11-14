// Three candidate palettes for Margin, all cool: no gold, brown, olive or green. Light and dark for each.
// Picked in /design-lab/palette, then applied through app/styles/tokens.css.

export type Theme = {
  desk: string;
  deskHi: string;
  panel: string;
  field: string;
  text: string; // text on the desk
  dim: string; // quiet text on the desk
  paper: string;
  paperEdge: string;
  ink: string;
  inkMuted: string;
  accent: string; // the one accent, on paper
  accentDesk: string; // the same accent, lifted for the desk
  accentOn: string; // text on an accent button
  approved: string; // the Approved / Good enough mark, on the desk
  approvedPaper: string; // the same mark, on paper
  error: string; // errors and "needs work", on the desk
  errorPaper: string;
};

export type Palette = {
  id: string;
  name: string;
  idea: string;
  dark: Theme;
  light: Theme;
  /** Hues for project and unit accents on home and the overview. Never green, red, yellow or brown. */
  unitHues: number[];
  agents: Record<"explainer" | "quizzer" | "examiner" | "connector" | "librarian", string>;
};

const agents = (librarian: string) => ({ explainer: "#74bde6", quizzer: "#e38fb0", examiner: "#a98bdc", connector: "#7f8fe6", librarian });

export const PALETTES: Palette[] = [
  {
    id: "slate",
    name: "Slate and cyan",
    idea: "The charcoal blue of the current Part overview, made the whole product. Paper is a cool grey-white; Approved is a clear cyan.",
    dark: {
      desk: "#1a1e26", deskHi: "#242a35", panel: "#1f242d", field: "#14171d", text: "#e4e8ef", dim: "#9ba4b5",
      paper: "#e9ecf0", paperEdge: "#f6f8fa", ink: "#1b2130", inkMuted: "#4c566a",
      accent: "#2c4a86", accentDesk: "#6d8fd4", accentOn: "#f2f5fa",
      approved: "#5cc2e6", approvedPaper: "#0b6687", error: "#e8776a", errorPaper: "#a3332b",
    },
    light: {
      desk: "#d5dae2", deskHi: "#e0e4ea", panel: "#e1e5eb", field: "#f3f5f8", text: "#1b2130", dim: "#4f596c",
      paper: "#f7f8fa", paperEdge: "#ffffff", ink: "#1b2130", inkMuted: "#4c566a",
      accent: "#2c4a86", accentDesk: "#2c4a86", accentOn: "#f2f5fa",
      approved: "#0b6687", approvedPaper: "#0b6687", error: "#a3332b", errorPaper: "#a3332b",
    },
    unitHues: [200, 214, 228, 248, 266, 290, 318],
    agents: agents("#e9ecf0"),
  },
  {
    id: "graphite",
    name: "Graphite and violet",
    idea: "A neutral graphite desk with no tint at all, paper close to plain white, cobalt ink, and Approved in violet.",
    dark: {
      desk: "#18191c", deskHi: "#222327", panel: "#1e1f23", field: "#121315", text: "#ececec", dim: "#a3a5ab",
      paper: "#ececeb", paperEdge: "#f8f8f7", ink: "#1c1d21", inkMuted: "#56585f",
      accent: "#2346a8", accentDesk: "#7593f0", accentOn: "#f4f6fb",
      approved: "#a58cf5", approvedPaper: "#5a3dc2", error: "#ef7d70", errorPaper: "#a8342c",
    },
    light: {
      desk: "#dcdcdf", deskHi: "#e6e6e8", panel: "#e6e6e8", field: "#f5f5f6", text: "#1c1d21", dim: "#55575e",
      paper: "#fafafa", paperEdge: "#ffffff", ink: "#1c1d21", inkMuted: "#56585f",
      accent: "#2346a8", accentDesk: "#2346a8", accentOn: "#f4f6fb",
      approved: "#5a3dc2", approvedPaper: "#5a3dc2", error: "#a8342c", errorPaper: "#a8342c",
    },
    unitHues: [200, 214, 236, 258, 280, 300, 320],
    agents: agents("#ececeb"),
  },
  {
    id: "midnight",
    name: "Midnight and plum",
    idea: "A deep navy desk, porcelain paper with a faint blue cast, and Approved in plum. The most atmospheric of the three.",
    dark: {
      desk: "#111827", deskHi: "#1a2338", panel: "#161f31", field: "#0c1220", text: "#e6ebf5", dim: "#97a3bd",
      paper: "#edf0f6", paperEdge: "#f9fafd", ink: "#131b2d", inkMuted: "#48536d",
      accent: "#233f8f", accentDesk: "#7896e6", accentOn: "#f3f6fc",
      approved: "#d38ae0", approvedPaper: "#7d2c92", error: "#f07f73", errorPaper: "#a5312a",
    },
    light: {
      desk: "#d3d9e6", deskHi: "#dfe4ee", panel: "#dfe4ee", field: "#f4f6fa", text: "#131b2d", dim: "#4a5570",
      paper: "#f8f9fc", paperEdge: "#ffffff", ink: "#131b2d", inkMuted: "#48536d",
      accent: "#233f8f", accentDesk: "#233f8f", accentOn: "#f3f6fc",
      approved: "#7d2c92", approvedPaper: "#7d2c92", error: "#a5312a", errorPaper: "#a5312a",
    },
    unitHues: [196, 222, 236, 250, 270, 292, 312],
    agents: agents("#edf0f6"),
  },
];

/** The pairs that carry text or marks, per theme: text needs 4.5:1, marks 3:1. */
export function pairsOf(t: Theme): { label: string; fg: string; bg: string; min: number }[] {
  return [
    { label: "Text on desk", fg: t.text, bg: t.desk, min: 4.5 },
    { label: "Quiet text on panel", fg: t.dim, bg: t.panel, min: 4.5 },
    { label: "Ink on paper", fg: t.ink, bg: t.paper, min: 4.5 },
    { label: "Muted ink on paper", fg: t.inkMuted, bg: t.paper, min: 4.5 },
    { label: "Accent on paper", fg: t.accent, bg: t.paper, min: 4.5 },
    { label: "Text on accent button", fg: t.accentOn, bg: t.accent, min: 4.5 },
    { label: "Approved mark on panel", fg: t.approved, bg: t.panel, min: 3 },
    { label: "Approved mark on paper", fg: t.approvedPaper, bg: t.paper, min: 3 },
    { label: "Error on panel", fg: t.error, bg: t.panel, min: 4.5 },
    { label: "Error on paper", fg: t.errorPaper, bg: t.paper, min: 4.5 },
  ];
}
