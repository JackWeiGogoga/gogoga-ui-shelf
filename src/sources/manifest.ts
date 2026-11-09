/**
 * 声明式来源：vault 里的 `<root>/sources/<id>.source.json`，插件同步时自动发现。
 * 通常由 agent 调研站点后写出，三种写法（三选一）：
 *
 * 1. use        —— 站点用的是已支持的格式，直接复用内置适配器
 *    { "use": { "kind": "shadcn", "url": "https://x.dev/r/registry.json" } }
 *
 * 2. index      —— 有可抓的索引（JSON 接口或 sitemap），写字段映射，插件以后能自动发现新组件
 *    { "index": { "url": "...", "items": "data.components", "fields": { "slug": "id", "name": "title" } },
 *      "code": { "kind": "react", "url": "https://x.dev/api/{slug}.json", "files": "files" } }
 *    { "index": { "url": "https://x.dev/sitemap.xml", "format": "sitemap", "match": "/components/([^/]+)/?$" } }
 *
 * 3. components —— 闭源 / 没有接口：直接列清单（可以内联代码），更新要重新调研
 *    { "components": [{ "slug": "fancy-button", "name": "Fancy Button", "page": "...", "tier": "pro" }] }
 *
 * 字段路径用点号（"data.items.0.title"），模板里用 {slug}。
 * 校验在 validateManifest，错误写进同步报告，agent 读报告再改。
 */
import type { ComponentItem, LibraryConfig, LibraryProfile, PreviewSpec, SourceAdapter, SourceKind, SyncContext } from "../types";
import { VOCABULARY, tagOf } from "../core/tags";
import { unresolvedAliases } from "./shadcn";
import { demoProps, pascal, pickExport } from "./util";

