import { FileSystemAdapter, getLanguage, normalizePath, Notice, Platform, Plugin, TFile } from "obsidian";
import { codeFiles } from "./core/integration";
import { AddLibraryModal } from "./add-modal";
import { skillMarkdown } from "./agent/skill";
import { checkPreview, generateCovers, needsCover, type CoverJob } from "./core/covers";
import { reportMarkdown, type LibReport, type SyncReport } from "./core/report";
import { pathsFor } from "./core/notes";
import { makeContext, syncLibrary, writeIndexes, type SyncHost } from "./core/sync";
import { setLocale, t } from "./i18n";
import { PreviewBlock } from "./preview/block";
import { compileModules, pkgOf, setEsmPeers } from "./preview/build";
import { ShelfSettingTab } from "./settings-tab";
import { PRESETS } from "./sources";
import { manifestToLibrary, parseManifest } from "./sources/manifest";
import type { ComponentItem, ItemState, LibraryConfig } from "./types";

type Scope = "all" | "files" | "latest" | LibraryConfig[];

export interface ShelfData {
  rootFolder: string;
  libraries: LibraryConfig[];
  items: Record<string, ItemState>;
  lastSync: number;
  autoCovers: boolean;
  /** npm 包 → 它依赖的 react / react-dom（决定 esm.sh 地址，见 preview/build.ts esmUrl） */
  esmPeers: Record<string, string[]>;
}

const DEFAULTS: ShelfData = {
  rootFolder: "UI Shelf",
  libraries: [],
  items: {},
  lastSync: 0,
  autoCovers: true,
  esmPeers: {},
};

export default class UiShelfPlugin extends Plugin {
  data: ShelfData = { ...DEFAULTS };
  private syncing = false;
  /** cancel 命令置位，循环里检查 */
  private cancelRequested = false;
  /** 最近一次封面生成的失败明细（排查用：eval 里读 plugin.lastCoverFailures） */
  lastCoverFailures: { key: string; error: string }[] = [];
  private memo = new Map<string, ComponentItem | null>();

  async onload(): Promise<void> {
    setLocale(getLanguage());
    this.data = Object.assign({}, DEFAULTS, (await this.loadData()) as Partial<ShelfData> | null);
    // 预置来源的档案一律以插件内置为准（插件升级时跟着更新，不用设置里存的旧副本）
    for (const lib of this.data.libraries) {
      const preset = PRESETS.find((x) => x.id === lib.id);
      if (preset?.profile) lib.profile = preset.profile;
    }

    setEsmPeers(this.data.esmPeers);

    this.registerMarkdownCodeBlockProcessor("ui-preview", (source, el, ctx) => {
      ctx.addChild(new PreviewBlock(el, this, source));
    });

    this.addRibbonIcon("blocks", t("ribbon.sync"), () => void this.syncAll());
    this.addCommand({ id: "sync-all", name: t("cmd.syncAll"), callback: () => void this.syncAll() });
    this.addCommand({ id: "sync-sources", name: t("cmd.syncSources"), callback: () => void this.syncAll("files") });
    this.addCommand({ id: "sync-latest-source", name: t("cmd.syncLatest"), callback: () => void this.syncAll("latest") });
    this.addCommand({ id: "check-latest-source", name: t("cmd.checkLatest"), callback: () => void this.checkPreviews("latest") });
    this.addCommand({
      id: "cancel",
      name: t("cmd.cancel"),
      callback: () => {
        if (this.syncing) this.cancelRequested = true;
      },
    });
    this.addCommand({ id: "check-previews", name: t("cmd.checkPreviews"), callback: () => void this.checkPreviews() });
    this.addCommand({ id: "check-sources", name: t("cmd.checkSources"), callback: () => void this.checkPreviews("files") });
    this.addCommand({ id: "add-library", name: t("cmd.addLibrary"), callback: () => new AddLibraryModal(this.app, this).open() });
    this.addCommand({ id: "open-home", name: t("cmd.openHome"), callback: () => void this.openHome() });
    this.addCommand({
      id: "rebuild-catalog",
      name: t("cmd.rebuildCatalog"),
      callback: async () => {
        await writeIndexes(this.host(), (await this.allLibraries()).libs.filter((l) => l.enabled));
        new Notice(t("notice.catalogBuilt"));
      },
    });
    this.addCommand({ id: "generate-covers", name: t("cmd.covers"), callback: () => void this.covers(false, true) });
    this.addCommand({ id: "regenerate-covers", name: t("cmd.coversAll"), callback: () => void this.covers(true, true) });
    this.addSettingTab(new ShelfSettingTab(this.app, this));
  }

