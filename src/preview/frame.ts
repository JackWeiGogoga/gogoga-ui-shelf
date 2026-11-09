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

/** 资源加载失败时 window error 事件给的是 Event，不是 Error：说清楚是哪个资源 */
function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
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
  window.addEventListener("error", (e) => showError(e instanceof ErrorEvent ? (e.error ?? e.message) : e));
  window.addEventListener("unhandledrejection", (e) => showError(e.reason));
  const start = () => {
    new ResizeObserver(report).observe(document.body);
    report();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
}