const KNOWN_TAGS = new Set(VOCABULARY.map(tagOf));
const knownTag = (t: string) => KNOWN_TAGS.has(t.replace(/^#/, ""));

type FieldName = "slug" | "name" | "description" | "category" | "tier" | "page" | "cover" | "install" | "source" | "frameworks";

interface CodeSpec {
  kind: "html" | "react";
  /** 单个组件代码的 JSON 地址模板；不写就从索引条目本身读 */
  url?: string;
  html?: string;
  css?: string;
  js?: string;
  /** react：文件数组的路径 */
  files?: string;
  path?: string;
  content?: string;
  /** react：入口文件（路径，或匹配路径的正则）；默认第一个 .tsx/.jsx */
  entry?: string;
  /** react：要渲染的导出名；默认按 slug 猜 */
  export?: string;
  /** 需要 Tailwind 时给出库的全局 CSS 地址（没有就写 true） */
  tailwind?: boolean | string;
  /** 官方 demo 的 JSON 地址模板（文件映射同上）；有就渲染 demo，接入信息仍按组件本身 */
  demo?: string;
}

interface StaticComponent {
  slug: string;
  name?: string;
  description?: string;
  category?: string | string[];
  tier?: "free" | "pro";
  page?: string;
  cover?: string;
  install?: string;
  source?: string;
  frameworks?: string[];
  code?: { html?: string; css?: string; js?: string } | { files: { path: string; content: string }[]; entry?: string; export?: string; tailwind?: boolean | string };
}

export interface SourceManifest {
  id: string;
  name: string;
  homepage: string;
  enabled?: boolean;
  profile?: LibraryProfile;
  use?: {
    kind: Exclude<SourceKind, "manifest">;
    url: string;
    /** shadcn：单个条目 JSON 的地址模板（{name}），不写自动探测 */
    itemUrl?: string;
    /** shadcn：只收这些条目类型，如 ["registry:ui"] */
    include?: string[];
  };
  index?: {
    url: string;
    format?: "json" | "sitemap";
    items?: string;
    match?: string;
    fields?: Partial<Record<FieldName, string>>;
    /** tier 字段不是 free/pro 时，用它判断免费：{ "field": "access", "equals": "free" } */
    free?: { field: string; equals: string | number | boolean };
    pageTemplate?: string;
    coverTemplate?: string;
    installTemplate?: string;
    sourceTemplate?: string;
    frameworks?: string[];
    /** 默认 tier（sitemap 抓到的没有 tier 信息） */
    tier?: "free" | "pro";
  };
  code?: CodeSpec;
  components?: StaticComponent[];

  // ── 以下对三种模式都生效（在采集结果上覆盖）
  /** 组件页地址模板，如 "https://x.dev/docs/components/{slug}"（来源只给了首页时用） */
  pageTemplate?: string;
  /** 封面图地址模板 */
  coverTemplate?: string;
  /** 按 slug 调整预览：换入口文件 / 导出名、给演示 props、或干脆不本地渲染（退回官方页面） */
  previews?: Record<string, { entry?: string; export?: string; props?: Record<string, unknown>; skip?: boolean }>;
  /** 按 slug 指定标签（必须是词表里的值）；创建笔记时代替规则标签，已有笔记缺类型标签时补上 */
  tags?: Record<string, string[]>;
  /** 按 slug 指定分类 */
  categories?: Record<string, string[]>;
}

const BUILTIN_KINDS = ["shadcn", "r-index", "transitions"];

/** "a.b.0.c" 取值；空路径返回对象本身 */
export function getPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const fill = (tpl: string | undefined, slug: string) => (tpl ? tpl.replace(/\{slug\}/g, encodeURIComponent(slug)) : "");
const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const titleCase = (slug: string) => pascal(slug).replace(/([a-z0-9])([A-Z])/g, "$1 $2");

/** 校验：返回错误列表（空 = 通过）。错误写成 agent 能直接照着改的句子。 */
export function validateManifest(m: unknown, file: string): string[] {
  const errors: string[] = [];
  const err = (msg: string) => errors.push(`${file}: ${msg}`);
  if (!m || typeof m !== "object") return [`${file}: not a JSON object`];
  const o = m as Record<string, unknown>;
  if (typeof o.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(o.id)) err('"id" must be lowercase letters, digits and dashes, e.g. "magic-ui"');
  if (typeof o.name !== "string" || !o.name) err('"name" is required');
  if (typeof o.homepage !== "string" || !/^https?:\/\//.test(o.homepage)) err('"homepage" must be an http(s) URL');
  const modes = ["use", "index"].filter((k) => o[k] != null);
  if (modes.length > 1) err('"use" and "index" cannot be combined — pick one ("components" may be added to either)');
  if (!modes.length && o.components == null) err('one of "use", "index" or "components" is required');
  if (o.use != null) {
    const u = o.use as Record<string, unknown>;
    if (!BUILTIN_KINDS.includes(String(u.kind))) err(`"use.kind" must be one of ${BUILTIN_KINDS.join(", ")}`);
    if (typeof u.url !== "string") err('"use.url" is required');
  }
  if (o.index != null) {
    const ix = o.index as Record<string, unknown>;
    if (typeof ix.url !== "string") err('"index.url" is required');
    if (ix.format === "sitemap") {
      if (typeof ix.match !== "string") err('"index.match" (a regex with one capture group for the slug) is required for sitemap indexes');
      else {
        try {
          new RegExp(ix.match);
        } catch (e) {
          err(`"index.match" is not a valid regex: ${(e as Error).message}`);
        }
      }
    } else if (ix.format != null && ix.format !== "json") err('"index.format" must be "json" or "sitemap"');
  }
  if (o.code != null) {
    const c = o.code as Record<string, unknown>;
    if (c.kind !== "html" && c.kind !== "react") err('"code.kind" must be "html" or "react"');
    if (c.kind === "react" && typeof c.files !== "string" && !c.url) err('"code.files" (path to the files array) is required for react code');
  }
  if (o.components != null) {
    if (!Array.isArray(o.components)) err('"components" must be an array');
    else
      (o.components as unknown[]).forEach((c, i) => {
        const x = c as Record<string, unknown> | null;
        if (!x || typeof x.slug !== "string" || !x.slug) err(`components[${i}].slug is required`);
      });
  }
  if (o.profile != null && typeof o.profile !== "object") err('"profile" must be an object');
  for (const k of ["previews", "tags", "categories"]) {
    if (o[k] != null && (typeof o[k] !== "object" || Array.isArray(o[k]))) err(`"${k}" must be an object keyed by component slug`);
  }
  if (o.tags && typeof o.tags === "object") {
    for (const [slug, tags] of Object.entries(o.tags as Record<string, unknown>)) {
      if (!Array.isArray(tags)) err(`"tags.${slug}" must be an array`);
      else
        for (const t of tags) {
          if (!knownTag(String(t))) err(`"tags.${slug}": "${String(t)}" is not in the tag vocabulary (see Tag vocabulary.md)`);
        }
    }
  }
  return errors;
}

export function parseManifest(raw: string, file: string): { manifest: SourceManifest | null; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { manifest: null, errors: [`${file}: invalid JSON — ${(e as Error).message}`] };
  }
  const errors = validateManifest(json, file);
  return { manifest: errors.length ? null : (json as SourceManifest), errors };
}

export function manifestToLibrary(m: SourceManifest, file: string): LibraryConfig {
  return {
    id: m.id,
    name: m.name,
    kind: "manifest",
    url: file,
    homepage: m.homepage,
    enabled: m.enabled !== false,
    profile: m.profile,
    fromFile: true,
    manifest: m,
  };
}

function reactSpec(
  files: { path: string; code: string }[],
  slug: string,
  title: string,
  entryHint?: string,
  exportHint?: string,
  tailwindCss?: string,
): PreviewSpec | null {
  const code = files.filter((f) => /\.[jt]sx?$/.test(f.path) || f.path.endsWith(".css"));
  let entry = code.find((f) => /\.[jt]sx$/.test(f.path));
  if (entryHint) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(entryHint);
    } catch {
      re = null;
    }
    entry = code.find((f) => f.path === entryHint) ?? (re ? code.find((f) => re.test(f.path)) : undefined) ?? entry;
  }
  if (!entry) return null;
  const exportName = exportHint ?? pickExport(entry.code, slug);
  if (!exportName) return null;
  return {
    kind: "react",
    files: code.filter((f) => !(tailwindCss != null && f.path.endsWith(".css"))),
    entry: entry.path,
    exportName,
    props: demoProps(entry.code, exportName, title),
    tailwindCss: tailwindCss != null ? [tailwindCss, ...code.filter((f) => f.path.endsWith(".css")).map((f) => f.code)].join("\n\n") : undefined,
  };
}

