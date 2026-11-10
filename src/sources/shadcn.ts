import { joinTailwindCss } from "../core/css";
import type { ComponentItem, LibraryConfig, SourceAdapter, SourceFile, SyncContext } from "../types";
import { registryCss, type RegistryCss } from "./registry-css";
import { componentExports, demoProps, dirOf, pickExport } from "./util";

/**
 * shadcn registry 型来源：
 *   GET registry.json            → { items: [{ name, type, title, description }] }
 *   GET {dir}/{name}.json        → { files: [{ path, content, type, target }], registryDependencies, dependencies, cssVars, css }
 * registryDependencies 是同一 registry 的其他条目（URL 或名字），递归收集它们的文件，
 * 预览时 `@/components/...` 这类别名在这些文件里按路径后缀解析。
 *
 * 有 `<name>-demo`（registry:example）时预览渲染官方 demo：组件常有必填 props（文字数组、ref、children），
 * 光渲染组件本身会报错或是空的；demo 正是作者给的「怎么用」。接入信息仍按组件本身算。
 */

interface RegistryIndex {
  items?: { name: string; type?: string; title?: string; description?: string; categories?: string[] }[];
}

interface RegistryItem extends RegistryCss {
  name: string;
  type?: string;
  title?: string;
  description?: string;
  categories?: string[];
  files?: { path: string; content?: string; type?: string; target?: string }[];
  registryDependencies?: string[];
  dependencies?: string[];
}

/** 可以单独预览的条目类型；style/lib/hook/file/example 只作为依赖或 demo */
const PREVIEWABLE = new Set(["registry:ui", "registry:component", "registry:block"]);

/** shadcn 官方组件：依赖里写裸名字（如 "button"）时去这里取 */
const SHADCN_OFFICIAL = "https://ui.shadcn.com/r/styles/new-york-v4/";

