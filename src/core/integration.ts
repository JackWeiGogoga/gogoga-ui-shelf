/**
 * 从组件源码推出 agent 接入时要知道的事：样式方案、npm 依赖、前置条件、文件清单、导出名、
 * props、最小用法示例。纯函数（不引 obsidian），smoke 里直接测。
 */
import { propChoices, propsInfo, type PropChoice } from "../sources/util";
import type { ComponentItem } from "../types";

export type Styling = "tailwind-v4" | "tailwind" | "css-modules" | "css" | "none";

export interface Integration {
  styling: Styling;
  /** 需要安装的 npm 包（不含 react / react-dom） */
  dependencies: string[];
  /** 其他前置条件，人话写 */
  requires: string[];
  /** 文件清单：源路径（就是放进项目的建议路径） */
  files: string[];
  exportName: string | null;
  propsRequired: string[];
  propsOptional: string[];
  /** 有固定取值的属性（variant、size…）：取值和默认值 */
  variants: PropChoice[];
  /** 最小用法示例（TSX 或 HTML） */
  usage: string;
}

const PEER = new Set(["react", "react-dom"]);

/** "@scope/pkg/sub/path" → "@scope/pkg"，"pkg/sub" → "pkg" */
export function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function importsOf(code: string): string[] {
  const out = new Set<string>();
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const line = code.slice(code.lastIndexOf("\n", m.index) + 1, m.index + m[0].length);
    if (/^\s*import\s+type\s/.test(line)) continue; // 只有类型的 import 不算依赖
    out.add(m[1] ?? m[2]);
  }
  return [...out];
}

function stylingOf(item: ComponentItem): Styling {
  const p = item.preview;
  if (!p) return "none";
  if (p.kind === "html") return p.css.trim() ? "css" : "none";
  if (p.tailwindCss != null) return /@import\s+["']tailwindcss["']|@theme\b/.test(p.tailwindCss) ? "tailwind-v4" : "tailwind";
  if (p.files.some((f) => /\.module\.css$/.test(f.path))) return "css-modules";
  if (p.files.some((f) => f.path.endsWith(".css"))) return "css";
  return "none";
}

function exampleValue(prop: string): string {
  const p = prop.toLowerCase();
  if (p === "code" || p === "source") return `{"const a = 1;"}`;
  if (p === "lang" || p === "language") return `"ts"`;
  if (p === "children") return "";
  if (/^on[A-Z]/.test(prop)) return "{() => {}}";
  if (/(rows|items|options|steps|list|data|sources)$/.test(p)) return "{[/* … */]}";
  return `"…"`;
}

export function analyze(item: ComponentItem): Integration {
  const p = item.preview;
  const base: Integration = {
    styling: stylingOf(item),
    dependencies: [],
    requires: [],
    files: [],
    exportName: null,
    propsRequired: [],
    propsOptional: [],
    variants: [],
    usage: "",
  };
  if (!p) return base;

  if (p.kind === "html") {
    base.files = ["index.html", ...(p.css.trim() ? ["style.css"] : []), ...(p.js.trim() ? ["script.js"] : [])];
    if (/data-theme|\.dark\b/.test(p.css)) base.requires.push('Dark mode via `html[data-theme="dark"]` (set it on <html>)');
    base.usage = p.html.trim();
    return base;
  }

  const deps = new Set<string>();
  let usesCn = false;
  for (const f of p.files) {
    for (const spec of importsOf(f.code)) {
      if (spec.startsWith(".") || spec.endsWith(".css")) continue;
      if (spec.startsWith("@/") || spec.startsWith("~/")) {
        if (/(^|\/)(lib\/utils|utils\/cn|lib\/cn|utils)$/.test(spec) && !p.files.some((x) => /lib\/utils\.[jt]sx?$/.test(x.path))) usesCn = true;
        continue;
      }
      const pkg = packageName(spec);
      if (!PEER.has(pkg)) deps.add(pkg);
    }
  }
  if (usesCn) {
    deps.add("clsx");
    deps.add("tailwind-merge");
    base.requires.push("shadcn `cn()` helper at `@/lib/utils` (clsx + tailwind-merge)");
  }
  base.dependencies = [...deps].sort();
  base.files = codeFiles(item).map((f) => f.path);
  if (base.styling === "tailwind-v4") {
    base.requires.unshift("Tailwind CSS v4");
    if (p.tailwindCss?.trim()) base.requires.push("The library's global CSS (tokens / @theme) imported in your globals.css — included with the shadcn install");
  } else if (base.styling === "tailwind") base.requires.unshift("Tailwind CSS");
  if (p.files.some((f) => /^\s*["']use client["']/.test(f.code))) base.requires.push('Client component ("use client") — fine in Next.js App Router');
  if (p.files.some((f) => /\.tsx?$/.test(f.path))) base.requires.push("TypeScript source (rename to .jsx and drop types if your project is JS)");

  // 预览渲染的是 demo 时，接入信息按组件本身算
  const compEntry = p.component?.entry ?? p.entry;
  const compExport = p.component?.exportName ?? p.exportName;
  const entry = p.files.find((f) => f.path === compEntry);
  const demo = p.component ? p.files.find((f) => f.path === p.entry) : undefined;
  base.exportName = compExport;
  const info = entry ? propsInfo(entry.code, compExport) : null;
  base.propsRequired = info?.required ?? [];
  base.propsOptional = info?.optional ?? [];
  base.variants = entry ? propChoices(entry.code, compExport) : [];

  if (p.files.some((f) => /from\s+["']@\/registry\//.test(f.code)))
    base.requires.push("Source imports use registry paths (`@/registry/…`); the shadcn CLI rewrites them — fix them by hand if you copy files from the local code folder");

  // 用 CLI 安装时文件落在 target，import 路径按它算；否则按源路径
  const where = (entry?.target ?? compEntry).replace(/\.[jt]sx?$/, "");
  const importPath = where.includes("/") ? `@/${where}` : `./${where}`;
  const attrs = base.propsRequired.filter((n) => n !== "children").map((n) => ` ${n}=${exampleValue(n)}`).join("");
  const children = base.propsRequired.includes("children") || (info?.rest && !info.optional.includes("children"));
  base.usage =
    `import { ${compExport} } from "${importPath}";\n\n` +
    (children ? `<${compExport}${attrs}>…</${compExport}>` : `<${compExport}${attrs} />`);
  if (demo) base.usage += `\n\n// Official demo: ${demo.path} in the local code folder`;
  return base;
}

/**
 * 要展开到本地的代码文件（路径相对组件代码目录）。
 * 路径来自远程 registry，必须清洗：去掉开头的 /、丢掉 .. 段，防止写到目录外面。
 */
export function safeRelPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
}

export function codeFiles(item: ComponentItem): { path: string; code: string }[] {
  const p = item.preview;
  if (!p) return [];
  if (p.kind === "html") {
    return [
      { path: "index.html", code: p.html },
      { path: "style.css", code: p.css },
      { path: "script.js", code: p.js },
    ].filter((f) => f.code.trim());
  }
  const out = p.files.map((f) => ({ path: safeRelPath(f.path), code: f.code })).filter((f) => f.path);
  if (p.tailwindCss?.trim()) out.push({ path: "globals.css", code: p.tailwindCss });
  return out;
}