  async save(): Promise<void> {
    await this.saveData(this.data);
  }

  // ── 源码缓存：插件目录下 cache/<lib>/<slug>.json（只缓存免费组件的公开代码）
  //    同时把代码按原路径展开到 code/<lib>/<slug>/，给 agent 直接读
  private pluginDir(): string {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }

  private cachePath(lib: string, slug: string): string {
    return normalizePath(`${this.pluginDir()}/cache/${lib}/${slug.replace(/[\\/:]/g, "_")}.json`);
  }

  /** 组件代码目录（vault 相对路径） */
  codeDir(lib: string, slug: string): string {
    return normalizePath(`${this.pluginDir()}/code/${lib}/${slug.replace(/[\\/:]/g, "_")}`);
  }

  /** vault 在磁盘上的绝对路径（桌面端），给 agent 拼绝对路径用 */
  vaultBase(): string {
    const a = this.app.vault.adapter;
    return a instanceof FileSystemAdapter ? a.getBasePath() : "";
  }

  async writeCache(lib: string, slug: string, item: ComponentItem): Promise<void> {
    const path = this.cachePath(lib, slug);
    const dir = path.split("/").slice(0, -1).join("/");
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.write(path, JSON.stringify(item));
    this.memo.set(`${lib}/${slug}`, item);
    await this.writeCode(lib, slug, item);
  }

  private async writeCode(lib: string, slug: string, item: ComponentItem): Promise<void> {
    const adapter = this.app.vault.adapter;
    const dir = this.codeDir(lib, slug);
    if (await adapter.exists(dir)) await adapter.rmdir(dir, true);
    for (const f of codeFiles(item)) {
      const path = normalizePath(`${dir}/${f.path}`);
      const parent = path.split("/").slice(0, -1).join("/");
      if (!(await adapter.exists(parent))) await adapter.mkdir(parent);
      await adapter.write(path, f.code);
    }
  }

  async readCache(lib: string, slug: string): Promise<ComponentItem | null> {
    const key = `${lib}/${slug}`;
    if (this.memo.has(key)) return this.memo.get(key) ?? null;
    const path = this.cachePath(lib, slug);
    let item: ComponentItem | null = null;
    try {
      if (await this.app.vault.adapter.exists(path)) item = JSON.parse(await this.app.vault.adapter.read(path)) as ComponentItem;
    } catch {
      item = null;
    }
    this.memo.set(key, item);
    return item;
  }

  host(): SyncHost {
    return {
      app: this.app,
      root: this.data.rootFolder,
      items: this.data.items,
      writeCache: (l, s, i) => this.writeCache(l, s, i),
      readCache: (l, s) => this.readCache(l, s),
      codeDir: (l, s) => this.codeDir(l, s),
      vaultBase: this.vaultBase(),
    };
  }

  /** 来源文件目录（vault 相对路径） */
  sourcesDir(): string {
    return `${pathsFor(this.data.rootFolder).root}/sources`;
  }