async function tailwindCssOf(spec: boolean | string | undefined, ctx: SyncContext, cache: Map<string, string>): Promise<string | undefined> {
  if (!spec) return undefined;
  if (spec === true) return "";
  if (!cache.has(spec)) cache.set(spec, await ctx.fetchText(spec).catch(() => ""));
  return cache.get(spec);
}

async function codeFor(
  m: SourceManifest,
  slug: string,
  title: string,
  entry: unknown,
  ctx: SyncContext,
  twCache: Map<string, string>,
): Promise<PreviewSpec | null> {
  const c = m.code;
  if (!c) return null;
  const data = c.url ? await ctx.fetchJson<unknown>(fill(c.url, slug)) : entry;
  if (c.kind === "html") {
    const html = text(getPath(data, c.html ?? "html"));
    if (!html) return null;
    return { kind: "html", html, css: text(getPath(data, c.css ?? "css")), js: text(getPath(data, c.js ?? "js")) };
  }
  const arr = getPath(data, c.files ?? "files");
  if (!Array.isArray(arr)) return null;
  const files = arr
    .map((f) => ({ path: text(getPath(f, c.path ?? "path")), code: text(getPath(f, c.content ?? "content")) }))
    .filter((f) => f.path && f.code);
  // 没声明的依赖（源码 import 了 @/components/ui/x，本地没有）：用同一个 code.url 模板按名字补取
  if (c.url) {
    const seen = new Set<string>([slug]);
    for (let round = 0; round < 3; round++) {
      const missing = unresolvedAliases(files).filter((n) => !seen.has(n));
      if (!missing.length) break;
      for (const name of missing) {
        seen.add(name);
        try {
          const dep = await ctx.fetchJson<unknown>(fill(c.url, name));
          const arr2 = getPath(dep, c.files ?? "files");
          if (!Array.isArray(arr2)) continue;
          for (const f of arr2) {
            const file = { path: text(getPath(f, c.path ?? "path")), code: text(getPath(f, c.content ?? "content")) };
            if (file.path && file.code && !files.some((x) => x.path === file.path)) files.push(file);
          }
        } catch {
          /* 取不到就算了，预览里会报具体缺哪个 */
        }
      }
    }
  }
  const tw = await tailwindCssOf(c.tailwind, ctx, twCache);
  const spec = reactSpec(files, slug, title, c.entry ? c.entry.replace(/\{slug\}/g, slug) : undefined, c.export, tw);
  if (!spec || spec.kind !== "react" || !c.demo) return spec;
  // 官方 demo：取 demo 的文件并入，入口换成 demo，组件本身记在 component 里
  try {
    const d = await ctx.fetchJson<unknown>(fill(c.demo, slug));
    const darr = getPath(d, c.files ?? "files");
    if (!Array.isArray(darr)) return spec;
    const dfiles = darr
      .map((f) => ({ path: text(getPath(f, c.path ?? "path")), code: text(getPath(f, c.content ?? "content")) }))
      .filter((f) => f.path && f.code && /\.[jt]sx?$/.test(f.path));
    const dentry = dfiles.find((f) => /\.[jt]sx$/.test(f.path));
    const dexport = dentry ? pickExport(dentry.code, `${slug}-demo`) : null;
    if (!dentry || !dexport) return spec;
    return {
      ...spec,
      files: [...spec.files, ...dfiles.filter((f) => !spec.files.some((x) => x.path === f.path))],
      entry: dentry.path,
      exportName: dexport,
      props: undefined,
      component: { entry: spec.entry, exportName: spec.exportName },
    };
  } catch {
    return spec; // demo 取不到就渲染组件本身
  }
}

