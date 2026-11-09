import {
  normalizePath,
  Notice,
  Platform,
  PluginSettingTab,
  Setting,
  type App,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";
import { AddLibraryModal } from "./add-modal";
import { t } from "./i18n";
import type UiShelfPlugin from "./main";
import { PRESETS } from "./sources";
import type { LibraryConfig } from "./types";

/**
 * Obsidian 1.13 起有声明式设置：插件给一份清单，Obsidian 来画，设置项进全局的设置搜索。
 * 更早的版本没有，就按同一份清单自己逐项画（renderFallback），不维护两份。做法同 gogoga-mindmap。
 */
function declarative(): boolean {
  return "getControlValue" in PluginSettingTab.prototype;
}

type Key = "rootFolder" | "autoCovers";

export class ShelfSettingTab extends PluginSettingTab {
  /** 来源文件声明的库：要读磁盘，异步取好缓存在这里，取到后刷新一次 */
  private sources: { libs: LibraryConfig[]; errors: string[] } | null = null;

  constructor(
    app: App,
    private plugin: UiShelfPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.loadSources();
    if (declarative()) {
      super.display();
      return;
    }
    this.containerEl.empty();
    renderFallback(this.containerEl, this.getSettingDefinitions(), this);
  }

  private loadSources(): void {
    void this.plugin.sourceLibraries().then((r) => {
      const changed = JSON.stringify([r.libs.map((l) => l.url), r.errors]) !== JSON.stringify([this.sources?.libs.map((l) => l.url), this.sources?.errors]);
      this.sources = r;
      if (changed) this.refresh(false);
    });
  }

  /** 列表变了之后重画。新版用 update()（停在原处）；旧版整页重画 */
  private refresh(reloadSources = true): void {
    if (reloadSources) this.sources = null;
    const tab = this as unknown as { update?: () => void };
    if (declarative() && typeof tab.update === "function") tab.update();
    else {
      this.containerEl.empty();
      renderFallback(this.containerEl, this.getSettingDefinitions(), this);
    }
    if (reloadSources) this.loadSources();
  }

  getControlValue(key: string): unknown {
    return (this.plugin.data as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const data = this.plugin.data;
    if ((key as Key) === "rootFolder") data.rootFolder = normalizePath(String(value).trim() || "UI Shelf");
    else if ((key as Key) === "autoCovers") data.autoCovers = Boolean(value);
    await this.plugin.save();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const data = this.plugin.data;
    const presets = PRESETS.filter((p) => !data.libraries.some((l) => l.id === p.id));
    const sources = this.sources;

    const libraryRow = (lib: LibraryConfig): SettingDefinition => ({
      name: lib.name,
      desc: `${lib.kind} · ${lib.url}`,
      render: (setting) => {
        setting
          .addToggle((tg) =>
            tg.setValue(lib.enabled).onChange(async (v) => {
              lib.enabled = v;
              await this.plugin.save();
            }),
          )
          .addExtraButton((b) =>
            b
              .setIcon("trash-2")
              .setTooltip(`${t("settings.remove")} — ${t("settings.removeDesc")}`)
              .onClick(async () => {
                data.libraries = data.libraries.filter((l) => l !== lib);
                await this.plugin.save();
                this.refresh();
              }),
          );
      },
    });

    return [
      {
        type: "group",
        items: [
          { name: t("settings.folder"), desc: t("settings.folderDesc"), control: { type: "text", key: "rootFolder", placeholder: "UI Shelf" } },
          {
            name: t("settings.syncNow"),
            desc: data.lastSync ? t("settings.lastSync", { time: new Date(data.lastSync).toLocaleString() }) : t("settings.never"),
            render: (setting) => {
              setting.addButton((b) =>
                b
                  .setButtonText(t("settings.syncNow"))
                  .setCta()
                  .onClick(async () => {
                    await this.plugin.syncAll();
                    this.refresh();
                  }),
              );
            },
          },
          { name: t("settings.autoCovers"), desc: t("settings.autoCoversDesc"), control: { type: "toggle", key: "autoCovers" } },
        ],
      },
      {
        type: "group",
        heading: t("settings.libraries"),
        items: [
          ...data.libraries.map(libraryRow),
          {
            name: t("settings.add"),
            desc: t("settings.addDesc"),
            render: (setting) => {
              setting.addButton((b) => b.setButtonText(t("settings.add")).onClick(() => new AddLibraryModal(this.app, this.plugin, () => this.refresh()).open()));
            },
          },
        ],
      },
      ...(presets.length
        ? [
            {
              type: "group" as const,
              heading: t("settings.presets"),
              items: presets.map(
                (p): SettingDefinition => ({
                  name: p.name,
                  desc: `${p.homepage} — ${t("settings.presetsDesc")}`,
                  render: (setting) => {
                    setting.addButton((b) =>
                      b.setButtonText(t("settings.addPreset")).onClick(async () => {
                        await this.plugin.addLibrary({ ...p });
                        this.refresh();
                      }),
                    );
                  },
                }),
              ),
            },
          ]
        : []),
      {
        type: "group",
        heading: t("settings.sourceFiles"),
        items: [
          { name: t("settings.sourceFiles"), desc: t("settings.sourceFilesDesc"), render: () => undefined },
          ...(sources?.libs ?? []).map(
            (lib): SettingDefinition => ({
              name: lib.name,
              desc: `${lib.manifest?.use?.kind ?? (lib.manifest?.index ? "index" : "list")} · ${lib.url}`,
              render: () => undefined,
            }),
          ),
          ...(sources?.errors ?? []).map((e): SettingDefinition => ({ name: "⚠️", desc: e, render: () => undefined })),
          ...(sources && !sources.libs.length && !sources.errors.length
            ? [{ name: t("settings.sourceFilesNone"), render: () => undefined } satisfies SettingDefinition]
            : []),
        ],
      },
      {
        type: "group",
        heading: t("settings.agent"),
        items: [
          {
            name: t("settings.agentSkill"),
            desc: t("settings.agentSkillDesc"),
            aliases: ["agent", "skill", "Claude Code"],
            render: (setting) => {
              setting
                .addButton((b) =>
                  b.setButtonText(t("settings.agentCopy")).onClick(async () => {
                    await navigator.clipboard.writeText(this.plugin.skillText());
                    new Notice(t("notice.copied"));
                  }),
                )
                .addButton((b) => {
                  b.setButtonText(t("settings.agentInstall")).onClick(async () => {
                    try {
                      const file = await this.plugin.installSkill();
                      new Notice(t("settings.agentInstalled", { path: file }), 8000);
                    } catch (e) {
                      new Notice(`❌ ${(e as Error).message}`, 8000);
                    }
                  });
                  if (!Platform.isDesktopApp) b.setDisabled(true);
                });
            },
          },
        ],
      },
      {
        type: "group",
        heading: t("settings.network"),
        items: [{ name: t("settings.network"), desc: t("settings.networkDesc"), render: () => undefined }],
      },
    ];
  }
}

/**
 * 旧版 Obsidian（没有声明式设置）：按清单逐项画。分组画成小标题；
 * 控件只有清单里用到的两种（开关、文字），其余是 render 自己画
 */
function renderFallback(el: HTMLElement, items: readonly unknown[], tab: ShelfSettingTab): void {
  for (const raw of items) {
    const item = raw as SettingDefinitionItem;
    if ("type" in item && (item.type === "group" || item.type === "list" || item.type === "page")) {
      const heading = item.type === "page" ? item.name : item.heading;
      if (heading) new Setting(el).setName(heading).setHeading();
      renderFallback(el, item.items ?? [], tab);
      continue;
    }
    const def = item as SettingDefinition;
    const setting = new Setting(el).setName(def.name);
    if (def.desc) setting.setDesc(def.desc);
    if (def.render) {
      def.render(setting, undefined as never);
      continue;
    }
    const c = def.control;
    if (!c) continue;
    const value = tab.getControlValue(c.key);
    const set = (v: unknown) => void tab.setControlValue(c.key, v);
    if (c.type === "toggle") setting.addToggle((tg) => tg.setValue(Boolean(value)).onChange(set));
    else if (c.type === "text") setting.addText((tx) => tx.setPlaceholder(c.placeholder ?? "").setValue(typeof value === "string" ? value : "").onChange(set));
  }
}
