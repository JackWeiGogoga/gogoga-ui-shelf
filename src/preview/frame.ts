/**
 * 预览 iframe 和插件之间的小协议（两种预览都用）：
 *   iframe → 插件：{ uiShelf: "height", height } / { uiShelf: "error", message }
 *   插件 → iframe：{ uiShelf: "theme", theme: "light" | "dark" }
 */

export function applyTheme(theme: string): void {
  const html = document.documentElement;
  html.dataset.theme = theme;
  html.classList.toggle("dark", theme === "dark");
  html.style.colorScheme = theme;
}

let last = 0;
export function report(): void {
  const body = document.body;
  if (!body) return;
  const h = Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height));
  if (Math.abs(h - last) < 2) return;
  last = h;
  parent.postMessage({ uiShelf: "height", height: h }, "*");
}

/** 堆栈前几帧（去掉冗长的 esm.sh 查询参数），方便判断错误出在组件自己还是哪个依赖包 */
function stackHint(e: Error): string {
  const frames = (e.stack ?? "")
    .split("\n")
    .slice(1)
    .map((l) => l.trim().replace(/\?[^)\s]*/g, "").replace(/^at\s+/, ""))
    .filter(Boolean)
    .slice(0, 3);
  return frames.length ? `\n  at ${frames.join("\n  at ")}` : "";
}

/** 资源加载失败时 window error 事件给的是 Event，不是 Error：说清楚是哪个资源 */
function describe(e: unknown): string {
  if (e instanceof Error) return e.message + stackHint(e);
  if (e instanceof Event) {
    const t = e.target as (HTMLElement & { src?: string; href?: string }) | null;
    const url = t?.src || t?.href || "";
    return `Failed to load ${t?.tagName?.toLowerCase() ?? "resource"}${url ? ` ${url}` : ""}`;
  }
  return String(e);
}

export function showError(e: unknown): void {
  const message = describe(e);
  // 沙箱 iframe 里没有 Obsidian 的 createEl()，用原生 DOM
  const box = document.createElement("pre");
  box.className = "ui-shelf-error";
  box.textContent = message;
  document.body.appendChild(box);
  parent.postMessage({ uiShelf: "error", message }, "*");
  report();
}

export function installFrame(): void {
  window.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { uiShelf?: string; theme?: string } | null;
    if (d?.uiShelf === "theme" && d.theme) applyTheme(d.theme);
  });
  window.addEventListener("error", (e) => {
    // 浏览器的 ResizeObserver 提示不是组件出错（地图、图表常触发），不显示
    if (e instanceof ErrorEvent && /ResizeObserver loop/.test(e.message)) return;
    showError(e instanceof ErrorEvent ? (e.error ?? e.message) : e);
  });
  window.addEventListener("unhandledrejection", (e) => showError(e.reason));
  const start = () => {
    new ResizeObserver(report).observe(document.body);
    report();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
}
