# 更新日志

gogoga UI Shelf 每个版本的主要变化都记在这里。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。English: [CHANGELOG.md](CHANGELOG.md).

## [Unreleased]

第一个版本，尚未发布。

### 新增
- 收藏 UI 组件库：内置 shadcn registry、`/r` 索引（AICSS 那种）和 transitions.dev；其他站点可以用来源文件（`<目录>/sources/<id>.source.json`）描述——复用内置类型、映射 JSON 接口或 sitemap，或手写组件清单。
- 每个组件一篇笔记：介绍、免费 / 付费、标签、安装命令和接入说明（样式方案、npm 依赖、前置条件、导出名、必填 props、用法示例）；免费组件的代码缓存在本地。
- 笔记里的实时预览：React / Tailwind / CSS Modules / HTML 组件在沙箱里真实运行，可切换明暗、重放、看代码；组件库有官方 demo 时用 demo。付费组件显示官方页面，从不抓取代码。
- 层级标签（`ui/type`、`ui/scene`、`ui/motion`、`ui/style`）和带中文同义词的词表；规则只在新组件入库时打一次，不覆盖你的修改。
- 组件画廊：一个页面往下滚就能看到所有组件的实时效果，支持搜索（中文类型名也能搜）、按库 / 类型 / 只看免费筛选、整页切换明暗，预览下方可切换变体；预览滚到附近才加载。画廊是一个 `.uishelf` 文件，会记住筛选和明暗，可以加快捷方式或复制多份。
- Bases 卡片墙和封面：用官方缩略图，没有的在后台截图生成。
- 给 agent：`catalog.json`、组件库档案（许可证、价格、安装方式）、附带的 agent skill（可在设置里一键装到 Claude Code）、带进度和修法提示的同步报告，以及只同步 / 检查最近改过的来源文件、检查全部预览、取消运行的命令。
- 英文和简体中文界面；在 Obsidian 1.13+ 的设置搜索里能搜到本插件的设置项。
