/**
 * 浏览器能容忍多余的 `}`，Tailwind 的解析器会直接报「Missing opening {」整份样式作废
 * （beautifului 的 foundation.css 就有一处）。跳过注释和字符串，丢掉多余的 `}`、补齐缺的。
 */
export function balanceBraces(css: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch && css[j] !== "\n") j += css[j] === "\\" ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      if (depth === 0) continue;
      depth--;
    }
    out += ch;
  }
  return out + "}".repeat(depth);
}

/** 多个 CSS 文件合并给 Tailwind：逐个修括号、去重，带 `@import "tailwindcss"` 的放最前。 */
export function joinTailwindCss(files: string[]): string {
  const uniq = [...new Set(files.map((c) => balanceBraces(c)))];
  const isBase = (c: string) => /@import\s+["']tailwindcss["']/.test(c);
  return [...uniq.filter(isBase), ...uniq.filter((c) => !isBase(c))].join("\n\n");
}
