/**
 * 源码缓存（cache/）和展开的组件代码（code/）放在哪。
 *
 * 这两样是几千个小文件，只给本机的预览和 agent 用。放在 vault 的插件目录里会跟着 vault 同步
 * （iCloud / Obsidian Sync / 网盘），手机上要先把它们全拉下来，vault 打开慢得几乎打不开。
 * 所以电脑端放到 vault 外面：~/.gogoga/ui-shelf/<vault 名>/；手机端没有本机文件系统，仍放插件目录。
 */

import { normalizePath, Platform, type DataAdapter } from "obsidian";

export interface Store {
  /** 根目录：电脑端是绝对路径，手机端是 vault 相对路径 */
  readonly base: string;
  /** 在 vault 外面（绝对路径） */
  readonly external: boolean;
  join(...parts: string[]): string;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  /** 写文件，缺的上级目录自动建 */
  write(path: string, data: string): Promise<void>;
  /** 删目录（连同里面的东西）；不存在就什么也不做 */
  removeDir(path: string): Promise<void>;
}

interface NodeMods {
  fs: typeof import("fs");
  os: typeof import("os");
  path: typeof import("path");
}

function nodeMods(): NodeMods | null {
  if (!Platform.isDesktopApp) return null;
  try {
    // 只在电脑端加载 Node 模块；手机上没有，顶层 import 会让插件整个加载失败
    const req = (window as unknown as { require: (id: string) => unknown }).require;
    return { fs: req("fs") as NodeMods["fs"], os: req("os") as NodeMods["os"], path: req("path") as NodeMods["path"] };
  } catch {
    return null;
  }
}

/** 文件夹名里不能用的字符换掉 */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "vault";
}

class NodeStore implements Store {
  readonly external = true;
  constructor(
    private readonly m: NodeMods,
    readonly base: string,
  ) {}
  join(...parts: string[]): string {
    return this.m.path.join(...parts);
  }
  async exists(path: string): Promise<boolean> {
    try {
      await this.m.fs.promises.access(path);
      return true;
    } catch {
      return false;
    }
  }
  read(path: string): Promise<string> {
    return this.m.fs.promises.readFile(path, "utf8");
  }
  async write(path: string, data: string): Promise<void> {
    await this.m.fs.promises.mkdir(this.m.path.dirname(path), { recursive: true });
    await this.m.fs.promises.writeFile(path, data, "utf8");
  }
  async removeDir(path: string): Promise<void> {
    await this.m.fs.promises.rm(path, { recursive: true, force: true });
  }
}

class AdapterStore implements Store {
  readonly external = false;
  constructor(
    private readonly adapter: DataAdapter,
    readonly base: string,
  ) {}
  join(...parts: string[]): string {
    return normalizePath(parts.join("/"));
  }
  exists(path: string): Promise<boolean> {
    return this.adapter.exists(path);
  }
  read(path: string): Promise<string> {
    return this.adapter.read(path);
  }
  async write(path: string, data: string): Promise<void> {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
    }
    await this.adapter.write(path, data);
  }
  async removeDir(path: string): Promise<void> {
    if (await this.adapter.exists(path)) await this.adapter.rmdir(path, true);
  }
}

export function makeStore(adapter: DataAdapter, vaultName: string, pluginDir: string): Store {
  const m = nodeMods();
  if (m) return new NodeStore(m, m.path.join(m.os.homedir(), ".gogoga", "ui-shelf", safeName(vaultName)));
  return new AdapterStore(adapter, pluginDir);
}

/**
 * 老版本放在插件目录里的 cache/、code/ 搬到 vault 外面。vaultBase 是 vault 的绝对路径。
 * 目标已有同名的就以插件目录里的为准覆盖过去（两边都是同步时写的同一份公开代码）。返回搬了几个目录
 */
export async function migrateIntoStore(store: Store, vaultBase: string, pluginDir: string): Promise<number> {
  const m = nodeMods();
  if (!m || !store.external || !vaultBase) return 0;
  let moved = 0;
  for (const name of ["cache", "code"]) {
    const from = m.path.join(vaultBase, pluginDir, name);
    if (!(await store.exists(from))) continue;
    const to = m.path.join(store.base, name);
    await m.fs.promises.mkdir(store.base, { recursive: true });
    if (!(await store.exists(to))) {
      try {
        await m.fs.promises.rename(from, to);
        moved++;
        continue;
      } catch {
        /* 跨磁盘等情况 rename 不行，走下面的复制 */
      }
    }
    await m.fs.promises.cp(from, to, { recursive: true, force: true });
    await m.fs.promises.rm(from, { recursive: true, force: true });
    moved++;
  }
  return moved;
}
