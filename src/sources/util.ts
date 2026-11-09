/**
 * 源码里导出的组件名（首字母大写），函数优先。认这几种写法：
 *   export function X / export default function X / export const X = …
 *   const X = forwardRef(…); export { X, Y as Z }      ← magicui、shadcn 官方组件常见
 *   export default X
 */
export function componentExports(code: string): string[] {
  const fns: string[] = [];
  const others: string[] = [];
  const add = (list: string[], name: string) => {
    if (!/^[A-Z]/.test(name) || /^[A-Z0-9_]+$/.test(name)) return; // 小写不是组件；LATTICE_VARIANTS 之类是常量
    if (!fns.includes(name) && !others.includes(name)) list.push(name);
  };
  let m: RegExpExecArray | null;
  const decl = /export\s+(?:default\s+)?(function|const|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = decl.exec(code))) add(m[1] === "function" ? fns : others, m[2]);
  const list = /export\s*\{([^}]*)\}/g;
  while ((m = list.exec(code))) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (name && name !== "default") add(others, name);
    }
  }
  const def = /export\s+default\s+([A-Z][\w$]*)\s*;?\s*$/m.exec(code);
  if (def) add(others, def[1]);
  return [...fns, ...others];
}

export function firstExport(code: string): string | null {
  return componentExports(code)[0] ?? null;
}

/** kebab-case → PascalCase，用来在多个导出里挑出和组件同名的那个。 */
export function pascal(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
}

/** 和组件名最接近的导出：完全同名 > 前缀相同 > 第一个。 */
export function pickExport(code: string, slug: string): string | null {
  const names = componentExports(code);
  if (!names.length) return null;
  const want = pascal(slug).toLowerCase();
  return (
    names.find((n) => n.toLowerCase() === want) ??
    names.find((n) => n.toLowerCase().startsWith(want) || want.startsWith(n.toLowerCase())) ??
    names[0]
  );
}

export function dirOf(url: string): string {
  return url.replace(/[^/]*$/, "");
}

/** 按 prop 名猜一个演示值；猜不出的必填 prop 不传（组件报错时会显示原因）。 */
const SAMPLE_TEXT = "Here is a short streamed answer, so you can see how the text looks and moves.";
function sampleFor(prop: string, title: string): unknown {
  const p = prop.toLowerCase();
  if (p === "code" || p === "source") return 'const greeting = "hello";\nconsole.log(greeting);';
  if (p === "lang" || p === "language") return "ts";
  if (["text", "content", "message", "body", "description", "markdown"].includes(p)) return SAMPLE_TEXT;
  if (["children", "label", "title", "name", "placeholder", "value", "heading"].includes(p)) return title;
  return undefined;
}

/** 解析 `{ a, b = 1 }: { a: string; b?: number }` 或 `: Props`（同文件里的 interface/type） */
function typeKeys(code: string, annotation: string): Map<string, boolean> {
  let body = annotation.trim();
  if (!body.startsWith("{")) {
    const name = body.replace(/[^\w].*$/s, "");
    const m = new RegExp(`(?:interface\\s+${name}(?:\\s+extends[^{]*)?|type\\s+${name}\\s*=)\\s*\\{`).exec(code);
    if (!m) return new Map();
    body = code.slice(m.index + m[0].length - 1);
  }
  // 取第一层花括号内容
  let depth = 0;
  let end = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const inner = body.slice(1, end);
  const out = new Map<string, boolean>();
  let d = 0;
  let line = "";
  const take = () => {
    const m = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*:/.exec(line.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""));
    if (m) out.set(m[1], m[2] !== "?");
    line = "";
  };
  for (const ch of inner) {
    if ("{([<".includes(ch)) d++;
    if ("})]>".includes(ch)) d--;
    if (d === 0 && (ch === ";" || ch === "\n" || ch === ",")) take();
    else line += ch;
  }
  take(); // 最后一个字段后面可以没有分号
  return out;
}

export interface PropsInfo {
  required: string[];
  optional: string[];
  /** 有 `...props` 透传 */
  rest: boolean;
}

