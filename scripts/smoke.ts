/**
 * pnpm smoke：用真实网络跑一遍三个预设来源，检查
 *   采集数量、免费组件都有预览材料、每个组件都能编译、自动标签覆盖率、词表外标签。
 * 输出 build/smoke/<lib>.json 供人工查看；任何断言失败退出码非 0。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { analyze, codeFiles, safeRelPath } from "../src/core/integration";
import { autoTags, unknownTags } from "../src/core/tags";
import { balanceBraces, buildSrcdoc, compileModules, tailwindSource } from "../src/preview/build";
import { collect, PRESETS } from "../src/sources";
import { unresolvedAliases } from "../src/sources/shadcn";
import { manifestToLibrary, parseManifest, type SourceManifest } from "../src/sources/manifest";
import { demoProps, pickExport, propsInfo } from "../src/sources/util";
import type { SyncContext } from "../src/types";

const ctx: SyncContext = {
  async fetchJson<T>(url: string) {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return (await r.json()) as T;
  },
  async fetchText(url: string) {
    return (await fetch(url)).text();
  },
  async exists(url: string) {
    return (await fetch(url, { method: "HEAD" })).ok;
  },
  progress() {},
};

let failed = 0;
const check = (ok: boolean, msg: string) => {
  if (!ok) {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
};

// 回归：常量导出不能当组件；必填 props 要给演示值
check(pickExport("export const LATTICE_VARIANTS = [];\nexport function Orb() {}", "orbs") === "Orb", "pickExport skips SCREAMING_CASE constants");
check(
  JSON.stringify(demoProps("export function CodeBlock({ lang, code }: { lang: string; code: string }) {}", "CodeBlock", "Code")) ===
    JSON.stringify({ lang: "ts", code: 'const greeting = "hello";\nconsole.log(greeting);' }),
  "demoProps fills required props",
);
check(demoProps("export function A({ rows = R, labels }: { rows?: X[]; labels?: L }) {}", "A", "A") === undefined, "demoProps skips optional props");
check(demoProps("export function Button({ variant, ...props }: P) {}", "Button", "Button")?.children === "Button", "demoProps gives children through rest props");
// 箭头函数组件（aceternity 的写法）也要能读出必填 props
check(
  JSON.stringify(propsInfo('export const ParallaxScroll = ({ images, className }: { images: string[]; className?: string }) => {', "ParallaxScroll")) ===
    JSON.stringify({ required: ["images"], optional: ["className"], rest: false }),
  "propsInfo reads arrow-function components",
);
check(
  propsInfo("const Dock = React.forwardRef<HTMLDivElement, DockProps>(({ className, children, ...props }, ref) => {", "Dock")?.rest === true,
  "propsInfo reads forwardRef components",
);

// 未声明的依赖：@/components/ui/badge 找不到要补取，已有的、lib/utils 不算
check(
  JSON.stringify(
    unresolvedAliases([
      { path: "registry/example/dock-demo.tsx", code: 'import { Dock } from "@/registry/magicui/dock"\nimport { Separator } from "@/components/ui/separator"\nimport { cn } from "@/lib/utils"' },
      { path: "registry/magicui/dock.tsx", code: "" },
    ]),
  ) === '["separator"]',
  "unresolvedAliases finds undeclared imports only",
);

// 远程 registry 给的路径不能写到代码目录外面
check(safeRelPath("../../etc/passwd") === "etc/passwd" && safeRelPath("/abs/x.ts") === "abs/x.ts", "safeRelPath strips .. and leading /");

// 回归：多余的 } 会让 Tailwind 整份样式作废（beautifului foundation.css）
check(balanceBraces("a{b{}}\n}\nc{") === "a{b{}}\n\nc{}", "balanceBraces drops stray } and closes open blocks");
check(balanceBraces('/* } */ a{content:"}"}') === '/* } */ a{content:"}"}', "balanceBraces ignores braces in comments/strings");

const balanced = (css: string) => {
  let d = 0;
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") d++;
    if (ch === "}" && --d < 0) return false;
  }
  return d === 0;
};

