import { MarkdownRenderChild, Modal, Notice, setIcon, type App } from "obsidian";
import { t } from "../i18n";
import type { ComponentItem } from "../types";
import { propChoices } from "../sources/util";
import { buildSrcdoc } from "./build";

type ThemeMode = "auto" | "light" | "dark";

export interface PreviewHost {
  app: App;
  readCache(lib: string, slug: string): Promise<ComponentItem | null>;
}

const MIN_H = 140;
const MAX_H = 900;
const OFFICIAL_H = 560;

/**
 * ```ui-preview
 * aicss/thinking-state
 * ```
 * 有源码：编译后放进 sandbox="allow-scripts" 的 srcdoc iframe（不同源，碰不到 vault）。
 * 没源码（付费 / 来源没给）：嵌入官方预览页。
 */
export class PreviewBlock extends MarkdownRenderChild {
  private mode: ThemeMode = "auto";
  private frame: HTMLIFrameElement | null = null;
  private item: ComponentItem | null = null;
  /** 用户在变体切换条上选的值（prop → 值），叠加在演示 props 上 */
  private overrides: Record<string, string> = {};

  constructor(
    el: HTMLElement,
    private host: PreviewHost,
    private ref: string,
  ) {
    super(el);
  }

  onload(): void {
    this.containerEl.addClass("ui-shelf-preview");
    void this.render();
    this.registerDomEvent(window, "message", (e: MessageEvent) => {
      if (!this.frame || e.source !== this.frame.contentWindow) return;
      const d = e.data as { uiShelf?: string; height?: number } | null;
      if (d?.uiShelf === "height" && typeof d.height === "number") {
        this.frame.style.height = `${Math.min(MAX_H, Math.max(MIN_H, d.height))}px`;
      }
    });
    this.registerEvent(this.host.app.workspace.on("css-change", () => this.postTheme()));
  }

  private isDark(): boolean {
    if (this.mode === "auto") return document.body.classList.contains("theme-dark");
    return this.mode === "dark";
  }

  private postTheme(): void {
    if (this.mode !== "auto" || !this.frame?.contentWindow) return;
    this.frame.contentWindow.postMessage({ uiShelf: "theme", theme: this.isDark() ? "dark" : "light" }, "*");
  }

  private async render(): Promise<void> {
    const el = this.containerEl;
    el.empty();
    const ref = this.ref.trim();
    const [lib, ...rest] = ref.split("/");
    const slug = rest.join("/");
    if (!lib || !slug) {
      el.createDiv({ cls: "ui-shelf-message", text: t("preview.empty") });
      return;
    }
    this.item = await this.host.readCache(lib, slug);
    if (!this.item) {
      el.createDiv({ cls: "ui-shelf-message", text: t("preview.missing", { ref }) });
      return;
    }
    this.renderToolbar(el, this.item);
    const stage = el.createDiv({ cls: "ui-shelf-stage" });
    this.mount(stage);
    this.renderVariants(el, this.item);
  }