/** shadcn CLI 把文件装到哪：有 target 用 target，否则按文件类型（默认别名 components / ui / lib / hooks） */
export function installTarget(file: { path: string; type?: string; target?: string }, itemType?: string): string {
  if (file.target) return file.target.replace(/^~\//, "");
  const base = file.path.split("/").pop() ?? file.path;
  switch (file.type ?? itemType) {
    case "registry:ui":
      return `components/ui/${base}`;
    case "registry:lib":
      return `lib/${base}`;
    case "registry:hook":
      return `hooks/${base}`;
    case "registry:component":
    case "registry:block":
      return `components/${base}`;
    default:
      return file.path;
  }
}

export const shadcnAdapter: SourceAdapter = {
  kind: "shadcn",
  async collect(lib: LibraryConfig, ctx: SyncContext): Promise<ComponentItem[]> {
    const index = await ctx.fetchJson<RegistryIndex>(lib.url);
    const dir = dirOf(lib.url);
    const origin = new URL(lib.url).origin;
    const names = new Map((index.items ?? []).map((i) => [i.name, i]));
    const cache = new Map<string, Promise<RegistryItem>>();
    const load = (url: string): Promise<RegistryItem> => {
      let p = cache.get(url);
      if (!p) {
        p = ctx.fetchJson<RegistryItem>(url);
        cache.set(url, p);
      }
      return p;
    };
    /** 依赖引用 → URL：完整 URL / 本 registry 的名字 / shadcn 3 的命名空间写法 "@magicui/dock" / shadcn 官方组件名 */
    // 单个条目的地址：有模板用模板；否则第一次时探测（registry 同目录 / r/ / registry/），记住能用的那种
    let itemPattern = lib.options?.itemUrl ?? "";
    const itemUrl = (name: string) => (itemPattern ? itemPattern.replace(/\{name\}|\{slug\}/g, name) : `${dir}${name}.json`);
    const probe = async (name: string) => {
      if (itemPattern) return;
      for (const pat of [`${dir}{name}.json`, `${dir}r/{name}.json`, `${origin}/r/{name}.json`, `${dir}registry/{name}.json`, `${origin}/registry/{name}.json`]) {
        try {
          await load(pat.replace("{name}", name));
          itemPattern = pat;
          return;
        } catch (e) {
          if (/HTTP 40[13]/.test((e as Error).message)) {
            itemPattern = pat; // 地址对，只是要授权
            return;
          }
        }
      }
      itemPattern = `${dir}{name}.json`;
    };

    const resolveDep = (ref: string): string | null => {
      if (/^https?:/.test(ref)) return ref;
      const bare = ref.replace(/^@[\w.-]+\//, "");
      if (names.has(bare)) return itemUrl(bare);
      if (ref.startsWith("@")) return null; // 别的命名空间（另一个 registry），不知道地址
      return `${SHADCN_OFFICIAL}${ref}.json`;
    };

    const include = new Set(lib.options?.include?.length ? lib.options.include : PREVIEWABLE);
    const match = lib.options?.match ? new RegExp(lib.options.match) : null;
    const items = (index.items ?? []).filter((i) => include.has(i.type ?? "") && (!match || match.test(i.name)));
    if (items[0]) await probe(items[0].name);
    const docs = lib.options?.docsIndex ? await docLinks(lib.options.docsIndex, ctx) : new Map<string, string>();
    const out: ComponentItem[] = [];
    for (const [n, entry] of items.entries()) {
      ctx.progress(`${lib.name} ${n + 1}/${items.length}`);
      let item: RegistryItem;
      try {
        item = await load(itemUrl(entry.name));
      } catch (e) {
        const msg = (e as Error).message;
        // 要授权才能取的条目 = 付费内容：只记元数据，不取代码
        if (/HTTP 40[13]/.test(msg)) {
          out.push({
            slug: entry.name,
            name: entry.title ?? entry.name,
            description: entry.description ?? "",
            categories: entry.categories ?? [],
            tier: "pro",
            frameworks: ["react"],
            page: lib.homepage,
            source: "",
            install: `npx shadcn@latest add ${itemUrl(entry.name)}`,
            cover: "",
            preview: null,
          });
          continue;
        }
        throw new Error(`${entry.name}: ${msg}`);
      }

      // 收集本条目（+ demo）+ 递归依赖的全部文件和 registry CSS
      const files: SourceFile[] = [];
      const cssChunks: string[] = [];
      const seen = new Set<string>();
      const walk = async (it: RegistryItem) => {
        for (const f of it.files ?? []) {
          if (f.content != null && !files.some((x) => x.path === f.path)) {
            files.push({ path: f.path, code: f.content, target: it.type === "registry:example" ? undefined : installTarget(f, it.type) });
          }
        }
        const css = registryCss(it);
        if (css) cssChunks.push(css);
        for (const ref of it.registryDependencies ?? []) {
          const url = resolveDep(ref);
          if (!url || seen.has(url)) continue;
          seen.add(url);
          try {
            await walk(await load(url));
          } catch {
            /* 依赖取不到时照样预览，缺的部分在沙箱里报错 */
          }
        }
      };
      await walk(item);

      // 官方 demo：索引里列了 `<name>-demo` 就取；没列也试一下（aceternity 的 demo 存在但不在索引里），取不到就算了
      let demo: RegistryItem | null = null;
      const demoName = `${entry.name}-demo`;
      const listed = names.get(demoName);
      if (!listed || listed.type === "registry:example") {
        try {
          demo = await load(itemUrl(demoName));
          if (!demo.files?.some((f) => f.content)) demo = null;
          else await walk(demo);
        } catch {
          demo = null;
        }
      }

      // 还没有 demo：先看仓库里的官方 demo 文件，再看组件文档（Markdown）Usage 里的示例
      let docDemo: { path: string; code: string } | null = null;
      if (!demo && lib.options?.demoUrl) {
        const url = lib.options.demoUrl.replace(/\{name\}|\{slug\}/g, entry.name);
        try {
          const code = await ctx.fetchText(url);
          if (componentExports(code).length) {
            docDemo = { path: `demo/${entry.name}-demo.tsx`, code };
            files.push(docDemo);
          }
        } catch {
          /* 这个组件没有 demo 文件 */
        }
      }
      if (!demo && !docDemo && docs.has(entry.name)) {
        try {
          const code = usageBlock(await ctx.fetchText(docs.get(entry.name) ?? ""));
          if (code && componentExports(code).length) {
            docDemo = { path: `docs-demo/${entry.name}.tsx`, code };
            files.push(docDemo);
          }
        } catch {
          /* 文档取不到就用组件本身 */
        }
      }

      // 作者没声明的依赖：源码里 import 了 `@/components/ui/x`、`@/registry/…/x`，本地又找不到 → 按名字补取
      for (let round = 0; round < 3; round++) {
        const missing = unresolvedAliases(files);
        const urls = missing.map((name) => resolveDep(name)).filter((u): u is string => !!u && !seen.has(u));
        if (!urls.length) break;
        for (const url of urls) {
          seen.add(url);
          try {
            await walk(await load(url));
          } catch {
            /* 取不到就算了，预览里会报具体缺哪个 */
          }
        }
      }

      // 还缺的 `@/…` 文件：给了仓库地址就按路径去仓库里取（demo 常引用 registry 没发的 ui 组件）
      if (lib.options?.repo) await fillFromRepo(lib.options.repo, files, ctx);

      const own = (item.files ?? []).find((f) => /\.[jt]sx$/.test(f.path) && f.content);
      const exportName = own?.content ? pickExport(own.content, entry.name) : null;
      const registryDemo = demo?.files?.find((f) => /\.[jt]sx$/.test(f.path) && f.content);
      const demoFile = registryDemo ? { path: registryDemo.path, content: registryDemo.content } : docDemo ? { path: docDemo.path, content: docDemo.code } : null;
      const demoExport = registryDemo?.content
        ? pickExport(registryDemo.content, demoName)
        : docDemo
          ? (componentExports(docDemo.code).pop() ?? null)
          : null;
      const css = [...files.filter((f) => f.path.endsWith(".css")).map((f) => f.code), ...cssChunks];
      const code = files.filter((f) => !f.path.endsWith(".css"));
      const title = item.title ?? entry.title ?? item.name;

      let preview: ComponentItem["preview"] = null;
      if (own && exportName) {
        preview =
          demoFile && demoExport
            ? {
                kind: "react",
                files: code,
                entry: demoFile.path,
                exportName: demoExport,
                tailwindCss: joinTailwindCss(css),
                component: { entry: own.path, exportName },
              }
            : {
                kind: "react",
                files: code,
                entry: own.path,
                exportName,
                tailwindCss: joinTailwindCss(css),
                props: own.content ? demoProps(own.content, exportName, title) : undefined,
              };
      }

      out.push({
        slug: entry.name, // 以索引里的名字为准（条目 JSON 里的 name 不一定有、不一定一致）
        name: title,
        description: item.description ?? entry.description ?? "",
        categories: item.categories ?? entry.categories ?? [],
        tier: "free",
        frameworks: ["react"],
        page: lib.homepage,
        source: itemUrl(entry.name),
        install: `npx shadcn@latest add ${itemUrl(entry.name)}`,
        cover: "",
        preview,
      });
    }
    return out;
  },
};

/** 源码里 `@/…` 形式、但在已收集文件里按路径后缀找不到的 import，返回最后一段名字（如 "badge"） */
export function unresolvedAliases(files: SourceFile[]): string[] {
  const stems = files.map((f) => f.path.replace(/\.[jt]sx?$/, ""));
  const out = new Set<string>();
  for (const f of files) {
    for (const m of f.code.matchAll(/from\s+["']@\/([^"']+)["']/g)) {
      const spec = m[1];
      if (/(^|\/)(lib\/utils|utils\/cn|lib\/cn|utils)$/.test(spec)) continue; // cn() 运行时内置
      const parts = spec.split("/");
      const tail = parts.slice(-2).join("/");
      const last = parts[parts.length - 1];
      if (stems.some((s) => s === spec || s.endsWith(`/${tail}`) || s.endsWith(`/${last}`))) continue;
      out.add(last);
    }
  }
  return [...out];
}

/** 文档索引里所有 `…/<name>.md` 链接：名字 → 地址 */
async function docLinks(url: string, ctx: SyncContext): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const text = await ctx.fetchText(url);
    for (const m of text.matchAll(/https?:\/\/[^\s)"'<>]+\/([a-z0-9-]+)\.md\b/gi)) if (!out.has(m[1])) out.set(m[1], m[0]);
  } catch {
    /* 没有索引就不用文档示例 */
  }
  return out;
}

/** Markdown 里「Usage / Example」小节的第一个 tsx/jsx 代码块；没有这样的小节就取第一个 tsx 块 */
export function usageBlock(md: string): string | null {
  const block = (s: string) => /```(?:tsx|jsx)\s*\n([\s\S]*?)```/.exec(s)?.[1] ?? null;
  const section = /^#{2,3}\s+(usage|example|examples|demo)\b[^\n]*\n([\s\S]*?)(?=^#{2}\s|(?![\s\S]))/im.exec(md);
  return (section && block(section[2])) || block(md);
}

const repoCache = new Map<string, Promise<string | null>>();

/** 源码里 import 了、本地又没有的文件路径：`@/…` 按项目根，`./…`、`../…` 按所在文件的目录（cn 除外） */
function missingAliasPaths(files: SourceFile[]): string[] {
  const stems = new Set(files.map((f) => f.path.replace(/\.[jt]sx?$/, "").replace(/\/index$/, "")));
  const out = new Set<string>();
  for (const f of files) {
    const dir = f.path.split("/").slice(0, -1);
    for (const m of f.code.matchAll(/(?:from|import)\s+["'](@\/|\.{1,2}\/)([^"']*)["']/g)) {
      let spec: string;
      if (m[1] === "@/") spec = m[2];
      else {
        const parts = [...dir];
        for (const seg of `${m[1]}${m[2]}`.split("/")) {
          if (seg === "..") parts.pop();
          else if (seg && seg !== ".") parts.push(seg);
        }
        spec = parts.join("/");
      }
      spec = spec.replace(/\.[jt]sx?$/, "").replace(/\/$/, "");
      if (!spec || /(^|\/)(lib\/utils|utils\/cn|lib\/cn|utils)$/.test(spec) || /\.(css|svg|png|jpe?g|gif|webp|json)$/.test(spec)) continue;
      if ([...stems].some((s) => s === spec || (m[1] === "@/" && s.endsWith(`/${spec}`)))) continue;
      out.add(spec);
    }
  }
  return [...out];
}

async function fillFromRepo(base: string, files: SourceFile[], ctx: SyncContext): Promise<void> {
  const root = base.endsWith("/") ? base : `${base}/`;
  const tried = new Set<string>();
  for (let round = 0; round < 10; round++) {
    const missing = missingAliasPaths(files).filter((p) => !tried.has(p));
    if (!missing.length) return;
    for (const spec of missing) {
      tried.add(spec);
      for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts", ".jsx", ".js"]) {
        const url = `${root}${spec}${ext}`;
        let p = repoCache.get(url);
        if (!p) {
          p = ctx.fetchText(url).then(
            (t) => (/^\s*</.test(t) ? null : t),
            () => null,
          );
          repoCache.set(url, p);
        }
        const code = await p;
        if (code != null) {
          files.push({ path: `${spec}${ext}`, code });
          break;
        }
      }
    }
  }
}
