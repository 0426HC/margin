import { fileKindOf } from "@/lib/import/kinds";
import { isJunkFile } from "@/lib/import/kinds";
import type { PickedFile } from "@/lib/import/pick-files";

/** Browser-side helpers for "Update from folder": fingerprints, reading a remembered folder, and remembering it. */

/** SHA-256 of a file's bytes as hex: the same fingerprint the server keeps. */
export async function hashFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only files Margin can read are compared; the rest are counted so the student is told. */
export function splitReadable(files: PickedFile[]): { readable: PickedFile[]; skipped: number } {
  const readable = files.filter((f) => !isJunkFile(f.file.name) && fileKindOf(f.file.name));
  return { readable, skipped: files.filter((f) => !isJunkFile(f.file.name)).length - readable.length };
}

// ---------------------------------------------------------------- remembering a folder (Chrome and Edge)

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: "read" }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: "read" }) => Promise<PermissionState>;
  values?: () => AsyncIterable<FileSystemHandle>;
};
declare global {
  interface Window {
    showDirectoryPicker?: (o?: { mode?: "read" }) => Promise<DirHandle>;
  }
}

/** The File System Access API exists only in Chromium browsers. Elsewhere the student picks the folder again each time. */
export const canRememberFolder = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function" && typeof indexedDB !== "undefined";

const DB = "margin-folders";
const STORE = "handles";
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const tx = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
};

export const rememberFolder = (projectId: string, handle: FileSystemDirectoryHandle) =>
  tx("readwrite", (s) => s.put(handle, projectId))
    .then(() => undefined)
    .catch(() => undefined);
export const forgetFolder = (projectId: string) =>
  tx("readwrite", (s) => s.delete(projectId))
    .then(() => undefined)
    .catch(() => undefined);
export const rememberedFolder = (projectId: string): Promise<DirHandle | null> =>
  canRememberFolder()
    ? tx<DirHandle | undefined>("readonly", (s) => s.get(projectId))
        .then((h) => h ?? null)
        .catch(() => null)
    : Promise.resolve(null);

/** Let the student choose a folder, keeping the handle so it can be read again later without choosing it. */
export async function pickFolder(): Promise<{ handle: DirHandle; files: PickedFile[] } | null> {
  try {
    const handle = await window.showDirectoryPicker!({ mode: "read" });
    return { handle, files: await readFolder(handle) };
  } catch {
    return null; // the student closed the picker
  }
}

/** Read a remembered folder again. Must be called from a click: the browser asks for permission once per visit. Returns null if it was refused or the folder is gone. */
export async function reopenFolder(handle: DirHandle): Promise<PickedFile[] | null> {
  try {
    const ok = (await handle.queryPermission?.({ mode: "read" })) === "granted" || (await handle.requestPermission?.({ mode: "read" })) === "granted";
    return ok ? await readFolder(handle) : null;
  } catch {
    return null;
  }
}

async function readFolder(root: DirHandle): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const walk = async (dir: DirHandle, prefix: string) => {
    for await (const entry of dir.values!()) {
      if (isJunkFile(entry.name)) continue;
      if (entry.kind === "directory") await walk(entry as DirHandle, `${prefix}${entry.name}/`);
      else out.push({ file: await (entry as FileSystemFileHandle).getFile(), relPath: `${prefix}${entry.name}` });
    }
  };
  await walk(root, `${root.name}/`);
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath, "en", { numeric: true }));
}
