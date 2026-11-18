import { loadPrism, Modal, Notice, type App } from "obsidian";
import { t } from "../i18n";
import { icon } from "../icon";
import type { ComponentItem } from "../types";
import { canOpenLocally, existsOnDisk, fileManagerName, isAbsolutePath, openInVSCode, revealInFileManager } from "../desktop";

/** Where the component's files live on disk, if anywhere we can open. */
export interface CodePlaces {
  /** the library author's / your own project folder (`source` when it is a local path) */
  project?: string;
  /** the plugin's expanded copy: <vault>/.obsidian/plugins/…/code/<lib>/<slug> */
  cache?: string;
}

interface CodeFile { path: string; code: string; lang: string }

const LANG: Record<string, string[]> = {
  tsx: ["tsx", "typescript", "jsx", "javascript"],
  ts: ["typescript", "javascript"],
  jsx: ["jsx", "javascript"],
  js: ["javascript"], mjs: ["javascript"], cjs: ["javascript"],
  css: ["css"], scss: ["scss", "css"],
  json: ["json"], html: ["markup"], svg: ["markup"], md: ["markdown"], sh: ["bash"],
};
const extOf = (p: string) => (p.split(".").pop() ?? "").toLowerCase();

type PrismToken = string | { type: string; alias?: string | string[]; content: PrismToken | PrismToken[] };
interface PrismLike {
  languages: Record<string, unknown>;
  tokenize(code: string, grammar: unknown): PrismToken[];
}

/**
 * Code viewer: file list on the left, highlighted source with line numbers on the right,
 * and shortcuts to open the files in VS Code or the file manager (desktop).
 * ↑ / ↓ switch files.
 */
export class CodeModal extends Modal {
  private files: CodeFile[] = [];
  private current = 0;
  private prism: PrismLike | null = null;
  private listEl!: HTMLElement;
  private viewEl!: HTMLElement;

  constructor(
    app: App,
    private item: ComponentItem,
    private places: CodePlaces = {},
  ) {
    super(app);
  }

