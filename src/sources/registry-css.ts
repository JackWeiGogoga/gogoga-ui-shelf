/**
 * shadcn registry 条目里的 cssVars / css 字段转成 CSS 文本。
 * shadcn CLI 安装时会把它们合并进项目的 globals.css（动画 keyframes、--animate-* 主题变量都在这里），
 * 我们不转的话：预览里动画不动，本地代码里也缺这部分。
 *
 *   cssVars: { theme: { "animate-marquee": "…" }, light: {…}, dark: {…} }
 *   css:     { "@keyframes marquee": { from: { transform: "…" } }, "@layer base": {…} }
 */

type CssTree = { [key: string]: string | CssTree };

const varName = (k: string) => (k.startsWith("--") ? k : `--${k}`);

function block(selector: string, vars: Record<string, string> | undefined): string {
  if (!vars || !Object.keys(vars).length) return "";
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${varName(k)}: ${v};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

function serialize(tree: CssTree, indent = ""): string {
  const out: string[] = [];
  for (const [key, val] of Object.entries(tree)) {
    if (val != null && typeof val === "object") out.push(`${indent}${key} {\n${serialize(val, `${indent}  `)}\n${indent}}`);
    else if (val != null) out.push(`${indent}${key}: ${String(val)};`);
  }
  return out.join("\n");
}

export interface RegistryCss {
  cssVars?: { theme?: Record<string, string>; light?: Record<string, string>; dark?: Record<string, string> };
  css?: CssTree;
}

export function registryCss(item: RegistryCss): string {
  const parts = [
    block("@theme inline", item.cssVars?.theme),
    block(":root", item.cssVars?.light),
    block(".dark", item.cssVars?.dark),
    item.css ? serialize(item.css) : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}
