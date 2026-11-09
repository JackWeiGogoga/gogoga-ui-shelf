import type { ComponentItem, LibraryConfig, PreviewSpec, SourceAdapter, SyncContext } from "../types";
import { demoProps, pickExport } from "./util";

/**
 * 「/r 索引」型来源（aicss.dev 的格式，llms.txt 里有说明）：
 *   GET {base}/r            → { components: [{ slug, name, category, tier, registry, page }] }
 *   GET {base}/r/{slug}     → { description, tier, languages, files: [{ language, filename, code }] | null }
 * 付费组件 files 为 null（需要 token），这里不取，只记元数据。
 */

interface IndexEntry {
  slug: string;
  name: string;
  category?: string;
  tier?: string;
  registry?: string;
  page?: string;
}

interface Detail {
  description?: string;
  tier?: string;
  languages?: string[];
  files?: { language: string; filename: string; code: string }[] | null;
}

export const rIndexAdapter: SourceAdapter = {
  kind: "r-index",
  async collect(lib: LibraryConfig, ctx: SyncContext): Promise<ComponentItem[]> {
    const index = await ctx.fetchJson<{ components?: IndexEntry[] }>(lib.url);
    const entries = index.components ?? [];
    const out: ComponentItem[] = [];
    for (const [i, e] of entries.entries()) {
      ctx.progress(`${lib.name} ${i + 1}/${entries.length}`);
      const registry = e.registry ?? `${lib.url.replace(/\/$/, "")}/${e.slug}`;
      const d = await ctx.fetchJson<Detail>(registry);
      const free = (d.tier ?? e.tier) === "free" && Array.isArray(d.files);
      out.push({
        slug: e.slug,
        name: e.name,
        description: d.description ?? "",
        categories: e.category ? [e.category] : [],
        tier: free ? "free" : "pro",
        frameworks: d.languages ?? [],
        page: e.page ?? lib.homepage,
        source: `${registry}?format=md`,
        install: "",
        cover: "",
        preview: free ? reactPreview(d.files ?? [], e.slug, e.name) : null,
      });
    }
    return out;
  },
};

function reactPreview(files: NonNullable<Detail["files"]>, slug: string, title: string): PreviewSpec | null {
  const react = files.filter((f) => f.language === "react");
  const entry = react.find((f) => /\.[jt]sx$/.test(f.filename));
  if (!entry) return null;
  const exportName = pickExport(entry.code, slug);
  if (!exportName) return null;
  return {
    kind: "react",
    files: react.map((f) => ({ path: f.filename, code: f.code })),
    entry: entry.filename,
    exportName,
    props: demoProps(entry.code, exportName, title),
  };
}
