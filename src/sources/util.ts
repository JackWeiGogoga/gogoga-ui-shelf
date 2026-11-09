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