/** 从 `function Name({ a, b = 1, ...rest }: Props)` 解析出必填 / 可选 props；不是这种写法返回 null。 */
export function propsInfo(code: string, exportName: string): PropsInfo | null {
  // function X({ … }) / const X = ({ … }) => / const X = React.forwardRef<…>(({ … }, ref) =>
  const m =
    new RegExp(`function\\s+${exportName}\\s*(?:<[^>]*>)?\\(\\s*\\{`).exec(code) ??
    new RegExp(`(?:const|let)\\s+${exportName}\\s*(?::[^=]+)?=\\s*(?:React\\.)?(?:forwardRef|memo)?\\s*(?:<[^(]*>)?\\(?\\s*\\(\\s*\\{`).exec(code);
  if (!m) {
    // 无参组件 `function Name()` / `const Name = () =>` 也算解析成功
    return new RegExp(`(?:function\\s+${exportName}\\s*\\(\\s*\\)|${exportName}\\s*=\\s*\\(\\s*\\)\\s*=>)`).test(code)
      ? { required: [], optional: [], rest: false }
      : null;
  }
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  for (; i < code.length && depth; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth--;
  }
  const destructure = code.slice(start, i - 1);
  const rest = code.slice(i);
  const ann = /^\s*:\s*/.exec(rest);
  const types = ann ? typeKeys(code, rest.slice(ann[0].length)) : new Map<string, boolean>();

  const info: PropsInfo = { required: [], optional: [], rest: false };
  let d = 0;
  let part = "";
  const flush = () => {
    const p = part.trim();
    part = "";
    if (!p) return;
    if (p.startsWith("...")) {
      info.rest = true;
      return;
    }
    const name = /^([A-Za-z_$][\w$]*)/.exec(p)?.[1];
    if (!name) return;
    const hasDefault = /=/.test(p.replace(/=>/g, ""));
    const required = !hasDefault && (types.get(name) ?? !types.size);
    (required ? info.required : info.optional).push(name);
  };
  for (const ch of destructure) {
    if ("{([".includes(ch)) d++;
    if ("})]".includes(ch)) d--;
    if (ch === "," && d === 0) flush();
    else part += ch;
  }
  flush();
  return info;
}

export function demoProps(code: string, exportName: string, title: string): Record<string, unknown> | undefined {
  const info = propsInfo(code, exportName);
  if (!info) return undefined;
  const props: Record<string, unknown> = {};
  for (const name of info.required) {
    const v = sampleFor(name, title);
    if (v !== undefined) props[name] = v;
  }
  // Button 这类基础组件靠 ...props 透传 children，不给就是个空按钮；
  // 但透传到 <input> / <textarea> / <img> 这类空元素上会报错（React #137），那种不给
  const mentionsChildren = info.required.includes("children") || info.optional.includes("children");
  const voidTarget = /<(input|textarea|img|select|hr|br)\b/.test(code);
  if (info.rest && !mentionsChildren && !voidTarget && props.children === undefined) props.children = title;
  return Object.keys(props).length ? props : undefined;
}

/** 一个可以切换的属性：预览下方显示一排按钮（像官方 gallery 的 tab），也写进接入信息 */
export interface PropChoice {
  prop: string;
  options: string[];
  /** 默认值（解构默认值 / cva defaultVariants / 第一个） */
  value: string;
}

/** 从 `{ … }` 开头的位置取出第一层花括号里的文本 */
function braceBody(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(open + 1, i);
  }
  return "";
}

