import type { ComponentItem, LibraryConfig, SourceAdapter, SyncContext } from "../types";

/**
 * transitions.dev：仓库里的 assets/community/library.json 是网站「Library」页的数据，
 * 每条带现成的 html / css / js 片段；library-pro.json 是付费条目，只有标题和描述。
 * lib.url 指向 library.json 所在目录（raw.githubusercontent.com 或站点本身都行）。
 */

interface Entry {
  slug: string;
  title: string;
  desc?: string;
  cat?: string;
  html?: string;
  css?: string;
  js?: string;
}

const CATEGORY: Record<string, string> = {
  ai: "AI",
  effects: "Effects",
  essential: "Essential",
  texts: "Texts",
};

export const transitionsAdapter: SourceAdapter = {
  kind: "transitions",
  async collect(lib: LibraryConfig, ctx: SyncContext): Promise<ComponentItem[]> {
    const base = lib.url.replace(/\/$/, "");
    const site = lib.homepage.replace(/\/$/, "");
    ctx.progress(lib.name);
    const free = await ctx.fetchJson<Entry[]>(`${base}/library.json`);
    let pro: Entry[] = [];
    try {
      pro = await ctx.fetchJson<Entry[]>(`${base}/library-pro.json`);
    } catch {
      /* 没有付费清单也不影响 */
    }

    const out: ComponentItem[] = [];
    const all = [...free.map((e) => ({ e, paid: false })), ...pro.map((e) => ({ e, paid: true }))].filter(
      (x, i, arr) => arr.findIndex((y) => y.e.slug === x.e.slug) === i,
    );
    // 封面图并发探测（逐个 HEAD 太慢）
    const covers = new Map<string, boolean>();
    for (let i = 0; i < all.length; i += 8) {
      ctx.progress(`${lib.name} ${Math.min(i + 8, all.length)}/${all.length}`);
      await Promise.all(
        all.slice(i, i + 8).map(async ({ e }) => covers.set(e.slug, await ctx.exists(`${site}/assets/community/thumbs/${e.slug}.jpg`))),
      );
    }
    for (const { e, paid } of all) {
      const cover = `${site}/assets/community/thumbs/${e.slug}.jpg`;
      const hasCode = !paid && e.html != null;
      out.push({
        slug: e.slug,
        name: e.title,
        description: e.desc ?? "",
        categories: (e.cat ?? "").split(/\s+/).filter(Boolean).map((c) => CATEGORY[c] ?? c),
        tier: paid ? "pro" : "free",
        frameworks: ["css", "js"],
        page: paid ? `${site}/pro.html` : `${site}/transitions/${e.slug}/`,
        source: paid ? "" : `${base}/library.json#${e.slug}`,
        install: "",
        cover: covers.get(e.slug) ? cover : "",
        preview: hasCode ? { kind: "html", html: e.html ?? "", css: e.css ?? "", js: e.js ?? "" } : null,
      });
    }
    return out;
  },
};
