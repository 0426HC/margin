/** Which week a unit belongs to, from its title. Pure. */

const WEEKISH = /^(?:week|wk|module|mod|session)\s*0*(\d+)\b/i;

/** The week number a unit title stands for ("Week 3: Checks" is 3), or null when the unit isn't a week. */
export function weekOfUnit(title: string): number | null {
  const m = WEEKISH.exec(title.trim());
  return m ? Number(m[1]) : null;
}