  /**
   * vault 里 <root>/sources/*.source.json 声明的组件库。每次同步重新读，agent 改完文件直接同步就行。
   * 直接读磁盘（adapter）而不是 vault 索引：agent 刚写的文件 Obsidian 可能还没索引到，会被漏掉。
   */
  async sourceLibraries(): Promise<{ libs: LibraryConfig[]; errors: string[]; found: number }> {
    const dir = this.sourcesDir();
    const adapter = this.app.vault.adapter;
    const libs: LibraryConfig[] = [];
    const errors: string[] = [];
    if (!(await adapter.exists(dir))) return { libs, errors, found: 0 };
    const files = (await adapter.list(dir)).files.filter((f) => f.endsWith(".source.json")).sort();
    for (const path of files) {
      const { manifest, errors: errs } = parseManifest(await adapter.read(path), path);
      errors.push(...errs);
      if (manifest) libs.push(manifestToLibrary(manifest, path));
    }
    return { libs, errors, found: files.length };
  }

  /** 设置里的 + 文件声明的；id 冲突时设置里的优先，文件那份报错 */
  async allLibraries(): Promise<{ libs: LibraryConfig[]; errors: string[]; found: number }> {
    const { libs: fromFiles, errors, found } = await this.sourceLibraries();
    const libs = [...this.data.libraries];
    for (const l of fromFiles) {
      if (libs.some((x) => x.id === l.id)) errors.push(`${l.url}: id "${l.id}" is already used by another library — pick a different id`);
      else libs.push(l);
    }
    return { libs, errors, found };
  }

  /** 按当前 vault 填好路径的 skill 正文 */
  skillText(): string {
    return skillMarkdown({
      vaultName: this.app.vault.getName(),
      vaultPath: this.vaultBase(),
      root: pathsFor(this.data.rootFolder).root,
      pluginDir: this.pluginDir(),
    });
  }

