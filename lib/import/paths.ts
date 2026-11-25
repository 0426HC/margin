/** When every path starts with the same folder (the one that was dropped), drop it: it says nothing new. */
export function stripCommonRoot(paths: string[]): string[] {
  const roots = new Set(paths.map((p) => (p.includes("/") ? p.split("/")[0] : "")));
  if (roots.size !== 1 || ![...roots][0]) return paths;
  return paths.map((p) => p.slice(p.indexOf("/") + 1));
}

export const folderOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
