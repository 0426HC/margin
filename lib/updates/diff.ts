/** Comparing a folder the student picked with the files a project already has. Pure: paths and hashes in, a verdict per file out. */

export interface StoredFileRef {
  id: string;
  relPath: string;
  /** Null when the file was imported before hashes were kept and its bytes are gone. */
  hash: string | null;
  absent?: boolean;
}
export interface PickedFileRef {
  relPath: string;
  hash: string;
}

export interface FolderDiff {
  /** Picked files the project doesn't have. */
  added: PickedFileRef[];
  /** Picked files at the path of a stored file, with different content. */
  changed: { picked: PickedFileRef; storedId: string }[];
  /** Stored files that are not in the picked folder. */
  removed: StoredFileRef[];
  /** Same path and same content (or a file that was only moved). Skipped. */
  unchanged: number;
}

const withoutFirst = (p: string) => (p.includes("/") ? p.slice(p.indexOf("/") + 1) : p);
/** A path is compared with and without its first folder, because a picked folder is named after itself ("POL101/Week 1/a.pdf") and an earlier import may or may not have kept that name. */
const keysOf = (p: string) => [...new Set([p, withoutFirst(p)])];

export function diffFolder(stored: StoredFileRef[], picked: PickedFileRef[]): FolderDiff {
  const byKey = new Map<string, StoredFileRef>();
  for (const f of stored) for (const k of keysOf(f.relPath)) if (!byKey.has(k)) byKey.set(k, f);

  const matched = new Set<string>();
  const added: PickedFileRef[] = [];
  const changed: FolderDiff["changed"] = [];
  let unchanged = 0;
  for (const p of picked) {
    const hit = keysOf(p.relPath)
      .map((k) => byKey.get(k))
      .find((f) => f && !matched.has(f.id));
    if (!hit) {
      added.push(p);
      continue;
    }
    matched.add(hit.id);
    if (hit.hash === null || hit.hash === p.hash)
      unchanged++; // no hash to compare: the path match stands
    else changed.push({ picked: p, storedId: hit.id });
  }

  // a file that was only moved or renamed has the same bytes: it is the same file, not a new one plus a removed one
  let removed = stored.filter((f) => !matched.has(f.id) && !f.absent);
  const stillAdded: PickedFileRef[] = [];
  for (const a of added) {
    const twin = removed.find((r) => r.hash && r.hash === a.hash);
    if (twin) {
      removed = removed.filter((r) => r !== twin);
      unchanged++;
    } else stillAdded.push(a);
  }
  return { added: stillAdded, changed, removed, unchanged };
}
