// The palette as the style guide shows it. Values mirror app/styles/tokens.css; a test keeps them in step.
export type Swatch = { name: string; token: string; hex: string; role: string };

export const desk: Swatch[] = [
  { name: "Midnight", token: "--midnight", hex: "#111827", role: "The desk" },
  { name: "Lamp light", token: "--midnight-hi", hex: "#1f2a48", role: "Top of the desk gradient" },
  { name: "Midnight panel", token: "--midnight-panel", hex: "#161f31", role: "Side panes" },
  { name: "Starlight", token: "--starlight", hex: "#e6ebf5", role: "Text on the desk" },
  { name: "Haze", token: "--haze", hex: "#97a3bd", role: "Quiet text on the desk" },
  { name: "Mist", token: "--mist", hex: "#d3d9e6", role: "The light desk" },
];

export const paper: Swatch[] = [
  { name: "Porcelain", token: "--porcelain", hex: "#edf0f6", role: "The reading sheet" },
  { name: "Porcelain edge", token: "--porcelain-edge", hex: "#f9fafd", role: "Top-edge highlight" },
  { name: "Ink", token: "--ink-navy", hex: "#131b2d", role: "Text on paper" },
  { name: "Muted ink", token: "--ink-navy-muted", hex: "#48536d", role: "Quiet text on paper" },
  { name: "Ink blue", token: "--ink-blue", hex: "#233f8f", role: "The one accent" },
];

export const mastery: Swatch[] = [
  { name: "Plum", token: "--plum", hex: "#d38ae0", role: "Approved, on the desk" },
  { name: "Deep plum", token: "--plum-paper", hex: "#7d2c92", role: "Approved, on paper" },
  { name: "Coral", token: "--coral", hex: "#f07f73", role: "Errors, on the desk" },
  { name: "Brick", token: "--brick", hex: "#a5312a", role: "Errors, on paper" },
];

/** Unit and project accents on the overview and home. No gold, brown, green or red. */
export const unitHues: { name: string; hue: number }[] = [
  { name: "Cyan blue", hue: 196 },
  { name: "Sky", hue: 222 },
  { name: "Ink blue", hue: 236 },
  { name: "Indigo", hue: 250 },
  { name: "Violet", hue: 270 },
  { name: "Plum", hue: 292 },
  { name: "Orchid", hue: 312 },
];

export const agentColours: Swatch[] = [
  { name: "Explainer", token: "--agent-explainer", hex: "#74bde6", role: "Ink drop" },
  { name: "Quizzer", token: "--agent-quizzer", hex: "#e38fb0", role: "Bookmark" },
  { name: "Examiner", token: "--agent-examiner", hex: "#a98bdc", role: "Rubber stamp" },
  { name: "Connector", token: "--agent-connector", hex: "#7f8fe6", role: "Thread capsule" },
  { name: "Librarian", token: "--agent-librarian", hex: "#edf0f6", role: "Book with glasses" },
];

/** The pairs that carry text or marks. Each must clear 4.5:1 for text, 3:1 for marks. */
export const pairs: { label: string; fg: string; bg: string; min: number }[] = [
  { label: "Starlight on midnight", fg: "#e6ebf5", bg: "#111827", min: 4.5 },
  { label: "Starlight on lamp light", fg: "#e6ebf5", bg: "#1f2a48", min: 4.5 },
  { label: "Haze on midnight panel", fg: "#97a3bd", bg: "#161f31", min: 4.5 },
  { label: "Ink on porcelain", fg: "#131b2d", bg: "#edf0f6", min: 4.5 },
  { label: "Muted ink on porcelain", fg: "#48536d", bg: "#edf0f6", min: 4.5 },
  { label: "Ink blue on porcelain", fg: "#233f8f", bg: "#edf0f6", min: 4.5 },
  { label: "Light on ink blue (buttons)", fg: "#f3f6fc", bg: "#233f8f", min: 4.5 },
  { label: "Plum on midnight panel (Approved mark)", fg: "#d38ae0", bg: "#161f31", min: 3 },
  { label: "Deep plum on porcelain (Approved mark)", fg: "#7d2c92", bg: "#edf0f6", min: 3 },
  { label: "Coral on midnight panel (error)", fg: "#f07f73", bg: "#161f31", min: 4.5 },
  { label: "Brick on porcelain (error)", fg: "#a5312a", bg: "#edf0f6", min: 4.5 },
];