  /** skill 写进 vault（每次同步覆盖），任何 agent 都能读到 */
  async writeAgentFiles(): Promise<void> {
    const path = `${pathsFor(this.data.rootFolder).root}/agent/SKILL.md`;
    const dir = path.split("/").slice(0, -1).join("/");
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => undefined);
    const file = this.app.vault.getAbstractFileByPath(path);
    const text = this.skillText();
    if (file instanceof TFile) {
      if ((await this.app.vault.read(file)) !== text) await this.app.vault.modify(file, text);
    } else await this.app.vault.create(path, text);
  }

  /** 装到 ~/.claude/skills/ui-shelf/SKILL.md（只在桌面端；Node 模块按需加载，移动端不会碰到） */
  async installSkill(): Promise<string> {
    if (!Platform.isDesktop) throw new Error("Installing the skill needs the desktop app");
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const dir = path.join(os.homedir(), ".claude", "skills", "ui-shelf");
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, "SKILL.md");
    await fs.promises.writeFile(file, this.skillText(), "utf8");
    return file;
  }

  private reportPath(): string {
    return `${pathsFor(this.data.rootFolder).root}/reports/last-sync.md`;
  }

  async writeReport(r: SyncReport): Promise<void> {
    const path = this.reportPath();
    const dir = path.split("/").slice(0, -1).join("/");
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => undefined);
    const file = this.app.vault.getAbstractFileByPath(path);
    const text = reportMarkdown(r);
    if (file instanceof TFile) await this.app.vault.modify(file, text);
    else await this.app.vault.create(path, text);
  }

  /**
   * 预览要从 esm.sh 加载的包：查 npm registry 记下它依赖 react / react-dom 中的哪几个（只查没记过的）。
   * esm.sh 内部就按这个给依赖加 external，我们照做才能和它拿到同一份模块（详见 build.ts esmUrl）。
   */
  private async resolveEsmPeers(progress: (m: string) => void): Promise<void> {
    const pkgs = new Set<string>();
    for (const key of Object.keys(this.data.items)) {
      const [lib, ...rest] = key.split("/");
      const item = await this.readCache(lib, rest.join("/"));
      if (item?.preview?.kind !== "react") continue;
      try {
        for (const spec of compileModules(item.preview.files).remote) pkgs.add(pkgOf(spec));
      } catch {
        /* 编译失败的组件预览时会报错，这里跳过 */
      }
    }
    const todo = [...pkgs].filter((p) => !(p in this.data.esmPeers));
    const ctx = makeContext(() => undefined);
    for (const [i, pkg] of todo.entries()) {
      progress(`npm ${i + 1}/${todo.length}`);
      try {
        const meta = await ctx.fetchJson<{ dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }>(
          `https://registry.npmjs.org/${pkg.replace("/", "%2F")}/latest`,
        );
        const deps = { ...(meta.dependencies ?? {}), ...(meta.peerDependencies ?? {}) };
        this.data.esmPeers[pkg] = ["react", "react-dom"].filter((r) => r in deps);
      } catch {
        /* 查不到（私有包、网络）：不记，预览时按默认规则 */
      }
    }
    setEsmPeers(this.data.esmPeers);
    await this.save();
  }

  /** 同步 / 检查的范围：全部、只来源文件、只最近改过的那个来源文件（agent 调试一个库时用）、或指定的库 */
  private async scopeLibraries(scope: Scope): Promise<{ libs: LibraryConfig[]; all: Awaited<ReturnType<UiShelfPlugin["allLibraries"]>> }> {
    const all = await this.allLibraries();
    let libs: LibraryConfig[];
    if (Array.isArray(scope)) libs = scope;
    else if (scope === "all") libs = all.libs;
    else if (scope === "files") libs = all.libs.filter((l) => l.fromFile);
    else {
      // latest：mtime 最新的那个来源文件
      let best: LibraryConfig | null = null;
      let bestTime = -1;
      for (const l of all.libs.filter((x) => x.fromFile)) {
        const st = await this.app.vault.adapter.stat(l.url);
        if (st && st.mtime > bestTime) {
          bestTime = st.mtime;
          best = l;
        }
      }
      libs = best ? [best] : [];
    }
    return { libs: libs.filter((l) => l.enabled), all };
  }

  /**
   * 跑一次同步 / 检查并维护报告：开始写 running，过程中写进度，异常记进报告，最后一定写 done。
   * （以前异常会跳过最后那次写入，报告永远停在 running——agent 只能干等。）
   */
  private async runReported(
    trigger: string,
    found: number,
    sourceErrors: string[],
    body: (report: SyncReport, notice: Notice) => Promise<void>,
  ): Promise<SyncReport | null> {
    if (this.syncing) {
      new Notice(t("notice.busy"));
      return null;
    }
    this.syncing = true;
    this.cancelRequested = false;
    const report: SyncReport = {
      status: "running",
      trigger,
      started: new Date().toISOString(),
      sourcesDir: this.sourcesDir(),
      sourcesFound: found,
      sourceErrors,
      libraries: [],
      untagged: [],
      unknownTags: [],
    };
    const notice = new Notice(t("notice.syncing"), 0);
    try {
      await this.writeReport(report);
      await body(report, notice);
    } catch (e) {
      console.error("[ui-shelf]", trigger, e);
      report.error = (e as Error).message ?? String(e);
      new Notice(`UI Shelf: ${report.error}`, 10000);
    } finally {
      notice.hide();
      this.syncing = false;
    }
    if (this.cancelRequested) report.error = "cancelled by the cancel command";
    report.status = "done";
    report.progress = undefined;
    report.finished = new Date().toISOString();
    await this.writeReport(report).catch((e) => console.error("[ui-shelf] report", e));
    return report;
  }

  /** 进度写进报告（节流：每 5 个或每 10 秒一次），agent 能看到卡在哪个组件 */
  private progressWriter(report: SyncReport): (stage: string, done: number, total: number, current: string) => Promise<void> {
    let last = 0;
    return async (stage, done, total, current) => {
      report.progress = { stage, done, total, current };
      if (done % 5 === 0 || Date.now() - last > 10000) {
        last = Date.now();
        await this.writeReport(report).catch(() => undefined);
      }
    };
  }

  /**
   * 同步。scope：全部 / 只同步来源文件声明的 / 只同步最近改过的来源文件 / 指定的库。
   * 结束后按设置生成封面（封面生成同时就是新组件的预览检查）。
   */
  async syncAll(scope: Scope = "all"): Promise<void> {
    if (!(await this.app.vault.adapter.exists(this.sourcesDir()))) await this.app.vault.createFolder(this.sourcesDir()).catch(() => undefined);
    const { libs, all } = await this.scopeLibraries(scope);
    const trigger = Array.isArray(scope) ? "sync" : scope === "all" ? "sync" : scope === "files" ? "sync-sources" : "sync-latest-source";
    const errors = scope !== "all" && !Array.isArray(scope) && !all.found ? [`No *.source.json files found in ${this.sourcesDir()}/`, ...all.errors] : all.errors;
    const report = await this.runReported(trigger, all.found, errors, async (report, notice) => {
      if (!libs.length) {
        new Notice(all.errors.length ? t("notice.sourceErrors", { n: all.errors.length }) : t("notice.noLibraries"));
        return;
      }
      const progress = this.progressWriter(report);
      let created = 0;
      const ctx = makeContext((m) => {
        notice.setMessage(t("notice.progress", { message: m }));
        const hit = /^(.*) (\d+)\/(\d+)$/.exec(m);
        if (hit) void progress(`sync ${hit[1]}`, Number(hit[2]), Number(hit[3]), "");
      });
      for (const lib of libs) {
        if (this.cancelRequested) break;
        const entry: LibReport = {
          id: lib.id,
          name: lib.name,
          kind: lib.manifest?.use?.kind ? `manifest→${lib.manifest.use.kind}` : lib.kind,
          from: lib.fromFile ? lib.url : "settings",
          ok: true,
          total: 0,
          free: 0,
          withCode: 0,
          created: [],
          updated: 0,
        };
        try {
          const r = await syncLibrary(this.host(), lib, ctx);
          created += r.created;
          Object.assign(entry, { total: r.total, free: r.free, withCode: r.withCode, created: r.createdSlugs, updated: r.updated });
          new Notice(t("notice.libDone", { name: lib.name, created: r.created, updated: r.updated, total: r.total }), 6000);
        } catch (e) {
          console.error("[ui-shelf]", lib.id, e);
          entry.ok = false;
          entry.error = (e as Error).message;
          new Notice(t("notice.libFailed", { name: lib.name, error: (e as Error).message }), 10000);
        }
        report.libraries.push(entry);
        await this.save();
      }
      await this.resolveEsmPeers((m) => notice.setMessage(t("notice.progress", { message: m })));
      const idx = await writeIndexes(this.host(), all.libs.filter((l) => l.enabled));
      await this.writeAgentFiles();
      report.untagged = idx.untagged;
      report.unknownTags = idx.unknown;
      this.data.lastSync = Date.now();
      await this.save();
      new Notice(t("notice.done", { created }));
      if (idx.untagged.length) new Notice(t("notice.untagged", { n: idx.untagged.length }), 8000);
      if (idx.unknown.length) new Notice(t("notice.unknownTags", { tags: idx.unknown.join(", ") }), 10000);
      if (all.errors.length) new Notice(t("notice.sourceErrors", { n: all.errors.length }), 10000);
      if (this.data.autoCovers && !this.cancelRequested) {
        report.covers = await this.coversInRun(
          false,
          libs.map((l) => l.id),
          (d, total, cur) => void progress("covers", d, total, cur),
        );
      }
    });
    void report;
  }

  /** 把能本地渲染的组件挨个跑一遍，报错写进报告（不改笔记） */
  async checkPreviews(scope: Scope = "all"): Promise<void> {
    const { libs, all } = await this.scopeLibraries(scope);
    const ids = new Set(libs.map((l) => l.id));
    const trigger = scope === "files" ? "check-sources" : scope === "latest" ? "check-latest-source" : "check-previews";
    await this.runReported(trigger, all.found, all.errors, async (report, notice) => {
      report.previews = { checked: 0, failed: [] };
      const progress = this.progressWriter(report);
      const keys = Object.keys(this.data.items).filter((k) => ids.has(k.split("/")[0]));
      for (const [i, key] of keys.entries()) {
        if (this.cancelRequested) break;
        notice.setMessage(t("notice.checking", { done: i, total: keys.length }));
        await progress("check", i, keys.length, key);
        const [lib, ...rest] = key.split("/");
        const item = await this.readCache(lib, rest.join("/"));
        if (!item?.preview) continue;
        report.previews.checked++;
        const err = await checkPreview(item);
        if (err) report.previews.failed.push({ key, error: err });
      }
      // 标签状况每次都重新算，报告不会因为这次没同步就「看起来没问题」
      const idx = await writeIndexes(this.host(), all.libs.filter((l) => l.enabled));
      report.untagged = idx.untagged.filter((k) => ids.has(k.split("/")[0]));
      report.unknownTags = idx.unknown;
      new Notice(t("notice.checked", { checked: report.previews.checked, failed: report.previews.failed.length }), 8000);
    });
  }

  /** 命令：生成 / 重新生成封面（单独跑，也写报告） */
  async covers(force: boolean, verbose: boolean): Promise<void> {
    const { libs, all } = await this.scopeLibraries("all");
    await this.runReported(force ? "regenerate-covers" : "generate-covers", all.found, all.errors, async (report) => {
      const progress = this.progressWriter(report);
      report.covers = await this.coversInRun(force, libs.map((l) => l.id), (d, total, cur) => void progress("covers", d, total, cur));
      if (verbose && !report.covers.made && !report.covers.failed.length) new Notice(t("notice.coversNone"));
    });
  }

  /** 给没有封面的组件生成封面（在一次 run 里调用，不自己管锁）。force：连我们生成过的也重做 */
  private async coversInRun(
    force: boolean,
    libIds: string[],
    progress: (done: number, total: number, current: string) => void,
  ): Promise<NonNullable<SyncReport["covers"]>> {
    const enabled = new Set(libIds);
    const jobs: CoverJob[] = [];
    for (const [key, state] of Object.entries(this.data.items)) {
      const [lib, ...rest] = key.split("/");
      if (!enabled.has(lib)) continue;
      const slug = rest.join("/");
      const item = await this.readCache(lib, slug);
      if (item && needsCover(this.app, { root: this.data.rootFolder, lib, slug, path: state.path, coverFor: state.coverFor, coverFailedFor: state.coverFailedFor }, item, force)) jobs.push({ lib, slug, path: state.path, item });
    }
    if (!jobs.length) return { made: 0, madeFor: {}, failed: [] };
    const notice = new Notice(t("notice.covers", { done: 0, total: jobs.length }), 0);
    try {
      const r = await generateCovers(
        { app: this.app, root: this.data.rootFolder },
        jobs,
        (done, total, current) => {
          notice.setMessage(t("notice.covers", { done, total }));
          progress(done, total, current);
        },
        () => this.cancelRequested,
      );
      this.lastCoverFailures = r.failed;
      for (const [key, h] of Object.entries(r.madeFor)) {
        const st = this.data.items[key];
        if (st) {
          st.coverFor = h;
          delete st.coverFailedFor;
        }
      }
      for (const f of r.failed) if (this.data.items[f.key] && f.previewHash) this.data.items[f.key].coverFailedFor = f.previewHash;
      await this.save();
      new Notice(t("notice.coversDone", { made: r.made }), 6000);
      if (r.failed.length) new Notice(t("notice.coversFailed", { n: r.failed.length, keys: r.failed.map((f) => f.key).join(", ") }), 10000);
      return r;
    } finally {
      notice.hide();
    }
  }

  async addLibrary(lib: LibraryConfig): Promise<boolean> {
    if (this.data.libraries.some((l) => l.id === lib.id || l.url === lib.url)) {
      new Notice(t("add.exists", { name: lib.name }));
      return false;
    }
    this.data.libraries.push(lib);
    await this.save();
    new Notice(t("add.added", { name: lib.name }));
    void this.syncAll([lib]);
    return true;
  }

  async openHome(): Promise<void> {
    const p = pathsFor(this.data.rootFolder);
    const file = this.app.vault.getAbstractFileByPath(p.home);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(t("notice.noLibraries"));
  }
}
