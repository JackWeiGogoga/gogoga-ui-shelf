import { getFrontMatterInfo, normalizePath, parseYaml, requestUrl, TFile, type App } from "obsidian";
import { collect } from "../sources";
import type { ComponentItem, ItemState, LibraryConfig, LibraryProfile, SyncContext } from "../types";
import {
  baseFile,
  catalogJson,
  catalogMarkdown,
  componentPath,
  componentZone,
  factFields,
  homeNote,
  libraryPath,
  libraryZone,
  pathsFor,
  replaceZone,
  type CatalogRow,
  type Paths,
} from "./notes";
import { analyze } from "./integration";
import { autoTags, unknownTags, vocabularyMarkdown } from "./tags";

/** 笔记格式版本：改了机器区 / frontmatter 的写法就加一，所有笔记会重写一次 */
const FORMAT = 3;

export interface SyncHost {
  app: App;
  root: string;
  items: Record<string, ItemState>;
  writeCache(lib: string, slug: string, item: ComponentItem): Promise<void>;
  readCache(lib: string, slug: string): Promise<ComponentItem | null>;
  /** 组件代码目录（vault 相对路径） */
  codeDir(lib: string, slug: string): string;
  /** vault 的绝对路径（桌面端），写进 catalog.json 给 agent 拼绝对路径 */
  vaultBase: string;
}

export interface LibResult {
  created: number;
  updated: number;
  total: number;
  free: number;
  withCode: number;
  createdSlugs: string[];
}

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** FNV-1a，只用来判断内容有没有变 */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function makeContext(progress: (m: string) => void): SyncContext {
  return {
    async fetchJson<T>(url: string): Promise<T> {
      const r = await requestUrl({ url, headers: { Accept: "application/json" }, throw: false });
      if (r.status >= 400) throw new Error(`HTTP ${r.status} ${url}`);
      try {
        return r.json as T;
      } catch {
        throw new Error(`Not JSON: ${url}`);
      }
    },
    async fetchText(url: string): Promise<string> {
      const r = await requestUrl({ url, throw: false });
      if (r.status >= 400) throw new Error(`HTTP ${r.status} ${url}`);
      return r.text;
    },
    async exists(url: string): Promise<boolean> {
      try {
        const r = await requestUrl({ url, method: "HEAD", throw: false });
        return r.status < 400;
      } catch {
        return false;
      }
    },
    progress,
  };
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/");
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur).catch(() => undefined);
  }
}

async function writeIfChanged(app: App, path: string, content: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    if ((await app.vault.read(file)) !== content) await app.vault.modify(file, content);
  } else {
    await ensureFolder(app, path.split("/").slice(0, -1).join("/"));
    await app.vault.create(path, content);
  }
}

/** 首页和 .base 只在不存在时创建，之后归用户。 */
async function createOnce(app: App, path: string, content: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  await ensureFolder(app, path.split("/").slice(0, -1).join("/"));
  await app.vault.create(path, content);
}