async function collectIndex(m: SourceManifest, ctx: SyncContext): Promise<ComponentItem[]> {
  const ix = m.index;
  if (!ix) return [];
  const f = ix.fields ?? {};
  const twCache = new Map<string, string>();
  let entries: unknown[] = [];
  if (ix.format === "sitemap") {
    const xml = await ctx.fetchText(ix.url);
    const re = new RegExp(ix.match ?? "");
    const seen = new Set<string>();
    for (const loc of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const hit = re.exec(loc[1]);
      if (hit?.[1] && !seen.has(hit[1])) {
        seen.add(hit[1]);
        entries.push({ slug: hit[1], page: loc[1] });
      }
    }
  } else {
    const json = await ctx.fetchJson<unknown>(ix.url);
    const arr = getPath(json, ix.items);
    if (!Array.isArray(arr)) throw new Error(`"index.items" (${ix.items ?? "root"}) is not an array in ${ix.url}`);
    entries = arr;
  }

  const out: ComponentItem[] = [];
  for (const [i, e] of entries.entries()) {
    ctx.progress(`${m.name} ${i + 1}/${entries.length}`);
    const slug = text(getPath(e, f.slug ?? "slug"));
    if (!slug || out.some((o) => o.slug === slug)) continue;
    const name = text(getPath(e, f.name ?? "name")) || titleCase(slug);
    const tierRaw = text(getPath(e, f.tier ?? "tier")).toLowerCase();
    const isFree = ix.free
      ? getPath(e, ix.free.field) === ix.free.equals
      : tierRaw
        ? tierRaw === "free"
        : (ix.tier ?? "free") === "free";
    const cat = getPath(e, f.category ?? "category");
    const fw = getPath(e, f.frameworks ?? "frameworks");
    let preview: PreviewSpec | null = null;
    if (isFree && m.code) {
      try {
        preview = await codeFor(m, slug, name, e, ctx, twCache);
      } catch {
        preview = null; // 单个组件取不到代码：照样入库，预览退回官方页面
      }
    }
    out.push({
      slug,
      name,
      description: text(getPath(e, f.description ?? "description")),
      categories: Array.isArray(cat) ? cat.map(text).filter(Boolean) : text(cat) ? [text(cat)] : [],
      tier: isFree ? "free" : "pro",
      frameworks: Array.isArray(fw) ? fw.map(text) : (ix.frameworks ?? m.profile?.frameworks ?? []),
      page: text(getPath(e, f.page ?? "page")) || fill(ix.pageTemplate, slug) || m.homepage,
      source: text(getPath(e, f.source ?? "source")) || fill(ix.sourceTemplate, slug) || (m.code?.url ? fill(m.code.url, slug) : ""),
      install: text(getPath(e, f.install ?? "install")) || fill(ix.installTemplate, slug),
      cover: text(getPath(e, f.cover ?? "cover")) || fill(ix.coverTemplate, slug),
      preview,
    });
  }
  return out;
}

