/**
 * 预览 iframe（sandbox="allow-scripts"，不同源）里运行的代码。
 * 打成 IIFE 后内联进 srcdoc，不能 import obsidian，也碰不到 vault。
 *
 * 负责：CommonJS 模块加载、内置 React 等常用依赖、挂载组件、出错时显示原因。
 *
 * 这里不编译、不 eval、不动态 import，也不插 <style>：这些都由插件在生成页面时写成静态内容（build.ts）——
 *   - 组件模块：插件用 sucrase 编译后包成函数，写进内联脚本 `window.__uiShelfModules = { path: function (require, module, exports) {…} }`
 *   - CSS：直接写成页面里的 <style>
 *   - esm.sh 依赖：静态 <script type="module"> 逐个 import，结果放进 window.__uiShelfRemote（失败记进 __uiShelfRemoteErrors）
 *   - 最后一个 module 脚本调用 window.__uiShelfStart()，此时远程依赖都已就绪（module 脚本按文档顺序执行）
 */
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JSXRuntime from "react/jsx-runtime";
import * as cva from "class-variance-authority";
import * as clsx from "clsx";
import * as tailwindMerge from "tailwind-merge";
import { installFrame, report, showError } from "./frame";

interface Payload {
  entry: string;
  exportName: string;
  props?: Record<string, unknown>;
}

type ModuleFn = (require: (spec: string) => unknown, module: { exports: unknown }, exports: unknown) => void;

interface ShelfWindow {
  __uiShelfModules?: Record<string, ModuleFn>;
  __uiShelfRemote?: Record<string, Record<string, unknown>>;
  __uiShelfRemoteErrors?: Record<string, string>;
  __uiShelfBuiltin?: Record<string, unknown>;
  __uiShelfStart?: () => void;
}
const w = window as unknown as ShelfWindow;

const BUILTIN: Record<string, unknown> = {
  react: React,
  "react-dom": ReactDOM,
  "react-dom/client": ReactDOMClient,
  "react/jsx-runtime": JSXRuntime,
  "react/jsx-dev-runtime": JSXRuntime,
  "class-variance-authority": cva,
  clsx,
  "tailwind-merge": tailwindMerge,
};

/** cn() 常见的几个位置：@/lib/utils（shadcn）、@/utils/cn、@/lib/cn */
const CN_PATH = /(^|\/)(lib\/utils|utils\/cn|lib\/cn|utils)$/;

/** shadcn 约定每个项目自带 `@/lib/utils` 的 cn()，registry 里不发这个文件 */
const SHADCN_UTILS = {
  cn: (...inputs: clsx.ClassValue[]) => tailwindMerge.twMerge(clsx.clsx(inputs)),
};

const EXTS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** CSS Modules：类名原样返回（每个预览独占一个 iframe，不会冲突）。 */
const cssModule = new Proxy<Record<string, string>>({}, {
  get: (_t, key) => (key === "__esModule" ? false : typeof key === "string" ? key : undefined),
});

function run(p: Payload): void {
  const modules = w.__uiShelfModules ?? {};
  const remote = w.__uiShelfRemote ?? {};
  const remoteErrors = w.__uiShelfRemoteErrors ?? {};
  const paths = Object.keys(modules);
  const cache = new Map<string, { exports: unknown }>();

  const resolveLocal = (spec: string, from: string): string | null => {
    let base: string;
    if (spec.startsWith(".")) base = normalize(`${dirname(from)}/${spec}`);
    else if (spec.startsWith("@/") || spec.startsWith("~/")) base = normalize(spec.slice(2));
    else return null;
    for (const ext of EXTS) if (modules[base + ext] != null) return base + ext;
    // 别名指向的目录和 registry 里的 path 不一定一致：按路径后缀找
    const tail = base.split("/").slice(-2).join("/");
    for (const ext of EXTS) {
      const hit = paths.find((x) => x === tail + ext || x.endsWith(`/${tail}${ext}`));
      if (hit) return hit;
    }
    const last = base.split("/").pop() ?? "";
    for (const ext of EXTS) {
      const hit = paths.find((x) => x.endsWith(`/${last}${ext}`));
      if (hit) return hit;
    }
    return null;
  };

  const load = (path: string): unknown => {
    const hit = cache.get(path);
    if (hit) return hit.exports;
    const module = { exports: {} as unknown };
    cache.set(path, module);
    modules[path]((spec) => req(spec, path), module, module.exports);
    return module.exports;
  };

  const req = (spec: string, from: string): unknown => {
    if (spec in BUILTIN) return BUILTIN[spec];
    if (spec.endsWith(".css")) return spec.includes(".module.") ? cssModule : {};
    const local = resolveLocal(spec, from);
    if (local) return load(local);
    if (spec in remote) {
      // import 拿到的是 ES 模块命名空间，没有 __esModule 标记；sucrase 编译的
      // `import x from "pkg"` 会把整个命名空间当成 default（cobe 的 createGlobe 变成对象）。补上标记。
      return Object.assign(Object.create(null) as Record<string, unknown>, remote[spec], { __esModule: true });
    }
    if (spec in remoteErrors) throw new Error(`Failed to load "${spec}" from esm.sh: ${remoteErrors[spec]}`);
    if (CN_PATH.test(spec)) return SHADCN_UTILS;
    throw new Error(`Cannot resolve "${spec}" (imported by ${from})`);
  };

  const mod = load(p.entry) as Record<string, unknown>;
  const Comp = (mod[p.exportName] ?? mod.default) as React.ComponentType<Record<string, unknown>> | undefined;
  if (typeof Comp !== "function" && typeof Comp !== "object") throw new Error(`${p.entry} has no export "${p.exportName}"`);

  class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
      return { error };
    }
    componentDidCatch(error: Error) {
      showError(error);
    }
    render() {
      return this.state.error ? null : this.props.children;
    }
  }

  const root = ReactDOMClient.createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <Boundary>
      <Comp {...(p.props ?? {})} />
    </Boundary>,
  );
}

// 内置模块交给 import map 指向的 data: 模块（esm.sh 包里的 `import "react"` 拿到的是同一份 React）
w.__uiShelfBuiltin = BUILTIN;

w.__uiShelfStart = () => {
  try {
    const el = document.getElementById("ui-shelf-payload");
    if (!el) return;
    run(JSON.parse(el.textContent ?? "{}") as Payload);
    report();
  } catch (e) {
    showError(e);
  }
};

installFrame();