export async function syncLibrary(host: SyncHost, lib: LibraryConfig, ctx: SyncContext): Promise<LibResult> {
  const { app } = host;
  const p = pathsFor(host.root);
  const items = await collect(lib, ctx);
  const res: LibResult = {
    created: 0,
    updated: 0,
    total: items.length,
    free: items.filter((i) => i.tier === "free").length,
    withCode: items.filter((i) => i.preview).length,
    createdSlugs: [],
  };
  const libLink = libraryPath(p, lib).replace(/\.md$/, "");

  for (const item of items) {
    const key = `${lib.id}/${item.slug}`;
    const h = hash(JSON.stringify([FORMAT, item, lib.name]));
    const integ = analyze(item);
    const codeDir = host.codeDir(lib.id, item.slug);
    const state = host.items[key];
    const existing = state?.path ? app.vault.getAbstractFileByPath(state.path) : null;
    const path = existing instanceof TFile ? existing.path : componentPath(p, lib, item.slug);
    let file = app.vault.getAbstractFileByPath(path);

    if (!state || state.hash !== h || !(file instanceof TFile)) await host.writeCache(lib.id, item.slug, item);

    if (!(file instanceof TFile)) {
      await ensureFolder(app, path.split("/").slice(0, -1).join("/"));
      const created = await app.vault.create(path, `${componentZone(lib, item, libLink, integ, codeDir)}\n`);
      const discovered = state?.discovered ?? today();
      await app.fileManager.processFrontMatter(created, (fm: Record<string, unknown>) => {
        Object.assign(fm, factFields(lib, item, integ, codeDir));
        if (fm.cover === undefined) fm.cover = null;
        fm.discovered = discovered;
        fm.tags = item.tags?.length ? item.tags : autoTags(item);
      });
      host.items[key] = { discovered, hash: h, path };
      res.created++;
      res.createdSlugs.push(item.slug);
      continue;
    }

    if (state && state.hash === h) continue;
    const f = file;
    await app.vault.process(f, (body) => replaceZone(body, componentZone(lib, item, libLink, integ, codeDir)));
    await app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      Object.assign(fm, factFields(lib, item, integ, codeDir));
      if (!fm.discovered) fm.discovered = state?.discovered ?? today();
      if (fm.tags == null) fm.tags = item.tags?.length ? item.tags : autoTags(item);
      // 笔记还没有类型标签（当初规则没匹配上）：用来源文件指定的、或词表更新后的规则补上。
      // 只加不删；用户打过类型标签的笔记不动
      const cur = (Array.isArray(fm.tags) ? fm.tags : []).map((t) => String(t));
      if (!cur.some((t) => t.startsWith("ui/type/"))) {
        const extra = item.tags?.length ? item.tags : autoTags(item);
        if (extra.some((t) => t.startsWith("ui/type/"))) fm.tags = [...new Set([...cur, ...extra])];
      }
    });
    host.items[key] = { discovered: state?.discovered ?? (str(fm(app, f, "discovered")) || today()), hash: h, path: f.path };
    res.updated++;
  }

  // 组件库笔记：frontmatter + 机器区
  const libPath = libraryPath(p, lib);
  const free = items.filter((i) => i.tier === "free").length;
  const profile = await resolveProfile(lib, ctx);
  const existingLib = app.vault.getAbstractFileByPath(libPath);
  let libFile: TFile;
  if (existingLib instanceof TFile) {
    libFile = existingLib;
    await app.vault.process(libFile, (body) => replaceZone(body, libraryZone(lib, p, { total: items.length, free }, profile)));
  } else {
    await ensureFolder(app, p.librariesDir);
    libFile = await app.vault.create(libPath, `${libraryZone(lib, p, { total: items.length, free }, profile)}\n`);
  }
  await app.fileManager.processFrontMatter(libFile, (f: Record<string, unknown>) => {
    Object.assign(f, {
      type: "ui-library",
      name: lib.name,
      library_id: lib.id,
      homepage: lib.homepage,
      source_kind: lib.kind,
      source_url: lib.url,
      license: profile.license ?? "unknown",
      license_url: profile.license_url ?? null,
      pricing: profile.pricing ?? (free === items.length ? "free" : free === 0 ? "paid" : "free + pro"),
      frameworks: profile.frameworks ?? [],
      styling: profile.styling ?? null,
      repo: profile.repo ?? null,
      docs: profile.docs ?? null,
      llms_txt: profile.llms_txt ?? null,
      components: items.length,
      components_free: free,
      synced: today(),
    });
  });
  return res;
}

/**
 * 档案里没写许可证、但给了 GitHub 仓库时，问 GitHub 要 SPDX 标识。
 * 未登录的 API 每小时 60 次，一个库一次，够用；失败就标 unknown。
 */
async function resolveProfile(lib: LibraryConfig, ctx: SyncContext): Promise<LibraryProfile> {
  const profile: LibraryProfile = { ...(lib.profile ?? {}) };
  const gh = /github\.com\/([\w.-]+)\/([\w.-]+)/.exec(profile.repo ?? "");
  if (!profile.license && gh) {
    try {
      const r = await ctx.fetchJson<{ license?: { spdx_id?: string } | null; html_url?: string }>(
        `https://api.github.com/repos/${gh[1]}/${gh[2].replace(/\.git$/, "")}`,
      );
      const spdx = r.license?.spdx_id;
      profile.license = spdx && spdx !== "NOASSERTION" ? spdx : "custom";
      profile.license_url ??= `${r.html_url ?? profile.repo}`;
    } catch {
      profile.license = "unknown";
    }
  }
  return profile;
}