async function collectStatic(m: SourceManifest, ctx: SyncContext): Promise<ComponentItem[]> {
  const twCache = new Map<string, string>();
  const out: ComponentItem[] = [];
  for (const c of m.components ?? []) {
    const name = c.name ?? titleCase(c.slug);
    let preview: PreviewSpec | null = null;
    if (c.code && c.tier !== "pro") {
      if ("files" in c.code) {
        preview = reactSpec(
          c.code.files.map((f) => ({ path: f.path, code: f.content })),
          c.slug,
          name,
          c.code.entry,
          c.code.export,
          await tailwindCssOf(c.code.tailwind, ctx, twCache),
        );
      } else if (c.code.html) {
        preview = { kind: "html", html: c.code.html, css: c.code.css ?? "", js: c.code.js ?? "" };
      }
    }
    out.push({
      slug: c.slug,
      name,
      description: c.description ?? "",
      categories: Array.isArray(c.category) ? c.category : c.category ? [c.category] : [],
      tier: c.tier ?? "free",
      frameworks: c.frameworks ?? m.profile?.frameworks ?? [],
      page: c.page ?? m.homepage,
      source: c.source ?? "",
      install: c.install ?? "",
      cover: c.cover ?? "",
      preview,
    });
  }
  return out;
}

/** builtin：复用内置适配器（由 sources/index.ts 注入，避免循环引用） */
export function manifestAdapter(builtin: Record<string, SourceAdapter>): SourceAdapter {
  return {
    kind: "manifest",
    async collect(lib: LibraryConfig, ctx: SyncContext): Promise<ComponentItem[]> {
      const m = lib.manifest;
      if (!m) throw new Error(`${lib.url}: source file was not loaded`);
      const items = m.use
        ? await builtin[m.use.kind].collect(
            { ...lib, kind: m.use.kind, url: m.use.url, options: { itemUrl: m.use.itemUrl, include: m.use.include } },
            ctx,
          )
        : m.index
          ? await collectIndex(m, ctx)
          : [];
      // components 可以单独用，也可以补充在 use / index 后面（例如把付费组件手写成元数据）；同 slug 以手写为准
      if (m.components?.length) {
        const extra = await collectStatic(m, ctx);
        for (const x of extra) {
          const at = items.findIndex((i) => i.slug === x.slug);
          if (at >= 0) items[at] = x;
          else items.push(x);
        }
      }
      return items.map((it) => applyOverrides(m, it));
    },
  };
}

/** 来源文件里的覆盖项（三种模式通用） */
export function applyOverrides(m: SourceManifest, item: ComponentItem): ComponentItem {
  const it = { ...item };
  if (m.pageTemplate && (!it.page || it.page === m.homepage)) it.page = fill(m.pageTemplate, it.slug);
  if (m.coverTemplate && !it.cover) it.cover = fill(m.coverTemplate, it.slug);
  const cats = m.categories?.[it.slug];
  if (cats?.length) it.categories = cats;
  const tags = m.tags?.[it.slug];
  if (tags?.length) it.tags = tags.map((t) => t.replace(/^#/, ""));
  const pv = m.previews?.[it.slug];
  if (pv?.skip) it.preview = null;
  else if (pv && it.preview?.kind === "react") {
    const p = { ...it.preview };
    if (pv.entry) {
      const hit = p.files.find((f) => f.path === pv.entry) ?? p.files.find((f) => f.path.endsWith(pv.entry ?? ""));
      if (hit) {
        // 换入口时，原来的入口（若是组件本身）留作接入信息
        p.component ??= p.entry !== hit.path ? { entry: p.entry, exportName: p.exportName } : undefined;
        p.entry = hit.path;
        p.exportName = pv.export ?? pickExport(hit.code, it.slug) ?? p.exportName;
      }
    } else if (pv.export) p.exportName = pv.export;
    if (pv.props) p.props = pv.props;
    it.preview = p;
  }
  return it;
}
