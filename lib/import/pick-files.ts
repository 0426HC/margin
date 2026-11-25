import { isJunkFile } from "./kinds";

export interface PickedFile {
  file: File;
  /** Path inside the dropped folder, with the folder's own name first, e.g. "POL101/Week 1/a.pdf". */
  relPath: string;
}

/** From <input webkitdirectory> or <input multiple>. */
export function fromInput(list: FileList | null): PickedFile[] {
  return [...(list ?? [])]
    .filter((f) => !isJunkFile(f.name))
    .map((file) => ({ file, relPath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
}

function readEntry(entry: FileSystemEntry, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    return new Promise((resolve) =>
      (entry as FileSystemFileEntry).file(
        (file) => {
          if (!isJunkFile(file.name)) out.push({ file, relPath: entry.fullPath.replace(/^\//, "") });
          resolve();
        },
        () => resolve(),
      ),
    );
  }
  if (!entry.isDirectory || isJunkFile(entry.name)) return Promise.resolve();
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // readEntries returns at most ~100 entries per call, so keep asking until it is empty
  const next = (): Promise<void> =>
    new Promise<void>((resolve) =>
      reader.readEntries(
        async (batch) => {
          if (!batch.length) return resolve();
          children.push(...batch);
          await next();
          resolve();
        },
        () => resolve(),
      ),
    );
  return next().then(() => Promise.all(children.map((c) => readEntry(c, out))).then(() => undefined));
}

/** From a drop: folders are walked, files are taken as they are. */
export async function fromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const out: PickedFile[] = [];
  if (!entries.length) return fromInput(dt.files);
  await Promise.all(entries.map((e) => readEntry(e, out)));
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath, "en", { numeric: true }));
}

/** A name for the project: the dropped folder's name, if everything sits inside one. */
export function folderName(files: PickedFile[]): string | undefined {
  const roots = new Set(files.map((f) => (f.relPath.includes("/") ? f.relPath.split("/")[0] : "")));
  return roots.size === 1 && [...roots][0] ? [...roots][0] : undefined;
}