await mkdir("build/smoke", { recursive: true });
for (const lib of PRESETS) {
  const t0 = Date.now();
  const items = await collect(lib, ctx);
  const free = items.filter((i) => i.tier === "free");
  const tagged = items.filter((i) => autoTags(i).some((t) => t.startsWith("ui/type/")));
  const remote = new Set<string>();
  for (const it of items) {
    check(!!it.slug && !!it.name && !!it.page, `${lib.id}: missing basics ${JSON.stringify(it.slug)}`);
    check(unknownTags(autoTags(it)).length === 0, `${lib.id}/${it.slug}: unknown tag`);
    if (it.tier === "free") check(!!it.preview, `${lib.id}/${it.slug}: free but no preview`);
    if (it.tier === "pro") check(!it.preview, `${lib.id}/${it.slug}: pro must not carry code`);
    if (it.preview) {
      try {
        if (it.preview.kind === "react") compileModules(it.preview.files).remote.forEach((r) => remote.add(r));
        if (it.preview.kind === "react" && it.preview.tailwindCss != null)
          check(balanced(tailwindSource(it.preview.tailwindCss)), `${lib.id}/${it.slug}: tailwind css unbalanced`);
        const html = buildSrcdoc(it.preview, { theme: "light", background: "transparent" });
        check(html.length > 1000, `${lib.id}/${it.slug}: srcdoc too small`);
      } catch (e) {
        check(false, `${lib.id}/${it.slug}: compile failed ${(e as Error).message}`);
      }
    }
  }
  console.log(
    `${lib.name}: ${items.length} components (${free.length} free, ${items.length - free.length} pro), ` +
      `type-tagged ${tagged.length}/${items.length}, covers ${items.filter((i) => i.cover).length}, ` +
      `esm.sh deps [${[...remote].join(", ")}] in ${Date.now() - t0}ms`,
  );
  for (const it of items.filter((i) => !autoTags(i).some((t) => t.startsWith("ui/type/"))))
    console.log(`  · untyped: ${it.slug} (${it.categories.join(",")})`);
  check(items.length > 5, `${lib.id}: too few components`);
  await writeFile(
    `build/smoke/${lib.id}.json`,
    JSON.stringify(
      items.map((i) => ({ slug: i.slug, tier: i.tier, tags: autoTags(i), categories: i.categories, preview: i.preview?.kind ?? null })),
      null,
      2,
    ),
  );
}
// 接入信息：抽查三种来源各一个
const byKey = new Map<string, import("../src/types").ComponentItem>();
for (const lib of PRESETS) for (const it of await collect(lib, ctx)) byKey.set(`${lib.id}/${it.slug}`, it);
const ac = analyze(byKey.get("beautifului/approval-card")!);
check(ac.styling === "tailwind-v4", `approval-card styling ${ac.styling}`);
check(ac.dependencies.includes("class-variance-authority") && ac.dependencies.includes("clsx"), `approval-card deps ${ac.dependencies.join(",")}`);
check(ac.requires.some((r) => r.includes("cn()")), "approval-card needs shadcn cn()");
const cb = analyze(byKey.get("aicss/code-block")!);
check(cb.styling === "css-modules" && cb.exportName === "CodeBlock", `code-block ${cb.styling} ${cb.exportName}`);
check(cb.propsRequired.join(",") === "lang,code", `code-block required props ${cb.propsRequired.join(",")}`);
check(cb.usage.includes('<CodeBlock lang="ts"'), `code-block usage: ${cb.usage}`);
const md = analyze(byKey.get("transitions/menu-dropdown")!);
check(md.styling === "css" && md.files.includes("index.html"), `menu-dropdown ${md.styling} ${md.files.join(",")}`);
check(codeFiles(byKey.get("beautifului/approval-card")!).some((f) => f.path === "globals.css"), "tailwind css written as globals.css");
const pro = analyze(byKey.get("aicss/task-list")!);
check(pro.styling === "none" && pro.files.length === 0, "pro component has no integration data");
console.log(`analyze samples: ${JSON.stringify({ ac: ac.dependencies, cb: cb.usage })}`);

// 声明式来源：三种模式用真实站点各跑一遍，外加校验
const lib = (m: SourceManifest) => manifestToLibrary(m, `test/${m.id}.source.json`);
const bad = parseManifest('{"id":"Bad Id","name":"x","homepage":"nope","index":{"url":"u","format":"sitemap"}}', "bad.json").errors;
check(bad.length === 3, `validation should report id, homepage, missing match: ${JSON.stringify(bad)}`);
check(parseManifest("{oops", "x.json").errors[0]?.includes("invalid JSON") ?? false, "invalid JSON is reported");
check(parseManifest('{"id":"a","name":"A","homepage":"https://a.dev","use":{"kind":"shadcn","url":"u"},"index":{"url":"u"}}', "two.json").errors.some((e) => e.includes("cannot be combined")), "use + index rejected");
check(parseManifest('{"id":"a","name":"A","homepage":"https://a.dev","use":{"kind":"shadcn","url":"u"},"components":[{"slug":"x","tier":"pro"}]}', "mix.json").errors.length === 0, "use + components allowed");

const sitemap = await collect(
  lib({ id: "tsm", name: "T sitemap", homepage: "https://transitions.dev/", index: { url: "https://transitions.dev/sitemap.xml", format: "sitemap", match: "/transitions/([^/]+)/?$" } }),
  ctx,
);
check(sitemap.length > 20 && sitemap.every((i) => i.page.startsWith("https://transitions.dev/transitions/")), `sitemap mode found ${sitemap.length}`);
check(sitemap.some((i) => i.slug === "card-resize" && i.name === "Card Resize"), "sitemap mode titles slugs");

const jsonIdx = await collect(
  lib({
    id: "aj",
    name: "AICSS via index",
    homepage: "https://www.aicss.dev/",
    index: { url: "https://www.aicss.dev/r", items: "components", fields: { category: "category", page: "page", source: "registry" } },
    code: { kind: "react", url: "https://www.aicss.dev/r/{slug}", files: "files", path: "filename", content: "code", entry: "\\.tsx$" },
  }),
  ctx,
);
const jFree = jsonIdx.filter((i) => i.tier === "free");
check(jsonIdx.length === 20 && jFree.length === 15, `json index: ${jsonIdx.length} total / ${jFree.length} free`);
check(jFree.filter((i) => i.preview?.kind === "react").length >= 14, `json index code: ${jFree.filter((i) => i.preview).length} with code`);
for (const it of jFree) if (it.preview) buildSrcdoc(it.preview, { theme: "light", background: "transparent" });

const listed = await collect(
  lib({
    id: "hand",
    name: "Hand list",
    homepage: "https://example.dev/",
    components: [
      { slug: "glow-button", description: "A glowing button", tier: "free", code: { html: "<button class=g>Hi</button>", css: ".g{color:red}" } },
      { slug: "pro-thing", tier: "pro", page: "https://example.dev/pro" },
    ],
  }),
  ctx,
);
check(listed.length === 2 && listed[0].name === "Glow Button" && listed[0].preview?.kind === "html" && !listed[1].preview, "static list mode");
check(autoTags(listed[0]).includes("ui/type/button"), "static items get tags");
console.log(`manifest modes: sitemap ${sitemap.length}, json ${jsonIdx.length} (${jFree.filter((i) => i.preview).length} with code), static ${listed.length}`);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nsmoke ok");
