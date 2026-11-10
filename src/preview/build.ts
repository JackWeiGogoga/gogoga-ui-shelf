import { transform } from "sucrase";
import captureJs from "inline:capture";
import frameJs from "inline:frame";
import builtinKeys from "inline:builtin-keys";
import runtimeJs from "inline:runtime";
import tailwindJs from "inline:tailwind";
import { balanceBraces } from "../core/css";
import type { PreviewSpec } from "../types";

export { balanceBraces };

/** 运行时里内置的模块，其余裸模块从 esm.sh 加载 */
const BUILTIN = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
]);

export interface BuildOptions {
  theme: "light" | "dark";
  /** 预览区背景：透明时跟随笔记背景 */
  background: string;
  /** 生成封面：注入截图脚本 */
  capture?: boolean;
}

/** `</script>` 之类会提前截断内联脚本，统一转义 `<`。 */
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const safeScript = (s: string) => s.replace(/<\/script/gi, "<\\/script");
const safeStyle = (s: string) => s.replace(/<\/style/gi, "<\\/style");
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * 每个 npm 包依赖了 React 的哪几个（react / react-dom），由插件同步时从 npm registry 查好写进来。
 *
 * 为什么要按包区分：esm.sh 构建一个包时，它内部引用的依赖只带「那个依赖真正用到的」external 标记
 * （@react-three/fiber 里引 three 的地址是 `/three@…?target=es2020`，不带 external）。我们直接请求
 * three 时如果统一带上 `external=react,react-dom`，就会拿到另一份构建、页面上出现两份 three——
 * fiber 认不出组件自己 new 的对象，报 "Cannot assign to read only property 'position'"（3d-globe）。
 * 和 esm.sh 用同一套规则，同一个包就只有一个地址、一份实例。查不到的包按旧规则带上两个。
 */
const esmPeers: Record<string, string[]> = {};
export function setEsmPeers(map: Record<string, string[]>): void {
  for (const k of Object.keys(esmPeers)) delete esmPeers[k];
  Object.assign(esmPeers, map);
}

/** "@scope/pkg/sub" → "@scope/pkg"，"pkg/sub" → "pkg" */
export function pkgOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function esmUrl(spec: string): string {
  const external = [...(esmPeers[pkgOf(spec)] ?? ["react", "react-dom"])].sort();
  return `https://esm.sh/${spec}?${external.length ? `external=${external.join(",")}&` : ""}target=es2020`;
}

/**
 * import map：
 * - React 等内置模块 → data: 模块，从 window.__uiShelfBuiltin 取值导出（导出名构建时算好，builtinKeys）
 * - 组件直接用到的远程包 → esm.sh 地址（规则见 esmUrl，和 esm.sh 内部引用一致）
 */
function importMap(remote: string[]): string {
  const imports: Record<string, string> = {};
  for (const spec of remote) imports[spec] = esmUrl(spec);
  for (const [name, keys] of Object.entries(builtinKeys)) {
    const src =
      `const m = window.__uiShelfBuiltin[${JSON.stringify(name)}];\n` +
      `export default (m && m.default) || m;\n` +
      (keys.length ? `export const { ${keys.join(", ")} } = m;\n` : "");
    imports[name] = `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`;
  }
  return `<script type="importmap">${safeScript(JSON.stringify({ imports }))}</script>`;
}

/** 编译好的模块包成函数，写成内联脚本（运行时按路径 require，不用 eval） */
function moduleScript(modules: Record<string, string>): string {
  const body = Object.entries(modules)
    .map(([path, code]) => `${JSON.stringify(path)}: function (require, module, exports) {\n${code}\n}`)
    .join(",\n");
  return `<script>window.__uiShelfModules = {\n${safeScript(body)}\n};</script>`;
}

/**
 * esm.sh 依赖：每个包一个静态 module 脚本。加载失败（网络、解析不了的子依赖）时浏览器在这个
 * <script> 上触发 error，记下来——不立刻报错，组件真 require 到时运行时再报（依赖是从源码扫出来的，可能是误报）。
 */
function remoteScripts(remote: string[]): string {
  return remote
    .map((spec) => {
      const key = JSON.stringify(spec);
      // 裸名字经 import map 解析到 esmUrl
      const url = spec;
      const onerror = `(window.__uiShelfRemoteErrors = window.__uiShelfRemoteErrors || {})[${key}] = 'could not be loaded';`;
      return (
        `<script type="module" onerror="${attr(onerror)}">` +
        safeScript(`import * as m from ${JSON.stringify(url)};\n(window.__uiShelfRemote = window.__uiShelfRemote || {})[${key}] = m;`) +
        `</script>`
      );
    })
    .join("");
}

/** CSS Modules 的 :global(x) 只在构建期有意义，我们不改类名，直接拆掉。 */
function unwrapGlobal(css: string): string {
  let out = css;
  for (let i = 0; i < 5 && out.includes(":global("); i++) out = out.replace(/:global\(([^()]*)\)/g, "$1");
  return out;
}

