/** A course's name with its code, said once: "POL326 · The Presidency", or just "POL326" when the name is the code. */
export function courseTitle(name: string, code: string | null | undefined): string {
  const n = name.trim();
  const c = code?.trim();
  if (!c) return n;
  if (!n) return c;
  const squash = (t: string) => t.toLowerCase().replace(/[\s_-]+/g, "");
  if (squash(n).includes(squash(c))) return n;
  return `${c} · ${n}`;
}