/** frontmatter 里的值只认字符串 / 数字，其余当空 */
function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function fm(app: App, file: TFile, key: string): unknown {
  return app.metadataCache.getFileCache(file)?.frontmatter?.[key];
}

/** 首页、.base、目录、词表。目录里的标签读笔记当前的 frontmatter（用户改过的为准）。 */
export async function writeIndexes(host: SyncHost, libraries: LibraryConfig[]): Promise<{ untagged: string[]; unknown: string[] }> {
  const { app } = host;
  const p: Paths = pathsFor(host.root);
  await ensureFolder(app, p.root);
  await createOnce(app, p.home, homeNote(p));
  await createOnce(app, p.base, baseFile(p));
  await writeIfChanged(app, p.vocabulary, vocabularyMarkdown());

  const rows: CatalogRow[] = [];
  const unknown = new Set<string>();
  const untagged: string[] = [];
  const enabled = new Set(libraries.map((l) => l.id));
  for (const [key, state] of Object.entries(host.items)) {
    if (!enabled.has(key.split("/")[0])) continue;
    const file = app.vault.getAbstractFileByPath(state.path);
    if (!(file instanceof TFile)) continue;
    // 刚写入的笔记 metadataCache 可能还没更新，直接读文件解析
    const info = getFrontMatterInfo(await app.vault.read(file));
    const front = (info.exists ? (parseYaml(info.frontmatter) as Record<string, unknown> | null) : null) ?? {};
    const cached = await host.readCache(key.split("/")[0], key.split("/").slice(1).join("/"));
    const raw = front.tags;
    const tags = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).map((t: unknown) =>
      String(t).replace(/^#/, ""),
    );
    for (const u of unknownTags(tags)) unknown.add(u);
    if (!tags.some((t: string) => t.startsWith("ui/type/"))) untagged.push(key);
    const [libId, ...slugParts] = key.split("/");
    const integ = cached ? analyze(cached) : null;
    rows.push({
      key,
      library: libraries.find((l) => l.id === libId)?.name ?? libId,
      title: str(front.title) || (cached?.name ?? ""),
      note: file.path,
      styling: integ?.styling ?? "none",
      dependencies: integ?.dependencies ?? [],
      requires: integ?.requires ?? [],
      exportName: integ?.exportName ?? null,
      propsRequired: integ?.propsRequired ?? [],
      propsOptional: integ?.propsOptional ?? [],
      usage: integ?.usage ?? "",
      codeDir: cached?.preview ? host.codeDir(libId, slugParts.join("/")) : "",
      codeFiles: integ?.files ?? [],
      cover: str(front.cover),
      tier: str(front.tier) || (cached?.tier ?? ""),
      frameworks: Array.isArray(front.frameworks) ? front.frameworks.map(str) : (cached?.frameworks ?? []),
      tags,
      description: cached?.description ?? "",
      source: str(front.source) || (cached?.source ?? ""),
      install: str(front.install) || (cached?.install ?? ""),
      page: str(front.page) || (cached?.page ?? ""),
    });
  }
  await writeIfChanged(app, p.catalog, catalogMarkdown(rows, today()));
  const libs = await Promise.all(
    libraries.map(async (l) => {
      const file = app.vault.getAbstractFileByPath(libraryPath(p, l));
      const front = file instanceof TFile ? (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) : {};
      return {
        id: l.id,
        name: l.name,
        homepage: l.homepage,
        note: libraryPath(p, l),
        source: { kind: l.kind, url: l.url },
        ...(l.profile ?? {}),
        license: str(front.license) || l.profile?.license || "unknown",
      };
    }),
  );
  await writeIfChanged(app, p.catalogJson, catalogJson(rows, libs, { date: today(), vault: host.vaultBase, root: p.root }));
  return { untagged, unknown: [...unknown] };
}