  onOpen(): void {
    const { item } = this;
    this.modalEl.addClass("ui-shelf-code-modal");
    this.setTitle(item.name);
    this.files = this.collect();

    const actions = this.titleEl.createDiv({ cls: "ui-shelf-code-actions" });
    const folder = this.folder();
    if (folder && canOpenLocally()) {
      this.textButton(actions, "square-code", t("code.openVSCode"), () => openInVSCode(folder));
      this.textButton(actions, "folder-open", t("code.reveal", { app: fileManagerName() }), () => revealInFileManager(this.fileOnDisk(this.files[this.current]) ?? folder));
    }

    const body = this.contentEl.createDiv({ cls: "ui-shelf-code-body" });
    this.listEl = body.createDiv({ cls: "ui-shelf-code-list" });
    this.viewEl = body.createDiv({ cls: "ui-shelf-code-view" });
    if (folder) {
      const where = this.contentEl.createDiv({ cls: "ui-shelf-code-where" });
      where.createSpan({ text: folder === this.places.project ? t("code.project") : t("code.cache") });
      where.createEl("code", { text: folder });
    }

    this.renderList();
    // open on the entry file; the install command stays one click away at the top
    this.select(this.item.install && this.files.length > 1 ? 1 : 0);
    void loadPrism().then((p: PrismLike) => {
      this.prism = p;
      this.select(this.current);
    });

    this.scope.register([], "ArrowDown", () => { this.select(Math.min(this.files.length - 1, this.current + 1)); return false; });
    this.scope.register([], "ArrowUp", () => { this.select(Math.max(0, this.current - 1)); return false; });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /* ───────── data ───────── */

  private collect(): CodeFile[] {
    const p = this.item.preview;
    const raw =
      p?.kind === "html"
        ? [{ path: "index.html", code: p.html }, { path: "style.css", code: p.css }, { path: "script.js", code: p.js }].filter((f) => f.code.trim())
        : p?.kind === "react"
          ? [...p.files, ...(p.tailwindCss ? [{ path: "tailwind.css", code: p.tailwindCss }] : [])]
          : [];
    const entry = p?.kind === "react" ? p.entry : undefined;
    const files = raw
      .map((f) => ({ path: f.path, code: f.code, lang: extOf(f.path) }))
      .sort((a, b) => {
        if (a.path === entry) return -1;
        if (b.path === entry) return 1;
        const da = a.path.includes("/") ? 1 : 0, db = b.path.includes("/") ? 1 : 0;
        return da - db || a.path.localeCompare(b.path);
      });
    if (this.item.install) files.unshift({ path: t("preview.install"), code: this.item.install, lang: "sh" });
    return files;
  }

  private folder(): string | null {
    const { project, cache } = this.places;
    if (project && isAbsolutePath(project) && existsOnDisk(project)) return project;
    if (cache && existsOnDisk(cache)) return cache;
    return null;
  }

  /** Absolute path of a listed file, when it exists on disk. */
  private fileOnDisk(f: CodeFile | undefined): string | null {
    if (!f || f.lang === "sh" && f.path === t("preview.install")) return null;
    const bases = [this.places.project, this.places.cache].filter((b): b is string => !!b && isAbsolutePath(b));
    for (const b of bases) for (const c of [`${b}/${f.path}`, `${b}/src/${f.path}`]) if (existsOnDisk(c)) return c;
    return null;
  }

  /* ───────── list ───────── */

  private renderList(): void {
    const el = this.listEl;
    el.empty();
    let lastDir: string | null = null;
    this.files.forEach((f, i) => {
      const isInstall = i === 0 && !!this.item.install;
      const dir = isInstall ? "" : f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      if (dir && dir !== lastDir) {
        const d = el.createDiv({ cls: "ui-shelf-code-dir" });
        icon(d.createSpan(), "folder");
        d.createSpan({ text: dir });
      }
      lastDir = dir;
      const row = el.createDiv({ cls: "ui-shelf-code-file" + (dir ? " is-nested" : "") + (isInstall ? " is-install" : "") });
      row.dataset.index = String(i);
      icon(row.createSpan({ cls: "ui-shelf-code-icon" }), isInstall ? "terminal" : fileIcon(f.lang));
      row.createSpan({ cls: "ui-shelf-code-name", text: isInstall ? f.path : f.path.split("/").pop() ?? f.path });
      row.addEventListener("click", () => this.select(i));
    });
  }

  private select(i: number): void {
    const f = this.files[i];
    if (!f) return;
    this.current = i;
    this.listEl.querySelectorAll(".ui-shelf-code-file").forEach((r) => r.toggleClass("is-active", (r as HTMLElement).dataset.index === String(i)));
    this.listEl.querySelector(".ui-shelf-code-file.is-active")?.scrollIntoView({ block: "nearest" });

    const v = this.viewEl;
    v.empty();
    const head = v.createDiv({ cls: "ui-shelf-code-filehead" });
    head.createSpan({ cls: "ui-shelf-code-path", text: f.path });
    const lines = f.code.replace(/\n$/, "").split("\n").length;
    head.createSpan({ cls: "ui-shelf-code-meta", text: t("code.lines", { n: String(lines) }) });
    const onDisk = this.fileOnDisk(f);
    if (onDisk && canOpenLocally()) this.iconButton(head, "square-code", t("code.openFileVSCode"), () => openInVSCode(onDisk));
    this.iconButton(head, "copy", t("preview.copy"), () => {
      void navigator.clipboard.writeText(f.code).then(() => new Notice(t("notice.copied")));
    });

    const scroller = v.createDiv({ cls: "ui-shelf-code-scroll" });
    const gutter = scroller.createEl("pre", { cls: "ui-shelf-code-gutter" });
    gutter.setText(Array.from({ length: lines }, (_, k) => String(k + 1)).join("\n"));
    const pre = scroller.createEl("pre", { cls: `ui-shelf-code-pre language-${f.lang}` });
    this.highlightInto(pre.createEl("code"), f);
  }

  private highlightInto(el: HTMLElement, f: CodeFile): void {
    const code = f.code.replace(/\n$/, "");
    const prism = this.prism;
    const name = (LANG[f.lang] ?? []).find((l) => prism?.languages[l]);
    if (!prism || !name) {
      el.setText(code);
      return;
    }
    const put = (parent: HTMLElement, tok: PrismToken | PrismToken[]) => {
      if (Array.isArray(tok)) { tok.forEach((x) => put(parent, x)); return; }
      if (typeof tok === "string") { parent.appendText(tok); return; }
      const alias = Array.isArray(tok.alias) ? tok.alias.join(" ") : tok.alias ?? "";
      put(parent.createSpan({ cls: `token ${tok.type} ${alias}`.trim() }), tok.content);
    };
    put(el, prism.tokenize(code, prism.languages[name]));
  }

  /* ───────── bits ───────── */

  private textButton(parent: HTMLElement, iconName: string, label: string, onClick: () => void): void {
    const b = parent.createEl("button", { cls: "ui-shelf-code-btn" });
    icon(b.createSpan(), iconName);
    b.createSpan({ text: label });
    b.addEventListener("click", onClick);
  }

  private iconButton(parent: HTMLElement, iconName: string, label: string, onClick: () => void): void {
    const b = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
    icon(b, iconName);
    b.addEventListener("click", onClick);
  }
}

function fileIcon(lang: string): string {
  if (["tsx", "jsx", "ts", "js", "mjs", "cjs"].includes(lang)) return "file-code-2";
  if (["css", "scss"].includes(lang)) return "palette";
  if (lang === "json") return "braces";
  if (["html", "svg"].includes(lang)) return "file-code";
  return "file-text";
}
