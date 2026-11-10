/** 来源适配器的种类。新增来源类型时在 sources/index.ts 注册。 */
export type SourceKind = "shadcn" | "r-index" | "transitions" | "manifest";

import type { SourceManifest } from "./sources/manifest";

/**
 * 组件库档案：给人和 agent 判断「能不能用、怎么用」。
 * 预置来源由插件填好；声明式来源由写 source.json 的人（通常是 agent）调研后填。
 */
export interface LibraryProfile {
  description?: string;
  /** SPDX 标识（MIT、Apache-2.0…），或 custom / proprietary / unknown */
  license?: string;
  license_url?: string;
  /** 授权限制的人话总结（能不能商用、能不能再分发、付费部分怎么授权） */
  license_notes?: string;
  /** 价格模式，如 "free"、"free + one-time Pro license" */
  pricing?: string;
  frameworks?: string[];
  styling?: string;
  /** 整个库通用的接入方式（如 shadcn CLI、复制粘贴） */
  install?: string;
  repo?: string;
  docs?: string;
  llms_txt?: string;
  author?: string;
  /** 写给 agent 的注意事项 */
  agent_notes?: string;
}

/** 设置里的一个组件库。id 同时用作目录名和 `ui-preview` 代码块里的前缀。 */
export interface LibraryConfig {
  id: string;
  name: string;
  kind: SourceKind;
  /** 适配器的入口地址：registry.json / `/r` 索引 / library.json 所在仓库 / source.json 路径 */
  url: string;
  homepage: string;
  enabled: boolean;
  profile?: LibraryProfile;
  /** 来自 vault 里的 source.json（不在设置里存） */
  fromFile?: boolean;
  /** kind 为 manifest 时：解析好的 source.json */
  manifest?: SourceManifest;
  /** 内置适配器的可选参数（来源文件 use 模式传入） */
  options?: {
    /** 单个条目 JSON 的地址模板，如 "https://x.dev/registry/{name}.json"；不写则自动探测 */
    itemUrl?: string;
    /** 只收这些 registry 条目类型，默认 registry:ui / registry:component / registry:block */
    include?: string[];
    /** 只收名字匹配这个正则的条目（如 "-react$"：一个效果按框架拆成多个条目时只留 React 版） */
    match?: string;
    /**
     * 列出每个组件 Markdown 文档的页面（如 llms.txt）。registry 没有 `<name>-demo` 时，
     * 从 `…/<name>.md` 的 Usage 代码块里取用法示例当演示
     */
    docsIndex?: string;
    /** 仓库源码的根地址（如 GitHub raw 的 …/main/）：源码 import 的 `@/…` 文件 registry 没给时，按路径到这里补取 */
    repo?: string;
    /** 官方 demo 文件的地址模板（{name}），registry 里没有 `<name>-demo` 时用 */
    demoUrl?: string;
  };
}

export type Tier = "free" | "pro";

export interface SourceFile {
  path: string;
  code: string;
  /** 用 CLI 安装时这个文件落在项目里的位置（shadcn 的 target / 按类型推的路径），没有就用 path */
  target?: string;
}

/**
 * 预览所需的全部材料。
 * - html：现成的 HTML/CSS/JS 片段（transitions.dev）
 * - react：TSX/JSX 源码 + CSS，插件编译后在沙箱里挂载 entry 的导出组件
 */
export type PreviewSpec =
  | { kind: "html"; html: string; css: string; js: string }
  | {
      kind: "react";
      files: SourceFile[];
      entry: string;
      exportName: string;
      /** 需要 Tailwind 时，这些 CSS 交给 Tailwind 浏览器版编译 */
      tailwindCss?: string;
      /** 演示用 props（基础组件如 Button 需要 children 才看得出样子） */
      props?: Record<string, unknown>;
      /**
       * 预览渲染的是官方 demo（如 shadcn registry 的 `<name>-demo`）时，
       * 组件本身的文件和导出名记在这里，接入信息（用法、props）按它算。
       */
      component?: { entry: string; exportName: string };
    };

/** 适配器采集到的一个组件（事实信息，同步时覆盖写入）。 */
export interface ComponentItem {
  slug: string;
  name: string;
  description: string;
  /** 来源网站自带的分类，原样保留，也参与规则打标签 */
  categories: string[];
  tier: Tier;
  frameworks: string[];
  page: string;
  /** 给人和 agent 取代码用的地址（JSON / Markdown） */
  source: string;
  /** 一行安装命令，没有就空 */
  install: string;
  /** 封面图 URL，没有就空 */
  cover: string;
  /** 付费组件、或来源没给代码时为 null，预览退回官方页面 */
  preview: PreviewSpec | null;
  /** 来源文件里 agent 指定的标签（创建笔记时代替规则打的标签） */
  tags?: string[];
}

export interface SyncContext {
  fetchJson<T = unknown>(url: string): Promise<T>;
  fetchText(url: string): Promise<string>;
  /** HEAD 探测是否存在，用于封面图 */
  exists(url: string): Promise<boolean>;
  progress(message: string): void;
}

export interface SourceAdapter {
  kind: SourceKind;
  collect(lib: LibraryConfig, ctx: SyncContext): Promise<ComponentItem[]>;
}

/** 每个组件在 data.json 里的同步状态。 */
export interface ItemState {
  /** 首次发现日期 YYYY-MM-DD，「最新组件」靠它排序 */
  discovered: string;
  /** 上次写入时的内容指纹，未变则不重写 */
  hash: string;
  /** 笔记路径（用户移动过笔记时按这个找回） */
  path: string;
  /** 生成的封面是按哪一版预览截的（previewHash）；预览变了就重新截 */
  coverFor?: string;
  /** 这一版预览截封面失败过（空白、跨域图片…）：预览没变就不再每次同步都重试 */
  coverFailedFor?: string;
}
