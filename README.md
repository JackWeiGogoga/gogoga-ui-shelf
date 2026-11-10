# gogoga UI Shelf

**English** | [简体中文](https://github.com/JackWeiGogoga/gogoga-ui-shelf/blob/main/README.zh-CN.md)

Collect UI component libraries in Obsidian. Every component becomes a note with tags, integration notes and a **live preview** that runs the component's real code inside your note. Coding agents can read the shelf, pick components and add new libraries on their own.

The interface follows Obsidian's language setting: it is in English, or in Simplified Chinese when Obsidian is set to Chinese.

## What you get

- **A note per component**: description, live preview, license tier, tags, install command, and a "Use it" section with styling approach, npm dependencies, requirements, export name, required props and a usage snippet.
- **Live previews**: React, Tailwind, CSS Modules and plain HTML/CSS/JS components run in a sandboxed frame inside the note. Switch light/dark, replay animations, view and copy the code. When a library ships official demos, the preview renders the demo.
- **Hierarchical tags**: `ui/type/…` (what it is), `ui/scene/…` (where it is used), `ui/motion/…` (how it moves), `ui/style/…` (how it looks). Rules tag new components once; your edits are never overwritten.
- **Component gallery**: one scrolling page that runs every component live, like a library's own showcase site. Search (also matches Chinese tag names), filter by library, type or free only, switch light / dark for the whole page, and flip variants (size, style…) under each preview. Previews mount as they scroll into view, so hundreds of components stay smooth. Open it from the ribbon or the command **Open component gallery**. The gallery is a file, `<folder>/Gallery.uishelf`, that remembers its filters and theme, so you can pin it in a file explorer such as Notebook Navigator, or duplicate it to keep several saved filters.
- **Browse in Bases** too: a card wall with covers (official thumbnails; for the rest, run **Generate missing covers** or turn on automatic covers in settings — off by default since the gallery doesn't need them), latest components, this week, by type, by library, free only, untagged.
- **Paid components stay paid**: Pro items are kept as metadata with a link to the official page. Their code is never fetched or reconstructed.
- **Made for agents**: `catalog.json` lists every component with integration details; a bundled agent skill explains how to find, use and add libraries; agents add new libraries by writing a small source file and reading a sync report.

## Install

### With BRAT

Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the community plugins, click **Add beta plugin** in BRAT's settings, enter `https://github.com/JackWeiGogoga/gogoga-ui-shelf`, then enable **gogoga UI Shelf** under Settings → Community plugins.

### Manual install

1. Open the [Releases page](https://github.com/JackWeiGogoga/gogoga-ui-shelf/releases/latest) and download `main.js`, `manifest.json` and `styles.css` under **Assets** (not the Source code archives).
2. Put them in `<vault>/.obsidian/plugins/gogoga-ui-shelf/`. `.obsidian` is a hidden folder: press `⌘ ⇧ .` in Finder on macOS; on Windows, tick **Hidden items** under **View** in File Explorer.
3. Restart Obsidian or click refresh under Settings → Community plugins, then enable **gogoga UI Shelf**.

## Quick start

1. Settings → gogoga UI Shelf. Pick a folder (default `UI Shelf`).
2. Add libraries: click **Add** next to a suggested source, or **Add library** and paste a URL (a site with a shadcn registry or an `/r` index, or transitions.dev). Nothing is added by default.
3. The first sync writes the notes. Click the gallery icon in the ribbon to browse everything live, open `UI Shelf.md` for the card wall, or open any component note.

Built-in source types:

| Source | How it is read |
| --- | --- |
| shadcn registry (`/r/registry.json`, `/registry.json`) | items, their files, registry dependencies, `cssVars` / `css`, `<name>-demo` examples; items that need a token are recorded as Pro |
| `/r` index (AICSS style) | component list plus per-component JSON with React / Vue / Svelte code |
| transitions.dev | the library JSON in its GitHub repository |
| **source file** (`<folder>/sources/<id>.source.json`) | anything else: reuse a built-in type, map a JSON API or a sitemap, or list components by hand |

## For agents

Every sync writes `<folder>/agent/SKILL.md`. In settings, **Install for Claude Code** copies it to `~/.claude/skills/ui-shelf/`; **Copy** gives you the text for other agents. The skill covers:

- **Finding and using components**: query `catalog.json` (tier, tags, styling, dependencies, required props, usage, local code folder), check the library's license, install with the given command or copy the local code.
- **Adding a library**: research the site, write `<folder>/sources/<id>.source.json`, run `obsidian command id=gogoga-ui-shelf:sync-latest-source`, read `<folder>/reports/last-sync.md`, then `check-latest-source` to render every preview and fix failures. The report shows progress while running and lists every problem with a fix-it hint.

Source files support per-component overrides for previews (props, entry file, export, skip), tags, categories, page and cover URL templates.

Commands an agent (or you) can run: `sync-all`, `sync-sources`, `sync-latest-source`, `check-previews`, `check-sources`, `check-latest-source`, `generate-covers`, `regenerate-covers`, `rebuild-catalog`, `cancel`.

## How previews stay safe

- Component code runs in an `<iframe sandbox="allow-scripts">` built from a static page: it has its own origin and cannot reach your vault, Obsidian or the plugin.
- The plugin compiles TSX with sucrase and writes the modules, CSS and import map into the page. React, `clsx`, `class-variance-authority` and `tailwind-merge` are bundled; other npm packages are loaded from esm.sh inside the sandbox.
- Pro components are never fetched; their preview shows the official page.

## Network use

- Syncing reads each library's public index and component JSON, and GitHub's API for a repository's license.
- Previews may load npm packages from `esm.sh`; generated covers are drawn locally.
- Nothing is sent anywhere else, and no tokens are stored.

## Your notes

- Component notes live in `<folder>/components/<library>/<slug>.md`. The text between `<!-- ui-shelf:start -->` and `<!-- ui-shelf:end -->` is rewritten on sync; everything else, and your tags, are yours.
- `catalog.md`, `catalog.json`, `Tag vocabulary.md`, `agent/SKILL.md` and `reports/last-sync.md` are rewritten on every sync. `UI Shelf.md` and `Components.base` are created once and then left to you.
- Free components' code is cached in the plugin folder (`code/<library>/<slug>/`), mirroring the paths the library publishes.

## Development

```bash
pnpm install
pnpm dev          # watch build to dist/
pnpm build        # type-check + production build
pnpm smoke        # real-network checks of the built-in sources, source-file modes and integration analysis
pnpm lint         # the rule set the Obsidian community directory runs
node esbuild.config.mjs smoke probe && node build/probe.mjs <registry.json URL>   # what the shadcn adapter collects from a registry
```

## Credits

Bundled: [React](https://react.dev) (MIT), [Tailwind CSS browser build](https://tailwindcss.com) (MIT), [sucrase](https://github.com/alangpierce/sucrase) (MIT), [html-to-image](https://github.com/bubkoo/html-to-image) (MIT), [class-variance-authority](https://github.com/joe-bell/cva), [clsx](https://github.com/lukeed/clsx), [tailwind-merge](https://github.com/dcastil/tailwind-merge) (MIT). Component code belongs to each library and keeps its own license; check the library note before using it.

## License

MIT. See [LICENSE](https://github.com/JackWeiGogoga/gogoga-ui-shelf/blob/main/LICENSE).
