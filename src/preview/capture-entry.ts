/**
 * 生成封面时注入预览 iframe 的脚本：收到 { uiShelf: "capture" } 后把页面画成 webp，
 * 以 data URL 发回插件。只在后台生成封面时注入，平时的预览不带它。
 *
 * 用 html-to-image（SVG foreignObject + 逐元素拷贝计算样式），在沙箱 iframe 里就能完成。
 * 不能用 modern-screenshot / html2canvas：它们要再建一层 iframe 取默认样式或克隆文档，
 * 而沙箱（没有 allow-same-origin）里的子 iframe 是另一个源，读不到。
 *
 * 截完整页后裁到「组件实际占的区域 + 留白」，再补成和官方缩略图一样的比例（transitions 是 592×520），
 * 否则 Bases 卡片按中心裁成方形，宽组件只剩中间一条。
 */
import { toCanvas } from "html-to-image";

const RATIO = 592 / 520;
const PAD = 28;
const PIXEL_RATIO = 1.5;
/** 组件太小（按钮、标签）时也别裁得太紧，不然放大后很糊 */
const MIN_W = 300;

/** 组件实际占的区域（#root 是 display: contents，要看它的子元素） */
function contentRect(): DOMRect | null {
  const els: Element[] = [];
  for (const el of Array.from(document.body.children)) {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.classList.contains("ui-shelf-error")) continue;
    if (el.id === "root") els.push(...Array.from(el.children));
    else els.push(el);
  }
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const el of els) {
    const rc = el.getBoundingClientRect();
    if (rc.width < 1 || rc.height < 1) continue;
    l = Math.min(l, rc.left);
    t = Math.min(t, rc.top);
    r = Math.max(r, rc.right);
    b = Math.max(b, rc.bottom);
  }
  return Number.isFinite(l) ? new DOMRect(l, t, r - l, b - t) : null;
}

/** 内容区加留白、补成目标比例、限制在整页范围内 */
function cropBox(page: { w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const rc = contentRect();
  if (!rc) return { x: 0, y: 0, w: page.w, h: page.h };
  let w = Math.max(rc.width + PAD * 2, MIN_W);
  let h = rc.height + PAD * 2;
  if (w / h > RATIO) h = w / RATIO;
  else w = h * RATIO;
  w = Math.min(w, page.w);
  h = Math.min(h, page.h);
  const cx = rc.left + rc.width / 2;
  const cy = rc.top + rc.height / 2;
  const x = Math.max(0, Math.min(page.w - w, cx - w / 2));
  const y = Math.max(0, Math.min(page.h - h, cy - h / 2));
  return { x, y, w, h };
}

window.addEventListener("message", (e: MessageEvent) => {
  const d = e.data as { uiShelf?: string; width?: number; height?: number; background?: string } | null;
  if (d?.uiShelf !== "capture") return;
  const body = document.body;
  // 页面撑满画布（组件仍然居中），留出补比例需要的上下空间；量布局要等样式生效
  if (d.height) body.style.minHeight = `${d.height}px`;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => shoot(body, d)));
});

function shoot(body: HTMLElement, d: { width?: number; height?: number; background?: string }): void {
  const page = { w: d.width ?? body.scrollWidth, h: Math.max(d.height ?? 0, body.scrollHeight, 1) };
  const box = cropBox(page);
  toCanvas(body, {
    width: page.w,
    height: page.h,
    pixelRatio: PIXEL_RATIO,
    backgroundColor: d.background ?? "#ffffff",
    // 字体已经在页面里，不去下载嵌入
    skipFonts: true,
    // 这里跑在沙箱 iframe 里：没有 Obsidian 给主窗口加的 .instanceOf() / createEl()，只能用原生写法
    filter: (node) => !(node instanceof HTMLElement && node.classList.contains("ui-shelf-error")),
  })
    .then((full) => {
      const out = document.createElement("canvas");
      out.width = Math.round(box.w * PIXEL_RATIO);
      out.height = Math.round(box.h * PIXEL_RATIO);
      out
        .getContext("2d")
        ?.drawImage(full, box.x * PIXEL_RATIO, box.y * PIXEL_RATIO, out.width, out.height, 0, 0, out.width, out.height);
      parent.postMessage({ uiShelf: "cover", data: out.toDataURL("image/webp", 0.86) }, "*");
    })
    .catch((err: unknown) => parent.postMessage({ uiShelf: "cover", error: describeError(err) }, "*"));
}

/** html-to-image 内嵌图片失败时 reject 的是 Event，不是 Error */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err instanceof Event) {
    const t = err.target as (HTMLElement & { src?: string }) | null;
    return `Failed to load ${t?.tagName?.toLowerCase() ?? "resource"}${t?.src ? ` ${t.src.slice(0, 120)}` : ""} while drawing the cover (often a cross-origin image)`;
  }
  return String(err);
}
