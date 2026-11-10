# Changelog

All notable changes to gogoga UI Shelf are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). 中文版见 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

## [Unreleased]

First version, not yet released.

### Added
- Collect UI component libraries: shadcn registries, `/r` indexes (AICSS style) and transitions.dev are built in; any other site can be described in a source file (`<folder>/sources/<id>.source.json`) by reusing a built-in type, mapping a JSON API or a sitemap, or listing components by hand.
- A note per component with description, tier, tags, install command and integration notes (styling, npm dependencies, requirements, export, required props, usage snippet); free components' code is cached locally.
- Live previews in notes: React / Tailwind / CSS Modules / HTML components run in a sandboxed frame, with light / dark, replay and code view; official demos are used when a library ships them. Pro components show the official page and are never fetched.
- Hierarchical tags (`ui/type`, `ui/scene`, `ui/motion`, `ui/style`) with a vocabulary note that lists Chinese synonyms; rules tag new components once and never overwrite your edits.
- Component gallery: a single scrolling page that runs every component live, with search (Chinese tag names too), library / type / free filters, a light / dark switch for the whole page and variant tabs under each preview; previews load as they scroll into view. The gallery is a `.uishelf` file that keeps its filters and theme, so it can be pinned or duplicated.
- Bases card wall with covers: official thumbnails, or screenshots generated in the background.
- For agents: `catalog.json`, library profiles (license, pricing, install), a bundled agent skill (install it for Claude Code from settings), a sync report with progress and fix-it hints, and commands to sync or check only the latest source file, check every preview, and cancel a run.
- English and Simplified Chinese interface; settings appear in Obsidian's settings search on 1.13+.
