import esbuild from "esbuild";
import { readFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";

const production = process.argv.includes("production");
const smoke = process.argv.includes("smoke");

/**
 * 预览 iframe 里跑的运行时（React + 模块加载器）单独打成一个 IIFE，
 * 主插件把它当成字符串内联进 srcdoc。Tailwind 浏览器版同理。
 */
async function buildRuntime(entry) {
  const out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    target: "es2020",
    platform: "browser",
    minify: true,
    write: false,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
  return out.outputFiles[0].text;
}

/** `import x from "inline:runtime"` / `"inline:tailwind"` → 文件内容字符串。 */
const inlinePlugin = (runtimeRef) => ({
  name: "inline",
  setup(build) {
    build.onResolve({ filter: /^inline:/ }, (args) => ({ path: args.path, namespace: "inline" }));
    build.onLoad({ filter: /.*/, namespace: "inline" }, async (args) => {
      if (args.path === "inline:runtime") return { contents: runtimeRef.runtime, loader: "text" };
      if (args.path === "inline:frame") return { contents: runtimeRef.frame, loader: "text" };
      if (args.path === "inline:capture") return { contents: runtimeRef.capture, loader: "text" };
      if (args.path === "inline:builtin-keys") return { contents: JSON.stringify(builtinKeys), loader: "json" };
      if (args.path === "inline:tailwind") {
        const text = await readFile("node_modules/@tailwindcss/browser/dist/index.global.js", "utf8");
        return { contents: text, loader: "text" };
      }
      throw new Error(`unknown inline module ${args.path}`);
    });
  },
});

/**
 * 运行时内置模块的导出名：生成 import map 里的 data: 模块要用（`export const { useState, … } = m`）。
 * 在构建时算好写死，页面里就不用运行时拼代码。和 runtime.tsx 的 BUILTIN 保持一致。
 */
const require = createRequire(import.meta.url);
process.env.NODE_ENV = "production";
const BUILTIN_MODULES = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "class-variance-authority", "clsx", "tailwind-merge"];
const builtinKeys = Object.fromEntries(
  BUILTIN_MODULES.map((m) => [m, Object.keys(require(m)).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== "default")]),
);

const runtimeRef = {
  runtime: await buildRuntime("src/preview/runtime.tsx"),
  frame: await buildRuntime("src/preview/frame-entry.ts"),
  capture: await buildRuntime("src/preview/capture-entry.ts"),
};

const common = {
  bundle: true,
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  target: "es2020",
  logLevel: "info",
  treeShaking: true,
  plugins: [inlinePlugin(runtimeRef)],
};

if (smoke) {
  // 脱离 Obsidian 验证采集链路（只用到 sources / tags / preview/build，不引 obsidian）
  await esbuild.build({
    ...common,
    entryPoints: process.argv.includes("probe") ? ["scripts/probe-shadcn.ts"] : ["scripts/smoke.ts"],
    format: "esm",
    platform: "node",
    outfile: process.argv.includes("probe") ? "build/probe.mjs" : "build/smoke.mjs",
    target: "es2022",
    external: builtinModules.map((m) => `node:${m}`),
  });
} else {
  const context = await esbuild.context({
    ...common,
    entryPoints: ["src/main.ts"],
    format: "cjs",
    platform: "browser",
    sourcemap: production ? false : "inline",
    minify: production,
    outfile: "dist/main.js",
  });
  if (production) {
    await context.rebuild();
    await context.dispose();
  } else {
    await context.watch();
  }
}