/** 对象字面量第一层的键（`Drive: …`、`"ghost": …`） */
function objectKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let line = "";
  const take = () => {
    const m = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*(["']?)([A-Za-z0-9_-]+)\1\s*:/.exec(line.replace(/\/\/.*$/gm, ""));
    if (m) keys.push(m[2]);
    line = "";
  };
  for (const ch of body) {
    if ("{([".includes(ch)) depth++;
    if ("})]".includes(ch)) depth--;
    if (depth === 0 && ch === ",") take();
    else if (depth >= 0) line += depth === 0 || "{([".includes(ch) ? ch : depth > 0 ? "" : ch;
  }
  take();
  return keys;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SKIP_PROPS = /^(children|className|style|id|key|ref|on[A-Z].*|labels?|text|content|title|name|placeholder|src|href)$/;

/**
 * 推出组件哪些属性有一组固定取值。来源：
 *   类型里的联合类型 `variant?: "a" | "b"`；比较 `variant === "x"` / switch case；
 *   查找表 `PATTERNS[variant]` 的键；cva 的 `variants: { variant: { … } }`。再加上默认值本身。
 * 只返回推得出 2～12 个取值的属性。
 */
export function propChoices(code: string, exportName: string): PropChoice[] {
  const info = propsInfo(code, exportName);
  if (!info) return [];
  const defaults = stringDefaults(code, exportName);
  const cvaDefaults: Record<string, string> = {};
  const dv = /defaultVariants\s*:\s*\{/.exec(code);
  if (dv) {
    const body = braceBody(code, dv.index + dv[0].length - 1);
    for (const m of body.matchAll(/(\w+)\s*:\s*["']([^"']+)["']/g)) cvaDefaults[m[1]] = m[2];
  }
  const out: PropChoice[] = [];
  for (const prop of [...info.required, ...info.optional]) {
    if (SKIP_PROPS.test(prop)) continue;
    const p = esc(prop);
    const opts = new Set<string>();
    // 联合类型
    const union = new RegExp(`\\b${p}\\??\\s*:\\s*((?:["'][^"']+["']\\s*\\|?\\s*){2,})`).exec(code);
    if (union) for (const m of union[1].matchAll(/["']([^"']+)["']/g)) opts.add(m[1]);
    // switch (prop) { case "x": … }
    const sw = new RegExp(`switch\\s*\\(\\s*${p}\\s*\\)\\s*\\{`).exec(code);
    if (sw) for (const m of braceBody(code, sw.index + sw[0].length - 1).matchAll(/case\s+["']([^"']+)["']/g)) opts.add(m[1]);
    // 查找表 TABLE[prop]
    for (const m of code.matchAll(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*\\[\\s*${p}\\s*\\]`, "g"))) {
      const decl = new RegExp(`(?:const|let|var)\\s+${esc(m[1])}\\b[^=]*=\\s*\\{`).exec(code);
      if (decl) for (const k of objectKeys(braceBody(code, decl.index + decl[0].length - 1))) opts.add(k);
    }
    // cva：variants: { prop: { a: …, b: … } }
    const variants = /variants\s*:\s*\{/.exec(code);
    if (variants) {
      const vbody = braceBody(code, variants.index + variants[0].length - 1);
      const inner = new RegExp(`(?:^|[\\s,{])${p}\\s*:\\s*\\{`).exec(vbody);
      if (inner) for (const k of objectKeys(braceBody(vbody, inner.index + inner[0].length - 1))) opts.add(k);
    }
    // 比较放在最后：有序的定义（类型、查找表、cva）先排，判断里额外出现的值补在后面
    // 比较
    // `typeof prop === "string"` 是类型判断，不是取值，跳过
    for (const m of code.matchAll(new RegExp(`(typeof\\s+)?\\b${p}\\s*[!=]==?\\s*["']([^"']+)["']`, "g"))) if (!m[1]) opts.add(m[2]);
    for (const m of code.matchAll(new RegExp(`["']([^"']+)["']\\s*[!=]==?\\s*${p}\\b`, "g"))) opts.add(m[1]);
    const value = defaults[prop] ?? cvaDefaults[prop];
    if (value) opts.add(value);
    const options = [...opts].filter((o) => o.length <= 40);
    if (options.length >= 2 && options.length <= 12) out.push({ prop, options, value: value ?? options[0] });
  }
  return out;
}

/** 解构里的字符串默认值：`variant = "Drive"` */
function stringDefaults(code: string, exportName: string): Record<string, string> {
  const m =
    new RegExp(`function\\s+${exportName}\\s*(?:<[^>]*>)?\\(\\s*\\{`).exec(code) ??
    new RegExp(`(?:const|let)\\s+${exportName}\\s*(?::[^=]+)?=\\s*(?:React\\.)?(?:forwardRef|memo)?\\s*(?:<[^(]*>)?\\(?\\s*\\(\\s*\\{`).exec(code);
  if (!m) return {};
  const body = braceBody(code, m.index + m[0].length - 1);
  const out: Record<string, string> = {};
  for (const d of body.matchAll(/(\w+)\s*=\s*["']([^"']*)["']/g)) out[d[1]] = d[2];
  return out;
}