  private renderToolbar(el: HTMLElement, item: ComponentItem): void {
    const bar = el.createDiv({ cls: "ui-shelf-toolbar" });
    const title = bar.createDiv({ cls: "ui-shelf-title" });
    title.createSpan({ text: item.name });
    title.createSpan({
      cls: `ui-shelf-tier is-${item.tier}`,
      text: item.tier === "pro" ? t("preview.pro") : t("preview.free"),
    });
    const actions = bar.createDiv({ cls: "ui-shelf-actions" });
    const button = (icon: string, label: string, onClick: () => void) => {
      const b = actions.createEl("button", { cls: "clickable-icon ui-shelf-btn", attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return b;
    };
    if (item.preview) {
      const themeIcon = () => (this.mode === "auto" ? "sun-moon" : this.mode === "light" ? "sun" : "moon");
      const themeLabel = () =>
        t("preview.theme", {
          theme: t(this.mode === "auto" ? "preview.themeAuto" : this.mode === "light" ? "preview.themeLight" : "preview.themeDark"),
        });
      const tb = button(themeIcon(), themeLabel(), () => {
        this.mode = this.mode === "auto" ? "light" : this.mode === "light" ? "dark" : "auto";
        setIcon(tb, themeIcon());
        tb.setAttribute("aria-label", themeLabel());
        this.remount();
      });
      button("rotate-ccw", t("preview.replay"), () => this.remount());
      button("code-2", t("preview.code"), () => new CodeModal(this.host.app, item).open());
    }
    button("external-link", t("preview.page"), () => window.open(item.page));
  }

  /**
   * 变体切换条（像官方 gallery 的 tab）：组件有 variant / size 这类固定取值的属性时，
   * 在预览下面列出取值，点一下用新值重新渲染。预览渲染的是官方 demo 时 demo 自己定死了用法，不显示。
   */
  private renderVariants(el: HTMLElement, item: ComponentItem): void {
    const p = item.preview;
    if (p?.kind !== "react" || p.component) return;
    const entry = p.files.find((f) => f.path === p.entry);
    if (!entry) return;
    const choices = propChoices(entry.code, p.exportName);
    if (!choices.length) return;
    const bar = el.createDiv({ cls: "ui-shelf-variants" });
    for (const c of choices) {
      const group = bar.createDiv({ cls: "ui-shelf-variant-group" });
      if (choices.length > 1) group.createSpan({ cls: "ui-shelf-variant-label", text: c.prop });
      const seg = group.createDiv({ cls: "ui-shelf-segmented" });
      const current = () => this.overrides[c.prop] ?? (typeof p.props?.[c.prop] === "string" ? String(p.props[c.prop]) : c.value);
      for (const opt of c.options) {
        const b = seg.createEl("button", { text: opt, cls: "ui-shelf-segment" });
        b.toggleClass("is-active", opt === current());
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.overrides[c.prop] = opt;
          seg.querySelectorAll(".ui-shelf-segment").forEach((x) => x.toggleClass("is-active", x.textContent === opt));
          this.remount();
        });
      }
    }
  }

  private remount(): void {
    const stage = this.containerEl.querySelector<HTMLElement>(".ui-shelf-stage");
    if (stage) this.mount(stage);
  }

  private mount(stage: HTMLElement): void {
    stage.empty();
    const item = this.item;
    if (!item) return;
    const frame = stage.createEl("iframe", { cls: "ui-shelf-frame" });
    this.frame = frame;
    if (!item.preview) {
      // 官方页面是它自己的源，允许同源才能正常运行它的脚本；仍然碰不到 vault
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
      frame.src = item.page;
      frame.style.height = `${OFFICIAL_H}px`;
      stage.createDiv({ cls: "ui-shelf-note", text: t("preview.official") });
      return;
    }
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.height = `${MIN_H}px`;
    const dark = this.isDark();
    const background = this.mode === "auto" ? "transparent" : dark ? "#0b0b0c" : "#ffffff";
    stage.toggleClass("is-solid", this.mode !== "auto");
    try {
      const spec =
        item.preview.kind === "react" && Object.keys(this.overrides).length
          ? { ...item.preview, props: { ...(item.preview.props ?? {}), ...this.overrides } }
          : item.preview;
      frame.srcdoc = buildSrcdoc(spec, { theme: dark ? "dark" : "light", background });
    } catch (e) {
      stage.empty();
      stage.createEl("pre", { cls: "ui-shelf-error", text: (e as Error).message });
    }
  }
}

class CodeModal extends Modal {
  constructor(
    app: App,
    private item: ComponentItem,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, item } = this;
    this.setTitle(item.name);
    contentEl.addClass("ui-shelf-code-modal");
    const files =
      item.preview?.kind === "html"
        ? [
            { path: "index.html", code: item.preview.html },
            { path: "style.css", code: item.preview.css },
            { path: "script.js", code: item.preview.js },
          ].filter((f) => f.code.trim())
        : item.preview?.kind === "react"
          ? [...item.preview.files, ...(item.preview.tailwindCss ? [{ path: "tailwind.css", code: item.preview.tailwindCss }] : [])]
          : [];
    const copy = (text: string) => {
      void navigator.clipboard.writeText(text).then(() => new Notice(t("notice.copied")));
    };
    if (item.install) {
      const row = contentEl.createDiv({ cls: "ui-shelf-code-head" });
      row.createSpan({ text: t("preview.install") });
      row.createEl("button", { text: t("preview.copy") }).addEventListener("click", () => copy(item.install));
      contentEl.createEl("pre").createEl("code", { text: item.install });
    }
    for (const f of files) {
      const row = contentEl.createDiv({ cls: "ui-shelf-code-head" });
      row.createSpan({ text: f.path });
      row.createEl("button", { text: t("preview.copy") }).addEventListener("click", () => copy(f.code));
      contentEl.createEl("pre").createEl("code", { text: f.code });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
