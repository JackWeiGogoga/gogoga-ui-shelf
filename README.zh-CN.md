# gogoga UI Shelf

[English](https://github.com/JackWeiGogoga/gogoga-ui-shelf/blob/main/README.md) | **简体中文**

在 Obsidian 里收藏 UI 组件库。每个组件都是一篇笔记，带标签、接入说明，还有一个在笔记里**真实运行组件代码的实时预览**。写代码的 agent 能直接读这个组件库、挑组件，也能自己添加新的组件库。

界面跟随 Obsidian 的语言设置：Obsidian 设为中文时显示简体中文，否则显示英文。

## 能做什么

- **每个组件一篇笔记**：介绍、实时预览、免费 / 付费、标签、安装命令，以及「Use it」一节：样式方案、npm 依赖、前置条件、导出名、必填 props 和用法示例。
- **实时预览**：React、Tailwind、CSS Modules、纯 HTML/CSS/JS 组件都在笔记里的沙箱中真实运行。可以切换明暗、重放动画、查看和复制代码。组件库提供官方 demo 时，预览渲染的就是 demo。
- **层级标签**：`ui/type/…`（它是什么）、`ui/scene/…`（用在哪里）、`ui/motion/…`（怎么动）、`ui/style/…`（长什么样）。新组件入库时按规则打一次，之后你改过的不会被覆盖。
- **组件画廊**：像组件库官网首页那样，一个页面往下滚就能看到每个组件的实时效果。支持搜索（中文类型名也能搜，比如「输入框」）、按库 / 类型 / 只看免费筛选、整页切换明暗，每个预览下方还能切换变体（尺寸、样式等）。预览滚到附近才加载，几百个组件也不卡。从左侧功能区图标或命令「打开组件画廊」进入。画廊是一个文件 `<目录>/Gallery.uishelf`，会记住筛选和明暗，所以能在 Notebook Navigator 这类文件浏览器里加快捷方式；复制几份就是几份保存好的筛选。
- **也能用 Bases 浏览**：带封面的卡片墙（组件库没有缩略图时自动截图生成）、最新、本周新增、按类型、按库、只看免费、待分类。
- **付费组件不越界**：Pro 组件只保存元数据和官方页面链接，绝不抓取或还原它们的代码。
- **为 agent 设计**：`catalog.json` 列出每个组件的全部接入信息；附带的 agent skill 说明怎么查找、使用和添加组件库；agent 添加新库只需写一个小小的来源文件，再读同步报告。

## 安装

### 用 BRAT

在社区插件里安装并启用 [BRAT](https://github.com/TfTHacker/obsidian42-brat)，在 BRAT 设置里点 **Add beta plugin**，填入 `https://github.com/JackWeiGogoga/gogoga-ui-shelf`，然后在 设置 → 第三方插件 里启用 **gogoga UI Shelf**。

### 手动安装

1. 打开 [Releases 页面](https://github.com/JackWeiGogoga/gogoga-ui-shelf/releases/latest)，下载 **Assets** 里的 `main.js`、`manifest.json`、`styles.css`（不要下 Source code 压缩包）。
2. 放到 `<仓库>/.obsidian/plugins/gogoga-ui-shelf/`。`.obsidian` 是隐藏文件夹：macOS 访达里按 `⌘ ⇧ .` 显示；Windows 在资源管理器的 **查看** 里勾选 **隐藏的项目**。
3. 重启 Obsidian，或在 设置 → 第三方插件 里点刷新，然后启用 **gogoga UI Shelf**。

## 快速开始

1. 设置 → gogoga UI Shelf，选一个目录（默认 `UI Shelf`）。
2. 添加组件库：在「推荐来源」旁点 **添加**，或点 **添加组件库** 粘贴网址（有 shadcn registry 或 `/r` 索引的站点，或 transitions.dev）。默认什么都不加。
3. 第一次同步会生成笔记。点左侧功能区的画廊图标浏览全部组件的实时效果，打开 `UI Shelf.md` 看卡片墙，或打开任意组件笔记。

内置的来源类型：

| 来源 | 读取方式 |
| --- | --- |
| shadcn registry（`/r/registry.json`、`/registry.json`） | 条目、文件、registry 依赖、`cssVars` / `css`、`<name>-demo` 示例；需要授权的条目记为付费 |
| `/r` 索引（AICSS 那种） | 组件清单，加每个组件的 JSON（React / Vue / Svelte 代码） |
| transitions.dev | GitHub 仓库里的组件库 JSON |
| **来源文件**（`<目录>/sources/<id>.source.json`） | 其他任何站点：复用内置类型、映射 JSON 接口或 sitemap，或手写组件清单 |

## 给 agent

每次同步都会写出 `<目录>/agent/SKILL.md`。设置里 **安装到 Claude Code** 会把它复制到 `~/.claude/skills/ui-shelf/`，**复制** 可以把内容给其他 agent。skill 讲两件事：

- **查找和使用组件**：查 `catalog.json`（付费与否、标签、样式方案、依赖、必填 props、用法、本地代码目录），看组件库的许可证，用给出的命令安装或复制本地代码。
- **添加组件库**：调研站点，写 `<目录>/sources/<id>.source.json`，执行 `obsidian command id=gogoga-ui-shelf:sync-latest-source`，读 `<目录>/reports/last-sync.md`，再用 `check-latest-source` 逐个渲染预览并修复失败。运行中报告会显示进度，结束后列出每个问题和修法提示。

来源文件可以按组件覆盖预览（props、入口文件、导出名、跳过）、标签、分类，以及组件页和封面的地址模板。

agent（或你）可以执行的命令：`sync-all`、`sync-sources`、`sync-latest-source`、`check-previews`、`check-sources`、`check-latest-source`、`generate-covers`、`regenerate-covers`、`rebuild-catalog`、`cancel`。

## 预览为什么安全

- 组件代码运行在 `<iframe sandbox="allow-scripts">` 里，页面是插件静态生成的：它有自己独立的源，碰不到你的笔记库、Obsidian 和插件本身。
- 插件用 sucrase 编译 TSX，把模块、CSS 和 import map 写进页面。React、`clsx`、`class-variance-authority`、`tailwind-merge` 已内置，其他 npm 包在沙箱里从 esm.sh 加载。
- 付费组件从不抓取代码，预览显示官方页面。

## 网络访问

- 同步时读取各组件库公开的索引和组件 JSON，以及 GitHub API（查仓库许可证）。
- 预览可能从 `esm.sh` 加载 npm 包；封面在本地生成。
- 不会把任何东西发到别处，也不保存任何 token。

## 你的笔记

- 组件笔记在 `<目录>/components/<库>/<slug>.md`。`<!-- ui-shelf:start -->` 和 `<!-- ui-shelf:end -->` 之间的内容每次同步重写；其余内容和你打的标签都归你。
- `catalog.md`、`catalog.json`、`Tag vocabulary.md`、`agent/SKILL.md`、`reports/last-sync.md` 每次同步重写。`UI Shelf.md` 和 `Components.base` 只在第一次创建，之后归你。
- 免费组件的代码缓存在插件目录（`code/<库>/<slug>/`），文件路径和组件库发布的一致。

## 开发

```bash
pnpm install
pnpm dev          # 监听构建到 dist/
pnpm build        # 类型检查 + 生产构建
pnpm smoke        # 用真实网络检查内置来源、来源文件各模式和接入信息分析
pnpm lint         # Obsidian 插件市场审核用的规则
node esbuild.config.mjs smoke probe && node build/probe.mjs <registry.json 地址>   # 看 shadcn 适配器能从某个 registry 采到什么
```

## 致谢

内置：[React](https://react.dev)（MIT）、[Tailwind CSS 浏览器版](https://tailwindcss.com)（MIT）、[sucrase](https://github.com/alangpierce/sucrase)（MIT）、[html-to-image](https://github.com/bubkoo/html-to-image)（MIT）、[class-variance-authority](https://github.com/joe-bell/cva)、[clsx](https://github.com/lukeed/clsx)、[tailwind-merge](https://github.com/dcastil/tailwind-merge)（MIT）。组件代码归各组件库所有，沿用各自的许可证；使用前请看组件库笔记里的授权说明。

## 许可证

MIT，见 [LICENSE](https://github.com/JackWeiGogoga/gogoga-ui-shelf/blob/main/LICENSE)。