/** Tailwind 浏览器版只认 `@import "tailwindcss"`，其余包里的 import 解析不了，拆掉。 */
export function tailwindSource(css: string): string {
  const clean = balanceBraces(css.replace(/^\s*@import\s+["'](?!tailwindcss["'])[^"']+["'][^;]*;\s*$/gm, ""));
  // shadcn 系组件默认项目里有一套主题色（bg-background、text-muted-foreground…）。组件库自己的 cssVars 写在后面，会覆盖这里
  const m = /@import\s+["']tailwindcss["'][^;]*;/.exec(clean);
  return m ? `${clean.slice(0, m.index + m[0].length)}\n${SHADCN_THEME}\n${clean.slice(m.index + m[0].length)}` : `${SHADCN_THEME}\n${clean}`;
}

/** shadcn/ui 默认（neutral）主题：浅色、深色两套变量，加上 Tailwind v4 的 @theme 映射 */
const SHADCN_THEME = `
@custom-variant dark (&:is(.dark *));
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0); --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0); --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0); --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0); --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0); --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0); --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0); --input: oklch(0.922 0 0); --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116); --chart-2: oklch(0.6 0.118 184.704); --chart-3: oklch(0.398 0.07 227.392);
  --chart-4: oklch(0.828 0.189 84.429); --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0); --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0); --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0); --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0); --sidebar-ring: oklch(0.708 0 0);
}
.dark {
  --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0); --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0); --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0); --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0); --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0); --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0); --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%); --input: oklch(1 0 0 / 15%); --ring: oklch(0.556 0 0);
  --sidebar: oklch(0.205 0 0); --sidebar-foreground: oklch(0.985 0 0);
  --sidebar-primary: oklch(0.488 0.243 264.376); --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.269 0 0); --sidebar-accent-foreground: oklch(0.985 0 0);
  --sidebar-border: oklch(1 0 0 / 10%); --sidebar-ring: oklch(0.556 0 0);
}
@theme inline {
  --radius-sm: calc(var(--radius) - 4px); --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius); --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border); --color-input: var(--input); --color-ring: var(--ring);
  --color-chart-1: var(--chart-1); --color-chart-2: var(--chart-2); --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4); --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar); --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary); --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent); --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border); --color-sidebar-ring: var(--sidebar-ring);
}
@layer base {
  * { border-color: var(--color-border); outline-color: color-mix(in oklab, var(--color-ring) 50%, transparent); }
  body { color: var(--color-foreground); }
}
`;

const BASE_CSS = (o: BuildOptions) => `
  html, body { margin: 0; background: ${o.background}; }
  body {
    box-sizing: border-box; min-height: 140px; padding: 28px 20px;
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
  }
  #root { display: contents; }
  .ui-shelf-error {
    position: fixed; left: 8px; right: 8px; bottom: 8px; margin: 0; z-index: 2147483647;
    padding: 8px 10px; border-radius: 6px; font: 12px/1.5 ui-monospace, monospace;
    white-space: pre-wrap; color: #b42318; background: #fef3f2; border: 1px solid #fecdca;
  }
`;

export function compileModules(files: { path: string; code: string }[]): { modules: Record<string, string>; remote: string[] } {
  const modules: Record<string, string> = {};
  const remote = new Set<string>();
  for (const f of files) {
    if (!/\.[jt]sx?$/.test(f.path)) continue;
    const isTs = /\.tsx?$/.test(f.path);
    const code = transform(f.code, {
      transforms: isTs ? ["typescript", "jsx", "imports"] : ["jsx", "imports"],
      jsxRuntime: "automatic",
      production: true,
      filePath: f.path,
    }).code;
    modules[f.path] = code;
    for (const m of code.matchAll(/require\((["'])([^"']+)\1\)/g)) {
      const spec = m[2];
      if (spec.startsWith(".") || spec.startsWith("@/") || spec.startsWith("~/") || spec.endsWith(".css")) continue;
      if (!BUILTIN.has(spec)) remote.add(spec);
    }
  }
  return { modules, remote: [...remote] };
}

/** 生成整页 srcdoc。 */
export function buildSrcdoc(spec: PreviewSpec, o: BuildOptions): string {
  const htmlAttrs = `data-theme="${o.theme}" class="${o.theme === "dark" ? "dark" : ""}" style="color-scheme:${o.theme}"`;
  // 有些组件直接读 process.env（Next.js 习惯），浏览器里没有
  const head =
    `<meta charset="utf-8"><style>${BASE_CSS(o)}</style><script>window.process = window.process || { env: { NODE_ENV: "production" } };</script>` +
    (o.capture ? `<script>${safeScript(captureJs)}</script>` : "");

  if (spec.kind === "html") {
    return (
      `<!doctype html><html ${htmlAttrs}><head>${head}<style>${safeStyle(spec.css)}</style>` +
      `<script>${safeScript(frameJs)}</script></head>` +
      `<body>${spec.html}<script>${safeScript(spec.js)}</script></body></html>`
    );
  }

  const { modules, remote } = compileModules(spec.files);
  const styles = spec.files
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => `<style>${safeStyle(unwrapGlobal(f.code))}</style>`)
    .join("");
  const payload = { entry: spec.entry, exportName: spec.exportName, props: spec.props };
  const tailwind =
    spec.tailwindCss != null
      ? `<script>${safeScript(tailwindJs)}</script><style type="text/tailwindcss">${safeStyle(tailwindSource(spec.tailwindCss))}</style>`
      : "";
  // 顺序要紧：import map 在任何 module 脚本之前；运行时（普通脚本）先跑、准备好内置模块和 __uiShelfStart；
  // module 脚本在解析完后按顺序执行，最后一个启动组件时远程依赖都已就绪
  return (
    `<!doctype html><html ${htmlAttrs}><head>${head}${remote.length ? importMap(remote) : ""}${styles}${tailwind}</head>` +
    `<body><div id="root"></div>` +
    `<script type="application/json" id="ui-shelf-payload">${safeJson(payload)}</script>` +
    moduleScript(modules) +
    `<script>${safeScript(runtimeJs)}</script>` +
    remoteScripts(remote) +
    `<script type="module">window.__uiShelfStart();</script></body></html>`
  );
}
