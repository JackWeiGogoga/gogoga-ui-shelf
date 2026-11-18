import { Platform } from "obsidian";

/**
 * Desktop-only helpers: check paths on disk and hand them to VS Code / the file manager.
 * Everything returns quietly on mobile, where none of this exists.
 */
interface Fs { existsSync(p: string): boolean }
interface Shell { showItemInFolder(p: string): void; openExternal(url: string): Promise<void>; openPath(p: string): Promise<string> }

function nodeRequire(id: string): unknown {
  if (!Platform.isDesktopApp) return undefined;
  const r = (window as unknown as { require?: (id: string) => unknown }).require;
  try {
    return r?.(id);
  } catch {
    return undefined;
  }
}

const fs = () => nodeRequire("fs") as Fs | undefined;
const shell = () => (nodeRequire("electron") as { shell?: Shell } | undefined)?.shell;

export const canOpenLocally = () => Platform.isDesktopApp && !!shell();

export function existsOnDisk(path: string): boolean {
  try {
    return !!path && !!fs()?.existsSync(path);
  } catch {
    return false;
  }
}

export const isAbsolutePath = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);

/** Opens a folder or file in VS Code through its URL handler (vscode://file/<path>). */
export function openInVSCode(path: string): void {
  const url = `vscode://file${path.startsWith("/") ? "" : "/"}${encodeURI(path.replace(/\\/g, "/"))}`;
  const s = shell();
  if (s) void s.openExternal(url);
  else window.open(url);
}

/** Shows the file (or folder) selected in Finder / Explorer. */
export function revealInFileManager(path: string): void {
  shell()?.showItemInFolder(path);
}

export const fileManagerName = () => (Platform.isMacOS ? "Finder" : Platform.isWin ? "Explorer" : "Files");
