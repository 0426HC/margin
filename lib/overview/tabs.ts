/** The course page's tabs: their order, their names in the address, and the last tab remembered per project. Pure apart from storage. */

export const TABS = [
  { id: "layers", label: "Layers" },
  { id: "talk", label: "Let’s talk!" },
  { id: "lecture-notes", label: "Lecture notes" },
  { id: "exam", label: "Exam room" },
  { id: "note-to-self", label: "Note to Self" },
] as const;

export type CourseTab = (typeof TABS)[number]["id"];
export const DEFAULT_TAB: CourseTab = "layers";

export function parseTab(v: string | string[] | null | undefined): CourseTab | null {
  const s = Array.isArray(v) ? v[0] : v;
  return TABS.some((t) => t.id === s) ? (s as CourseTab) : null;
}

/** The address of one tab. Layers, the default, has a plain address too, but is written out so the back button returns to it. */
export const tabHref = (projectId: string, tab: CourseTab) => `/p/${projectId}?tab=${tab}`;

const key = (projectId: string) => `margin:tab:${projectId}`;

export function rememberedTab(projectId: string): CourseTab | null {
  try {
    return parseTab(window.localStorage.getItem(key(projectId)));
  } catch {
    return null;
  }
}

export function rememberTab(projectId: string, tab: CourseTab) {
  try {
    window.localStorage.setItem(key(projectId), tab);
  } catch {
    // blocked storage: the tab still works, it just isn't remembered
  }
}

// The tab the course page showed last in this window, kept in memory only: a section page opened from inside the app knows which tab
// the student came from; one opened by its address (a reload, a bookmark) does not, and its back link uses that section's own tab.
const shown = new Map<string, CourseTab>();
export const noteShownTab = (projectId: string, tab: CourseTab) => void shown.set(projectId, tab);
export const cameFromTab = (projectId: string): CourseTab | null => shown.get(projectId) ?? null;

/** Where a project card opens: the overview at the tab last used there (or the setup step the card already points to). */
export function openHref(projectId: string, href: string): string {
  if (href !== `/p/${projectId}`) return href;
  const t = rememberedTab(projectId);
  return t && t !== DEFAULT_TAB ? tabHref(projectId, t) : href;
}
