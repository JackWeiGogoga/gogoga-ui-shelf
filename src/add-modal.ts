import { Modal, Setting, type App } from "obsidian";
import { makeContext } from "./core/sync";
import { t } from "./i18n";
import type UiShelfPlugin from "./main";
import { detectLibrary } from "./sources";

export class AddLibraryModal extends Modal {
  constructor(
    app: App,
    private plugin: UiShelfPlugin,
    private onDone?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(t("add.title"));
    let value = "";
    let status: HTMLElement;
    const run = async (btn: HTMLButtonElement) => {
      if (!value.trim()) return;
      btn.disabled = true;
      status.setText(t("add.detecting"));
      const lib = await detectLibrary(value.trim(), makeContext(() => undefined));
      btn.disabled = false;
      if (!lib) {
        status.setText(t("add.notFound"));
        return;
      }
      if (await this.plugin.addLibrary(lib)) this.close();
      else status.setText(t("add.exists", { name: lib.name }));
    };
    new Setting(this.contentEl)
      .addText((text) => {
        text.setPlaceholder(t("add.placeholder")).onChange((v) => (value = v));
        text.inputEl.addClass("ui-shelf-url-input");
      })
      .addButton((b) => b.setButtonText(t("add.detect")).setCta().onClick(() => void run(b.buttonEl)));
    status = this.contentEl.createDiv({ cls: "setting-item-description" });
  }

  onClose(): void {
    this.contentEl.empty();
    this.onDone?.();
  }
}
