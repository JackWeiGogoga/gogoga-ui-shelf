import { TextFileView, TFile, type WorkspaceLeaf } from "obsidian";
import { locale, t } from "../i18n";
import { icon } from "../icon";
import { VOCABULARY } from "../core/tags";
import { PreviewBlock } from "../preview/block";
import type UiShelfPlugin from "../main";

export const GALLERY_VIEW = "ui-shelf-gallery";
/** 画廊文件的扩展名。文件内容是这个画廊的筛选和明暗（JSON），可以建多个当「保存的筛选」 */
export const GALLERY_EXT = "uishelf";

type Theme = "auto" | "light" | "dark";
type Layout = "grid" | "list";

interface Entry {
  key: string;
  lib: string;
  libName: string;
  slug: string;
  title: string;
  tier: string;
  tags: string[];
  types: string[];
  discovered: string;
  path: string;
  cover: string;
  description: string;
  /** 搜索用：小写拼好的全部文字（名称、库、描述、标签及其中英文释义） */
  haystack: string;
}

interface State {
  query: string;
  lib: string;
  type: string;
  freeOnly: boolean;
  theme: Theme;
  /** 网格（缩略卡片，点开看详情）还是单列大图 */
  view: Layout;
}

const PAGE = 24;
/** 网格卡片里预览按这个宽度渲染再缩小 */
const TILE_WIDTH = 600;
/** 网格里一次最多同时开始加载几个预览，其余排队 */
const MOUNT_BATCH = 3;

export const DEFAULT_STATE: State = { query: "", lib: "", type: "", freeOnly: false, theme: "auto", view: "grid" };

/** frontmatter 里的值转字符串：只认字符串 / 数字，其他（日期被 YAML 解析成对象等）用后备值 */
const str = (v: unknown, fallback: string): string => (typeof v === "string" || typeof v === "number" ? String(v) : fallback);

/** 标签值 → 人看的名字和搜索用的中英文同义词 */
const TYPE_INFO = new Map(VOCABULARY.filter((d) => d.dim === "type").map((d) => [d.value, d]));
const TAG_WORDS = new Map(VOCABULARY.map((d) => [`ui/${d.dim}/${d.value}`, [d.value, d.en, d.zh, ...(d.zhSynonyms ?? [])].join(" ")]));

/**
 * 组件画廊：像组件库官网首页那样一路往下滚、直接看实时效果。
 * 左边搜索 + 按库 / 类型筛选，右边每个组件一张大卡片。
 * 预览按需挂载：卡片进入视口附近才建 iframe，离开就卸掉，几百个组件也不卡。
 *
 * 画廊是一个 .uishelf 文件（内容是筛选状态的 JSON），这样它能出现在文件列表里、
 * 被 Notebook Navigator 等加进快捷方式；多建几个文件就是几份保存好的筛选。
 */
