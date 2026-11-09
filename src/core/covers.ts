import { normalizePath, TFile, type App } from "obsidian";
import { buildSrcdoc } from "../preview/build";
import type { ComponentItem } from "../types";
import { pathsFor, safeName } from "./notes";

/**
 * 没有官方封面的组件：在后台把预览渲染出来，截成 webp 存进 vault，写进 frontmatter 的 cover。
 * 文件放在 <root>/covers/<lib>/<slug>.webp，cover 写成 [[链接]]，Bases 卡片能直接显示。
 *
 * iframe 不能 display:none 或放到视口外——Chrome 会暂停不可见的跨源 iframe 的渲染，
 * 动画和 ResizeObserver 都不跑。所以放在视口里、透明、垫在界面下面。
 */

const WIDTH = 480;
const MAX_HEIGHT = 480;
/** 等组件把入场动画、逐字输出这些跑完再截 */
const SETTLE_MS = 2600;
const TIMEOUT_MS = 20000;

export interface CoverJob {
  lib: string;
  slug: string;
  path: string;
  item: ComponentItem;
}

export interface CoverHost {
  app: App;
  root: string;
}

export function coverPath(root: string, lib: string, slug: string): string {
  return normalizePath(`${pathsFor(root).root}/covers/${safeName(lib)}/${safeName(slug)}.webp`);
}

/** 笔记还没有封面、又能本地渲染的组件；force 时连我们生成过的也重做 */
export function needsCover(
  app: App,
  at: { root: string; lib: string; slug: string; path: string },
  item: ComponentItem | null,
  force: boolean,
): boolean {
  if (!item?.preview) return false;
  if (item.cover) return false; // 来源自带封面（transitions）
  const file = app.vault.getAbstractFileByPath(at.path);
  if (!(file instanceof TFile)) return false;
  const cover: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.cover;
  if (cover == null || cover === "") return true;
  // 重新生成只动我们自己生成的那张；用户换成自己的图就不碰
  return force && cover === `[[${coverPath(at.root, at.lib, at.slug)}]]`;
}

function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  let cur = "";
  for (const part of path.split("/")) {
    cur = cur ? `${cur}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur).catch(() => undefined);
  }
}

/** 渲染一个组件并截图，返回 webp 的 data URL。 */
function capture(item: ComponentItem): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!item.preview) {
      reject(new Error("no preview"));
      return;
    }
    const host = document.body.createDiv({ cls: "ui-shelf-cover-stage" });
    const frame = host.createEl("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.width = `${WIDTH}px`;
    frame.style.height = `${MAX_HEIGHT}px`;
    let height = 0;
    let failed = "";
    const done = (err: Error | null, data?: string) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      host.remove();
      if (err) reject(err);
      else resolve(data ?? "");
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      const d = e.data as { uiShelf?: string; height?: number; data?: string; error?: string; message?: string } | null;
      if (d?.uiShelf === "height" && typeof d.height === "number") height = d.height;
      if (d?.uiShelf === "error") failed = d.message ?? "render error";
      if (d?.uiShelf === "cover") {
        if (d.data) done(null, d.data);
        else done(new Error(d.error ?? "capture failed"));
      }
    };
    const timer = window.setTimeout(() => done(new Error("timed out")), TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    frame.addEventListener("load", () => {
      window.setTimeout(() => {
        if (failed) {
          done(new Error(failed));
          return;
        }
        frame.contentWindow?.postMessage(
          { uiShelf: "capture", width: WIDTH, height: Math.max(MAX_HEIGHT, height), background: "#ffffff" },
          "*",
        );
      }, SETTLE_MS);
    });
    frame.srcdoc = buildSrcdoc(item.preview, { theme: "light", background: "#ffffff", capture: true });
  });
}

/**
 * 只渲染、不截图：等组件跑一会儿，看有没有报错（编译失败、依赖加载失败、运行时异常）。
 * 返回错误信息，没问题返回 null。给「检查预览」和同步报告用。
 */
export function checkPreview(item: ComponentItem): Promise<string | null> {
  return new Promise((resolve) => {
    if (!item.preview) {
      resolve(null);
      return;
    }
    const host = document.body.createDiv({ cls: "ui-shelf-cover-stage" });
    const frame = host.createEl("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.width = `${WIDTH}px`;
    frame.style.height = `${MAX_HEIGHT}px`;
    let failed: string | null = null;
    let height = 0;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      const d = e.data as { uiShelf?: string; message?: string; height?: number } | null;
      if (d?.uiShelf === "error") failed ??= d.message ?? "render error";
      if (d?.uiShelf === "height" && typeof d.height === "number") height = d.height;
    };
    window.addEventListener("message", onMessage);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(guard);
      window.removeEventListener("message", onMessage);
      host.remove();
      // 没报错但什么都没画出来（高度只有 body 的留白）也算问题
      resolve(failed ?? (height > 0 && height < 60 ? "rendered nothing visible" : null));
    };
    frame.addEventListener("load", () => window.setTimeout(finish, SETTLE_MS));
    // 有的组件让 iframe 一直不触发 load（死循环、卡住的资源）：到时间就算失败，别让整轮检查挂住
    const guard = window.setTimeout(() => {
      failed ??= `timed out after ${TIMEOUT_MS / 1000}s (the component may loop forever or wait on a resource)`;
      finish();
    }, TIMEOUT_MS);
    try {
      frame.srcdoc = buildSrcdoc(item.preview, { theme: "light", background: "#ffffff" });
    } catch (e) {
      window.removeEventListener("message", onMessage);
      host.remove();
      resolve(`build failed: ${(e as Error).message}`);
    }
  });
}

export interface CoverResult {
  made: number;
  failed: { key: string; error: string }[];
}

export async function generateCovers(
  host: CoverHost,
  jobs: CoverJob[],
  progress: (done: number, total: number, current: string) => void,
  cancelled: () => boolean = () => false,
): Promise<CoverResult> {
  const { app } = host;
  const res: CoverResult = { made: 0, failed: [] };
  for (const [i, job] of jobs.entries()) {
    if (cancelled()) break;
    const key = `${job.lib}/${job.slug}`;
    progress(i, jobs.length, key);
    try {
      const data = await capture(job.item);
      const out = coverPath(host.root, job.lib, job.slug);
      await ensureFolder(app, out.split("/").slice(0, -1).join("/"));
      const existing = app.vault.getAbstractFileByPath(out);
      if (existing instanceof TFile) await app.vault.modifyBinary(existing, dataUrlToBuffer(data));
      else await app.vault.createBinary(out, dataUrlToBuffer(data));
      const note = app.vault.getAbstractFileByPath(job.path);
      if (note instanceof TFile) {
        await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
          fm.cover = `[[${out}]]`;
        });
      }
      res.made++;
    } catch (e) {
      res.failed.push({ key, error: (e as Error).message });
    }
  }
  progress(jobs.length, jobs.length, "");
  return res;
}