export class GalleryView extends TextFileView {
  private state: State = { ...DEFAULT_STATE };
  private entries: Entry[] = [];
  private filtered: Entry[] = [];
  private shown = 0;
  private listEl!: HTMLElement;
  private sideEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private observer: IntersectionObserver | null = null;
  private moreObserver: IntersectionObserver | null = null;
  private sentinel: HTMLElement | null = null;
  private blocks = new Map<HTMLElement, PreviewBlock>();
  private cardEntry = new WeakMap<HTMLElement, Entry>();
  /** 网格卡片用的观察器：预加载范围比单列小，一屏本来就有十几个 */
  private tileObserver: IntersectionObserver | null = null;
  private gridEl: HTMLElement | null = null;
  /** 等待挂载的网格卡片（进了视口，还没轮到） */
  private mountQueue: HTMLElement[] = [];
  private mountTimer = 0;
  /** 右侧详情抽屉：正在看的组件 key，空 = 没打开 */
  private peekKey = "";
  private drawerEl: HTMLElement | null = null;
  private scrimEl: HTMLElement | null = null;
  private drawerBlock: PreviewBlock | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: UiShelfPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return GALLERY_VIEW;
  }

  getIcon(): string {
    return "layout-grid";
  }

  getViewData(): string {
    return `${JSON.stringify(this.state, null, 2)}\n`;
  }

  setViewData(data: string): void {
    let parsed: Partial<State> = {};
    try {
      parsed = (JSON.parse(data || "{}") ?? {}) as Partial<State>;
    } catch {
      parsed = {};
    }
    const pick = <K extends keyof State>(k: K, ok: (v: unknown) => boolean): Partial<State> => (ok(parsed[k]) ? { [k]: parsed[k] } : {});
    const isStr = (v: unknown) => typeof v === "string";
    this.state = {
      ...DEFAULT_STATE,
      ...pick("query", isStr),
      ...pick("lib", isStr),
      ...pick("type", isStr),
      ...pick("freeOnly", (v) => typeof v === "boolean"),
      ...pick("theme", (v) => v === "auto" || v === "light" || v === "dark"),
      ...pick("view", (v) => v === "grid" || v === "list"),
    };
    if (!this.listEl) return;
    this.applyTheme();
    this.renderSide();
    this.renderList();
  }

  clear(): void {
    this.state = { ...DEFAULT_STATE };
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("ui-shelf-gallery");
    this.sideEl = root.createDiv({ cls: "usg-side" });
    const main = root.createDiv({ cls: "usg-main" });
    this.listEl = main.createDiv({ cls: "usg-list" });

    this.observer = new IntersectionObserver((records) => this.onIntersect(records), {
      root: main,
      rootMargin: "600px 0px",
    });
    this.tileObserver = new IntersectionObserver((records) => this.onIntersect(records), {
      root: main,
      rootMargin: "200px 0px",
    });
    this.moreObserver = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) this.renderMore();
      },
      { root: main, rootMargin: "1200px 0px" },
    );

    this.registerDomEvent(root, "keydown", (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if (this.peekKey && !typing) {
        if (e.key === "Escape") {
          e.preventDefault();
          this.closePeek();
          return;
        }
        const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
        if (dir) {
          e.preventDefault();
          this.stepPeek(dir);
          return;
        }
      }
      if (e.key === "/" && !typing) {
        e.preventDefault();
        this.searchEl.focus();
        this.searchEl.select();
      } else if (e.key === "Escape" && typing && this.searchEl.value) {
        this.searchEl.value = "";
        this.setQuery("");
      }
    });
    this.registerEvent(this.app.workspace.on("css-change", () => this.applyTheme()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleReload()));

    this.applyTheme();
    this.loadEntries();
    this.renderSide();
    this.renderList();
    void this.loadDescriptions();
  }

  async onClose(): Promise<void> {
    await super.onClose();
    this.observer?.disconnect();
    this.tileObserver?.disconnect();
    this.moreObserver?.disconnect();
    window.clearTimeout(this.mountTimer);
    this.closePeek();
    for (const b of this.blocks.values()) this.removeChild(b);
    this.blocks.clear();
  }

  // ── 数据

  private reloadTimer = 0;
  /** 同步写完笔记后 metadataCache 会多次 resolved：合并成一次刷新，且只在组件数变了时重画 */
  private scheduleReload(): void {
    window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => {
      const before = this.entries.map((e) => e.key).join();
      this.loadEntries();
      if (this.entries.map((e) => e.key).join() === before) return;
      this.renderSide();
      this.renderList();
      void this.loadDescriptions();
    }, 1500);
  }

  private loadEntries(): void {
    const out: Entry[] = [];
    const old = new Map(this.entries.map((e) => [e.key, e.description]));
    for (const [key, st] of Object.entries(this.plugin.data.items)) {
      const file = this.app.vault.getAbstractFileByPath(st.path);
      if (!(file instanceof TFile)) continue;
      const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
      const [lib, ...rest] = key.split("/");
      const tags = (Array.isArray(fm.tags) ? fm.tags : typeof fm.tags === "string" ? [fm.tags] : []).map(String);
      const entry: Entry = {
        key,
        lib,
        libName: str(fm.library, lib),
        slug: rest.join("/"),
        title: str(fm.title, rest.join("/")),
        tier: str(fm.tier, "free"),
        tags,
        types: tags.filter((x) => x.startsWith("ui/type/")).map((x) => x.slice(8)),
        discovered: str(fm.discovered, st.discovered ?? ""),
        path: file.path,
        cover: this.resolveCover(fm.cover, file),
        description: old.get(key) ?? "",
        haystack: "",
      };
      this.index(entry);
      out.push(entry);
    }
    out.sort((a, b) => b.discovered.localeCompare(a.discovered) || a.libName.localeCompare(b.libName) || a.title.localeCompare(b.title));
    this.entries = out;
  }

  private index(e: Entry): void {
    e.haystack = [e.title, e.slug, e.libName, e.lib, e.description, ...e.tags, ...e.tags.map((x) => TAG_WORDS.get(x) ?? "")]
      .join(" ")
      .toLowerCase();
  }

  private resolveCover(raw: unknown, from: TFile): string {
    if (typeof raw !== "string" || !raw.trim()) return "";
    const v = raw.trim();
    if (/^https?:\/\//.test(v)) return v;
    const link = v.replace(/^\[\[|\]\]$/g, "").split("|")[0];
    const file = this.app.metadataCache.getFirstLinkpathDest(link, from.path);
    return file ? this.app.vault.getResourcePath(file) : "";
  }

  /** 描述在源码缓存里：后台读完填进卡片头，也让搜索能搜到描述 */
  private async loadDescriptions(): Promise<void> {
    for (const e of this.entries) {
      if (e.description) continue;
      const item = await this.plugin.readCache(e.lib, e.slug);
      if (!item?.description) continue;
      e.description = item.description.replace(/\s+/g, " ").trim();
      this.index(e);
      this.listEl.querySelector<HTMLElement>(`[data-key="${CSS.escape(e.key)}"] .usg-desc`)?.setText(e.description);
      if (this.peekKey === e.key) this.drawerEl?.querySelector(".usg-desc")?.setText(e.description);
    }
    if (this.state.query) this.renderList();
  }

  private matches(e: Entry, skip?: "lib" | "type"): boolean {
    const s = this.state;
    if (skip !== "lib" && s.lib && e.lib !== s.lib) return false;
    if (skip !== "type" && s.type) {
      if (s.type === "-" ? e.types.length : !e.types.includes(s.type)) return false;
    }
    if (s.freeOnly && e.tier !== "free") return false;
    const words = s.query.toLowerCase().split(/\s+/).filter(Boolean);
    return words.every((w) => e.haystack.includes(w));
  }

  // ── 侧栏

  private renderSide(): void {
    const el = this.sideEl;
    el.empty();

    const head = el.createDiv({ cls: "usg-brand" });
    head.createDiv({ cls: "usg-brand-name", text: "UI Shelf" });
    this.renderThemeSwitch(head);

    const search = el.createDiv({ cls: "usg-search" });
    icon(search.createSpan({ cls: "usg-search-icon" }), "search");
    this.searchEl = search.createEl("input", {
      type: "search",
      attr: { placeholder: t("gallery.search"), spellcheck: "false" },
    });
    this.searchEl.value = this.state.query;
    search.createSpan({ cls: "usg-kbd", text: "/" });
    let timer = 0;
    this.searchEl.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => this.setQuery(this.searchEl.value), 120);
    });

    const free = el.createEl("label", { cls: "usg-toggle" });
    const box = free.createEl("input", { type: "checkbox" });
    box.checked = this.state.freeOnly;
    free.createSpan({ text: t("gallery.freeOnly") });
    box.addEventListener("change", () => this.update({ freeOnly: box.checked }));

    // 库
    const libCounts = new Map<string, { name: string; n: number }>();
    for (const e of this.entries) {
      if (!this.matches(e, "lib")) continue;
      const c = libCounts.get(e.lib) ?? { name: e.libName, n: 0 };
      c.n++;
      libCounts.set(e.lib, c);
    }
    const allLibs = [...new Map(this.entries.map((e) => [e.lib, e.libName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    this.renderFacet(
      el,
      t("gallery.libraries"),
      allLibs.map(([id, name]) => ({ id, label: name, n: libCounts.get(id)?.n ?? 0 })),
      this.state.lib,
      (id) => this.update({ lib: id }),
    );

    // 类型
    const typeCounts = new Map<string, number>();
    let untyped = 0;
    for (const e of this.entries) {
      if (!this.matches(e, "type")) continue;
      if (!e.types.length) untyped++;
      for (const x of e.types) typeCounts.set(x, (typeCounts.get(x) ?? 0) + 1);
    }
    const zh = locale() === "zh";
    const types = [...new Set(this.entries.flatMap((e) => e.types))]
      .map((id) => ({ id, label: TYPE_INFO.get(id) ? (zh ? TYPE_INFO.get(id)!.zh : TYPE_INFO.get(id)!.en) : id, n: typeCounts.get(id) ?? 0 }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    if (this.entries.some((e) => !e.types.length)) types.push({ id: "-", label: t("gallery.untyped"), n: untyped });
    this.renderFacet(el, t("gallery.types"), types, this.state.type, (id) => this.update({ type: id }));

    const foot = el.createDiv({ cls: "usg-foot" });
    const sync = foot.createEl("button", { cls: "usg-foot-btn" });
    icon(sync.createSpan(), "refresh-cw");
    sync.createSpan({ text: t("ribbon.sync") });
    sync.addEventListener("click", () => void this.plugin.syncAll());
    const last = this.plugin.data.lastSync;
    if (last) foot.createDiv({ cls: "usg-foot-note", text: t("settings.lastSync", { time: new Date(last).toLocaleString() }) });
  }

  private renderThemeSwitch(parent: HTMLElement): void {
    const seg = parent.createDiv({ cls: "usg-theme" });
    const opts: [Theme, string, string][] = [
      ["auto", "sun-moon", t("preview.themeAuto")],
      ["light", "sun", t("preview.themeLight")],
      ["dark", "moon", t("preview.themeDark")],
    ];
    for (const [mode, name, label] of opts) {
      const b = seg.createEl("button", { cls: "usg-theme-btn", attr: { "aria-label": label } });
      icon(b, name);
      b.toggleClass("is-active", this.state.theme === mode);
      b.addEventListener("click", () => {
        this.state.theme = mode;
        seg.querySelectorAll(".usg-theme-btn").forEach((x) => x.removeClass("is-active"));
        b.addClass("is-active");
        this.applyTheme();
        this.requestSave();
      });
    }
  }

  private renderFacet(
    parent: HTMLElement,
    heading: string,
    rows: { id: string; label: string; n: number }[],
    active: string,
    pick: (id: string) => void,
  ): void {
    const box = parent.createDiv({ cls: "usg-facet" });
    box.createDiv({ cls: "usg-facet-head", text: heading });
    const list = box.createDiv({ cls: "usg-facet-list" });
    const total = rows.reduce((a, r) => a + r.n, 0);
    const row = (id: string, label: string, n: number) => {
      const b = list.createEl("button", { cls: "usg-facet-row" });
      b.toggleClass("is-active", active === id);
      b.toggleClass("is-empty", n === 0 && active !== id);
      b.createSpan({ cls: "usg-facet-label", text: label });
      b.createSpan({ cls: "usg-facet-n", text: String(n) });
      b.addEventListener("click", () => pick(active === id ? "" : id));
    };
    row("", t("gallery.all"), heading === t("gallery.types") ? this.entries.filter((e) => this.matches(e, "type")).length : total);
    for (const r of rows) row(r.id, r.label, r.n);
  }

  private setQuery(q: string): void {
    this.state.query = q.trim();
    this.renderSideCounts();
    this.renderList();
    this.requestSave();
  }

  /** 搜索时只重画侧栏（保留输入框焦点） */
  private renderSideCounts(): void {
    const focused = document.activeElement === this.searchEl;
    const pos = this.searchEl?.selectionStart ?? null;
    const scroll = this.sideEl.scrollTop;
    this.renderSide();
    this.sideEl.scrollTop = scroll;
    if (focused) {
      this.searchEl.focus();
      if (pos !== null) this.searchEl.setSelectionRange(pos, pos);
    }
  }

  private update(patch: Partial<State>): void {
    this.state = { ...this.state, ...patch };
    this.renderSideCounts();
    this.renderList();
    this.listEl.parentElement?.scrollTo({ top: 0 });
    this.requestSave();
  }

  // ── 主题

  private galleryDark(): boolean {
    if (this.state.theme === "auto") return document.body.classList.contains("theme-dark");
    return this.state.theme === "dark";
  }

  private applyTheme(): void {
    const dark = this.galleryDark();
    this.contentEl.toggleClass("is-dark", dark);
    this.contentEl.toggleClass("is-light", !dark);
    for (const b of this.blocks.values()) b.applyTheme();
    this.drawerBlock?.applyTheme();
  }

  // ── 列表

  private renderList(): void {
    for (const b of this.blocks.values()) this.removeChild(b);
    this.blocks.clear();
    this.observer?.disconnect();
    this.tileObserver?.disconnect();
    this.moreObserver?.disconnect();
    this.mountQueue = [];
    window.clearTimeout(this.mountTimer);
    this.mountTimer = 0;
    this.listEl.empty();
    this.gridEl = null;
    const grid = this.state.view === "grid";
    this.listEl.toggleClass("is-grid", grid);

    this.filtered = this.entries.filter((e) => this.matches(e));
    if (this.peekKey && !this.filtered.some((e) => e.key === this.peekKey)) this.closePeek();
    const head = this.listEl.createDiv({ cls: "usg-list-head" });
    head.createDiv({ cls: "usg-count", text: t("gallery.count", { n: this.filtered.length }) });
    const chips = head.createDiv({ cls: "usg-chips" });
    const chip = (text: string, clear: Partial<State>) => {
      const c = chips.createEl("button", { cls: "usg-chip" });
      c.createSpan({ text });
      icon(c.createSpan({ cls: "usg-chip-x" }), "x");
      c.addEventListener("click", () => {
        if ("query" in clear && this.searchEl) this.searchEl.value = "";
        this.update(clear);
      });
    };
    if (this.state.query) chip(`“${this.state.query}”`, { query: "" });
    if (this.state.lib) chip(this.entries.find((e) => e.lib === this.state.lib)?.libName ?? this.state.lib, { lib: "" });
    if (this.state.type) {
      const info = TYPE_INFO.get(this.state.type);
      chip(this.state.type === "-" ? t("gallery.untyped") : info ? (locale() === "zh" ? info.zh : info.en) : this.state.type, { type: "" });
    }
    if (this.state.freeOnly) chip(t("gallery.freeOnly"), { freeOnly: false });
    this.renderLayoutSwitch(head);

    if (!this.filtered.length) {
      this.listEl.createDiv({ cls: "usg-empty", text: t("gallery.empty") });
      return;
    }
    this.shown = 0;
    this.sentinel = null;
    if (grid) this.gridEl = this.listEl.createDiv({ cls: "usg-grid" });
    this.renderMore();
  }

  private renderLayoutSwitch(parent: HTMLElement): void {
    const seg = parent.createDiv({ cls: "usg-layout" });
    const opts: [Layout, string, string][] = [
      ["grid", "layout-grid", t("gallery.viewGrid")],
      ["list", "layout-list", t("gallery.viewList")],
    ];
    for (const [mode, name, label] of opts) {
      const b = seg.createEl("button", { cls: "usg-layout-btn", attr: { "aria-label": label } });
      icon(b.createSpan(), name);
      b.createSpan({ text: label });
      b.toggleClass("is-active", this.state.view === mode);
      b.addEventListener("click", () => {
        if (this.state.view === mode) return;
        this.closePeek();
        this.update({ view: mode });
      });
    }
  }

  private renderMore(): void {
    if (this.shown >= this.filtered.length) return;
    if (this.sentinel) {
      this.moreObserver?.unobserve(this.sentinel);
      this.sentinel.remove();
    }
    const end = Math.min(this.filtered.length, this.shown + PAGE);
    for (let i = this.shown; i < end; i++) {
      if (this.gridEl) this.renderTile(this.gridEl, this.filtered[i], i);
      else this.renderSection(this.filtered[i], i);
    }
    this.shown = end;
    if (end < this.filtered.length) {
      this.sentinel = this.listEl.createDiv({ cls: "usg-sentinel" });
      this.moreObserver?.observe(this.sentinel);
    }
  }

  private renderSection(e: Entry, i: number): void {
    const sec = this.listEl.createDiv({ cls: "usg-section", attr: { "data-key": e.key } });
    const head = sec.createDiv({ cls: "usg-head" });
    const left = head.createDiv({ cls: "usg-head-text" });
    left.createSpan({ cls: "usg-num", text: String(i + 1).padStart(2, "0") });
    const title = left.createEl("a", { cls: "usg-title", text: e.title, href: "#" });
    title.addEventListener("click", (ev) => {
      ev.preventDefault();
      this.openNote(e);
    });
    left.createSpan({ cls: "usg-desc", text: e.description });
    const meta = head.createDiv({ cls: "usg-head-meta" });
    const lib = meta.createEl("button", { cls: "usg-pill", text: e.libName });
    lib.addEventListener("click", () => this.update({ lib: this.state.lib === e.lib ? "" : e.lib }));
    meta.createSpan({ cls: `usg-pill usg-tier is-${e.tier}`, text: e.tier === "pro" ? t("preview.pro") : t("preview.free") });

    const card = sec.createDiv({ cls: "usg-card" });
    this.cardEntry.set(card, e);
    this.observer?.observe(card);
  }

  private renderTile(parent: HTMLElement, e: Entry, i: number): void {
    const tile = parent.createEl("article", { cls: "usg-tile", attr: { "data-key": e.key } });
    tile.toggleClass("is-peek", e.key === this.peekKey);
    const open = () => this.openPeek(e.key);

    const head = tile.createDiv({ cls: "usg-tile-head" });
    const line = head.createDiv({ cls: "usg-tile-line" });
    line.createSpan({ cls: "usg-tile-title", text: e.title });
    line.createSpan({ cls: "usg-num", text: String(i + 1).padStart(2, "0") });
    head.createDiv({ cls: "usg-desc", text: e.description });
    head.addEventListener("click", open);

    const well = tile.createDiv({ cls: "usg-well" });
    this.cardEntry.set(well, e);
    this.tileObserver?.observe(well);

    const foot = tile.createDiv({ cls: "usg-tile-foot" });
    const lib = foot.createEl("button", { cls: "usg-pill", text: e.libName, attr: { "aria-label": t("gallery.filterLib") } });
    lib.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.update({ lib: this.state.lib === e.lib ? "" : e.lib });
    });
    foot.createSpan({ cls: `usg-pill usg-tier is-${e.tier}`, text: e.tier === "pro" ? t("preview.pro") : t("preview.free") });
    const zh = locale() === "zh";
    const types = e.types.slice(0, 2).map((x) => {
      const info = TYPE_INFO.get(x);
      return info ? (zh ? info.zh : info.en) : x;
    });
    if (types.length) foot.createSpan({ cls: "usg-tile-types", text: types.join(" · ") });
    foot.addEventListener("click", open);
  }

  private onIntersect(records: IntersectionObserverEntry[]): void {
    for (const r of records) {
      const card = r.target as HTMLElement;
      if (r.isIntersecting) {
        if (card.hasClass("usg-well")) this.enqueueMount(card);
        else this.mountCard(card);
      } else {
        this.mountQueue = this.mountQueue.filter((c) => c !== card);
        this.unmountCard(card);
      }
    }
  }

  /** 网格一屏十几个预览：分批挂载，免得同时编译、同时拉一堆 esm.sh 依赖 */
  private enqueueMount(card: HTMLElement): void {
    if (this.blocks.has(card) || this.mountQueue.includes(card)) return;
    this.mountQueue.push(card);
    if (!this.mountTimer) this.drainMounts();
  }

  private drainMounts(): void {
    const batch = this.mountQueue.splice(0, MOUNT_BATCH);
    for (const card of batch) this.mountCard(card);
    this.mountTimer = this.mountQueue.length ? window.setTimeout(() => this.drainMounts(), 160) : 0;
  }

  private mountCard(card: HTMLElement): void {
    if (this.blocks.has(card)) return;
    const e = this.cardEntry.get(card);
    if (!e) return;
    card.empty();
    const host = card.createDiv();
    const tile = card.hasClass("usg-well");
    const block = new PreviewBlock(host, this.plugin, `${e.lib}/${e.slug}`, {
      compact: !tile,
      tile: tile ? TILE_WIDTH : undefined,
      cover: e.cover,
      theme: () => (this.galleryDark() ? "dark" : "light"),
      onOpenNote: () => this.openNote(e),
    });
    this.blocks.set(card, block);
    this.addChild(block);
  }

  /** 离开视口的卡片卸掉 iframe，但保留高度，免得滚动跳动 */
  private unmountCard(card: HTMLElement): void {
    const block = this.blocks.get(card);
    if (!block) return;
    if (!card.hasClass("usg-well")) card.style.minHeight = `${card.offsetHeight}px`;
    this.removeChild(block);
    this.blocks.delete(card);
    card.empty();
  }

  // ── 详情抽屉（网格视图）

  private openPeek(key: string): void {
    const e = this.filtered.find((x) => x.key === key);
    if (!e) return;
    this.peekKey = key;
    this.listEl.querySelectorAll(".usg-tile").forEach((x) => x.toggleClass("is-peek", (x as HTMLElement).dataset.key === key));
    this.listEl.querySelector(`.usg-tile[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });

    if (!this.drawerEl) {
      this.scrimEl = this.contentEl.createDiv({ cls: "usg-scrim" });
      this.scrimEl.addEventListener("click", () => this.closePeek());
      this.drawerEl = this.contentEl.createDiv({ cls: "usg-drawer", attr: { role: "dialog", tabindex: "-1" } });
      requestAnimationFrame(() => {
        this.scrimEl?.addClass("is-open");
        this.drawerEl?.addClass("is-open");
      });
    }
    const d = this.drawerEl;
    if (this.drawerBlock) this.removeChild(this.drawerBlock);
    this.drawerBlock = null;
    d.empty();

    const i = this.filtered.indexOf(e);
    const bar = d.createDiv({ cls: "usg-drawer-bar" });
    const btn = (name: string, label: string, run: () => void, disabled = false) => {
      const b = bar.createEl("button", { cls: "usg-icon-btn", attr: { "aria-label": label } });
      icon(b, name);
      b.disabled = disabled;
      b.addEventListener("click", run);
      return b;
    };
    btn("chevron-up", t("gallery.prev"), () => this.stepPeek(-1), i <= 0);
    btn("chevron-down", t("gallery.next"), () => this.stepPeek(1), i >= this.filtered.length - 1);
    bar.createSpan({ cls: "usg-drawer-pos", text: `${i + 1} / ${this.filtered.length}` });
    bar.createDiv({ cls: "usg-grow" });
    const note = bar.createEl("button", { cls: "usg-ghost" });
    icon(note.createSpan(), "file-text");
    note.createSpan({ text: t("gallery.openNote") });
    note.addEventListener("click", () => this.openNote(e));
    btn("x", t("gallery.close"), () => this.closePeek());

    const body = d.createDiv({ cls: "usg-drawer-body" });
    const head = body.createDiv({ cls: "usg-drawer-head" });
    head.createDiv({ cls: "usg-drawer-title", text: e.title });
    head.createDiv({ cls: "usg-desc", text: e.description });
    const meta = head.createDiv({ cls: "usg-head-meta" });
    meta.createSpan({ cls: "usg-pill", text: e.libName });
    meta.createSpan({ cls: `usg-pill usg-tier is-${e.tier}`, text: e.tier === "pro" ? t("preview.pro") : t("preview.free") });
    const zh = locale() === "zh";
    for (const x of e.types) {
      const info = TYPE_INFO.get(x);
      meta.createSpan({ cls: "usg-pill", text: info ? (zh ? info.zh : info.en) : x });
    }

    const card = body.createDiv({ cls: "usg-card usg-drawer-card" });
    const block = new PreviewBlock(card.createDiv(), this.plugin, `${e.lib}/${e.slug}`, {
      compact: true,
      cover: e.cover,
      theme: () => (this.galleryDark() ? "dark" : "light"),
      onOpenNote: () => this.openNote(e),
    });
    this.drawerBlock = block;
    this.addChild(block);
    d.focus({ preventScroll: true });
  }

  private stepPeek(dir: number): void {
    const i = this.filtered.findIndex((x) => x.key === this.peekKey);
    const next = this.filtered[i + dir];
    if (!next) return;
    // 下一个还没渲染出来（分页）：先把卡片补出来，抽屉才能定位到它
    while (this.shown <= i + dir && this.shown < this.filtered.length) this.renderMore();
    this.openPeek(next.key);
  }

  private closePeek(): void {
    if (this.drawerBlock) this.removeChild(this.drawerBlock);
    this.drawerBlock = null;
    this.peekKey = "";
    this.drawerEl?.remove();
    this.scrimEl?.remove();
    this.drawerEl = null;
    this.scrimEl = null;
    this.listEl?.querySelectorAll(".usg-tile.is-peek").forEach((x) => x.removeClass("is-peek"));
  }

  /** 在新标签页打开笔记，画廊留在原处 */
  private openNote(e: Entry): void {
    const file = this.app.vault.getAbstractFileByPath(e.path);
    if (file instanceof TFile) void this.app.workspace.getLeaf("tab").openFile(file);
  }
}
