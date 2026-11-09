/**
 * 给 agent 的 skill（Claude Code 的 SKILL.md 格式，其他 agent 当普通说明文档读也行）。
 * 插件按当前 vault 填好路径后写进 <root>/agent/SKILL.md，设置里可一键装到 ~/.claude/skills/ui-shelf/。
 * 改了这里记得同步改 README 的「给 agent」一节。
 */

export interface SkillVars {
  vaultName: string;
  vaultPath: string;
  root: string;
  pluginDir: string;
}

export function skillMarkdown(v: SkillVars): string {
  const abs = (p: string) => (v.vaultPath ? `${v.vaultPath}/${p}` : p);
  const cli = `obsidian vault="${v.vaultName}"`;
  return `---
name: ui-shelf
description: Find, use and add UI component libraries in the user's Obsidian UI Shelf. Use when the user wants a UI component ("找一个加载动画组件", "a streaming text component for my chat UI"), asks what components they have collected, or asks to add / collect / track a component library or site (组件库、收藏这个组件库、把这个网站的组件加进来).
---

# UI Shelf

The user collects UI component libraries in the Obsidian vault **${v.vaultName}** with the gogoga UI Shelf plugin.
Everything lives under \`${abs(v.root)}/\`.

| What | Path |
| --- | --- |
| Machine-readable catalog (start here) | \`${abs(`${v.root}/catalog.json`)}\` |
| One-line-per-component catalog | \`${abs(`${v.root}/catalog.md`)}\` |
| Tag vocabulary (with Chinese synonyms) | \`${abs(`${v.root}/Tag vocabulary.md`)}\` |
| Component notes | \`${abs(`${v.root}/components/<library>/<slug>.md`)}\` |
| Library notes (license, pricing, install) | \`${abs(`${v.root}/libraries/<library>.md`)}\` |
| Local source code of free components | \`${abs(`${v.pluginDir}/code/<library>/<slug>/`)}\` |
| Library source files you can write | \`${abs(`${v.root}/sources/<id>.source.json`)}\` |
| Result of the last sync / check | \`${abs(`${v.root}/reports/last-sync.md`)}\` |

The Obsidian CLI (\`obsidian\`) drives the plugin. Obsidian must be running.

## A. Find and use a component

1. Read \`catalog.json\`. Each component has \`key\` (\`library/slug\`), \`tier\` (free / pro), \`frameworks\`, \`tags\`, \`styling\`, \`dependencies\`, \`requires\`, \`export\`, \`props_required\`, \`variants\` (props with a fixed set of values, e.g. \`variant\`: Drive / Dots / Orbit, with the default), \`usage\`, \`install\`, \`code_dir\`, \`code_files\`, \`page\`.
   Filter with jq, e.g. free React components for AI thinking states without Tailwind:
   \`\`\`bash
   jq '.components[] | select(.tier=="free" and (.tags|index("ui/scene/ai-thinking")) and (.styling|startswith("tailwind")|not)) | {key, styling, dependencies, usage}' "${abs(`${v.root}/catalog.json`)}"
   \`\`\`
2. Map the user's words to tags with the vocabulary (\`ui/type/…\` what it is, \`ui/scene/…\` where it is used, \`ui/motion/…\` how it moves, \`ui/style/…\` look). Tags were set by rules and may be edited by the user; also search titles and descriptions.
3. Before recommending, check the library entry in \`catalog.json\` → \`libraries\` (license, license_notes, pricing). Mention restrictions that matter.
4. To integrate a free component: prefer \`install\` when present (e.g. shadcn CLI). Otherwise copy files from \`code_dir\` (paths mirror the suggested project paths; \`globals.css\` is the library's global/Tailwind CSS). Install \`dependencies\` and satisfy \`requires\`. Use \`usage\` as the starting snippet and fill \`props_required\`.
5. **Pro components carry no code.** Never reconstruct them from previews, screenshots, DOM or site scripts. Tell the user it needs a license and link \`page\`.
6. Show the user the component note path so they can see the live preview in Obsidian.

## B. Add a new component library

Goal: write \`${v.root}/sources/<id>.source.json\` so the plugin can sync the library, then verify with the report.
The \`sources/\` folder is created by the plugin on its first sync; create it yourself if it is missing. The plugin reads the folder straight from disk, so a file is picked up as soon as it is written.

### 1. Research the site (in this order, stop when one works)
- \`/r/registry.json\` or \`/registry.json\` → shadcn registry (\`{ "items": [...] }\`) → mode \`use\` with kind \`shadcn\`. What the adapter does for you:
  - finds each item's JSON next to the index, under \`r/\` or under \`registry/\` (or set \`use.itemUrl\`, e.g. \`"https://x.dev/registry/{name}.json"\`);
  - items that answer 401/403 are recorded as **pro** (metadata only) — so a registry that mixes free and paid items is fine in \`use\` mode;
  - only \`registry:ui\`, \`registry:component\`, \`registry:block\` become components (narrow with \`use.include\`, e.g. \`["registry:ui"]\`);
  - \`<name>-demo\` is fetched and rendered as the live preview when it exists (listed in the index or not); \`cssVars\` / \`css\` (keyframes, theme variables) are kept; undeclared imports such as \`@/components/ui/button\` are fetched from the registry or shadcn's official one.
- \`/r\` returning \`{ "components": [...] }\` with \`/r/{slug}\` details → \`use\` with kind \`r-index\`.
- \`/llms.txt\` — often documents a JSON API; read it for endpoints and licensing rules.
- Any JSON endpoint listing components (check network requests of the components page, Next.js \`_next/data\`, a GitHub repo's JSON) → mode \`index\` (format json).
- \`/sitemap.xml\` with one URL per component → mode \`index\` (format sitemap) with a \`match\` regex.
- Nothing machine-readable → mode \`components\`: list each component by hand (slug, name, description, page, tier). Inline \`code\` only for free code the site openly publishes.
- \`components\` can also be added next to \`use\` or \`index\` — e.g. free components from an API plus paid ones listed by hand as \`"tier": "pro"\` metadata. A hand-written entry replaces a collected one with the same slug.
- Also find: license (GitHub repo license, site footer, terms page), pricing (free / Pro / one-time / subscription), frameworks, styling (Tailwind version, CSS modules…), how users install components, GitHub repo, docs, llms.txt, author.
- Respect the site: obey llms.txt instructions, never bypass paywalls or logins, never copy Pro code.

### 2. Write the source file
\`\`\`jsonc
{
  "id": "magic-ui",                       // lowercase, digits, dashes; becomes the folder name and ui-preview prefix
  "name": "Magic UI",
  "homepage": "https://magicui.design/",
  "profile": {
    "description": "One sentence on what the library is for.",
    "license": "MIT",                     // SPDX id, or custom / proprietary / unknown
    "license_url": "https://github.com/…/LICENSE",
    "license_notes": "What users may and may not do, especially for paid parts.",
    "pricing": "free",                    // e.g. "free + one-time Pro license"
    "frameworks": ["react"],
    "styling": "Tailwind CSS v4 + motion",
    "install": "npx shadcn@latest add https://magicui.design/r/{name}.json",
    "repo": "https://github.com/…", "docs": "https://…", "llms_txt": "https://…/llms.txt",
    "author": "…",
    "agent_notes": "Anything an agent integrating these components should know."
  },

  // exactly ONE of the three modes:

  // (a) reuse a built-in adapter
  "use": { "kind": "shadcn", "url": "https://magicui.design/r/registry.json" }

  // (b) a remote index the plugin re-reads on every sync (new components appear automatically)
  // "index": {
  //   "url": "https://example.dev/api/components.json",
  //   "format": "json",                  // or "sitemap"
  //   "items": "data.components",        // dot path to the array ("" = root array)
  //   "match": "/components/([^/]+)/?$", // sitemap only: capture group 1 = slug
  //   "fields": { "slug": "id", "name": "title", "description": "summary", "category": "group",   // category may point at a string or an array
  //               "tier": "plan", "page": "url", "cover": "image", "install": "cli", "source": "json" },
  //   "free": { "field": "plan", "equals": "free" },   // when tier is not literally free/pro
  //   "tier": "free",                    // default tier when the index has none
  //   "pageTemplate": "https://example.dev/c/{slug}", "coverTemplate": "…{slug}.png",
  //   "installTemplate": "npx shadcn@latest add https://example.dev/r/{slug}.json",
  //   "frameworks": ["react"]
  // },
  // "code": {                            // optional: how to get code for FREE items
  //   "kind": "react",                   // or "html" (fields html / css / js)
  //   "url": "https://example.dev/r/{slug}.json",   // omit to read from the index item itself
  //   "files": "files", "path": "path", "content": "content",
  //   "entry": "{slug}\\\\.tsx$",         // file path or regex for the component file; {slug} is filled in (useful when an item has several .tsx files)
  //   "demo": "https://example.dev/r/{slug}-demo.json",  // optional official demo, same file mapping; rendered as the preview
  //   "export": "Button",                // optional; guessed from the slug otherwise
  //   "tailwind": "https://example.dev/globals.css"  // or true when Tailwind is needed without global CSS
  // }

  // (c) a hand-written list (closed source / no API)
  // "components": [
  //   { "slug": "aurora-card", "name": "Aurora Card", "description": "…", "category": "Cards",
  //     "tier": "pro", "page": "https://…", "cover": "https://…png", "frameworks": ["react"] }
  // ]

  // ── optional, valid with ALL three modes (applied on top of what the mode collected) ──
  // "pageTemplate": "https://magicui.design/docs/components/{slug}",   // when components only got the homepage
  // "coverTemplate": "https://…/{slug}.png",
  // "categories": { "marquee": ["Animation"] },
  // "tags": { "marquee": ["ui/type/list", "ui/motion/stream"] },       // vocabulary values only
  // "previews": {
  //   "word-rotate": { "props": { "words": ["Fast", "Simple", "Beautiful"] } },  // demo props
  //   "tweet-card": { "skip": true },                                  // show the official page instead
  //   "globe": { "entry": "registry/example/globe-demo.tsx", "export": "GlobeDemo" }
  // }
}
\`\`\`
Real JSON has no comments. Keep \`profile\` thorough: it is what later agents read to decide whether a component may be used.
\`code\` is only for mode \`index\`; in mode \`use\` the built-in adapter already fetches code. In the report and library notes, a library from a source file shows as kind \`manifest\` (or \`manifest→shadcn\` in mode \`use\`).
Omit \`profile\` fields you could not find (e.g. no public repo) rather than guessing; use \`"license": "custom"\` for a site-specific licence and summarise it in \`license_notes\`.
Covers: an image URL from the source (e.g. \`fields.cover\`) is used as-is; components without one get a screenshot generated after the sync. A note whose \`cover\` is a URL already has its cover.

### 3. Sync and read the report
While you iterate on one library, sync **only the source file you changed most recently**, then wait for the report. Copy this helper — it waits until the report belongs to *your* run and is finished:
\`\`\`bash
REPORT="${abs(`${v.root}/reports/last-sync.md`)}"
ui_shelf() {  # usage: ui_shelf <command-id>
  local t0; t0=$(date -u +%Y-%m-%dT%H:%M:%S)
  ${cli} command id=gogoga-ui-shelf:$1 >/dev/null
  for _ in $(seq 1 180); do
    sleep 10
    local st started; st=$(sed -n 's/^status: //p' "$REPORT"); started=$(sed -n 's/^started: //p' "$REPORT")
    [[ "$started" > "$t0" ]] || continue
    [ "$st" = "done" ] && { sed -n '/^---$/,$p' "$REPORT"; return; }
    sed -n 's/^progress: //p' "$REPORT"   # e.g. "check 37/114 aceternity/lamp"
  done
  echo "still running after 30 min — run: ${cli} command id=gogoga-ui-shelf:cancel"
}
ui_shelf sync-latest-source
\`\`\`
- \`sync-latest-source\` syncs only the most recently modified \`*.source.json\`; \`sync-sources\` syncs every source file; \`sync-all\` also syncs the libraries from settings.
- Timing: about 1–3 s per component (fetching code and demos) plus ~3 s per component that needs a generated cover. 100 components ≈ 5–10 minutes. While running, the report's \`progress\` says which stage and component it is on.
- \`sources_found\` says how many source files were read; \`error\` appears if the run stopped early. Fix every ❌ (invalid JSON, wrong \`items\` path, regex without a capture group, HTTP errors, unknown tags) and run again.

### 4. Check previews
\`\`\`bash
ui_shelf check-latest-source   # only the library you just synced (~3 s per component); check-sources = every source file
\`\`\`
Each component gets at most 20 s; one that hangs is reported as "timed out" and the check moves on. Failures so far are listed in the report while it runs.
Poll the report the same way. Each failure names the component and the error. Fix them in the source file's \`previews\` map, then sync and check again:
- "Cannot read properties of undefined", "… must be a string" → the component needs props: give \`previews.<slug>.props\` with realistic sample data (read the component's source in the local code folder to see what it expects), or point \`entry\` at an official demo file.
- "Cannot resolve …", "Failed to load … from esm.sh", errors from server-only packages (\`react-dom/server\`, \`next/*\`) → the component cannot run in a sandbox; set \`previews.<slug>.skip: true\` so the note shows the official page instead.
- Index mode: point \`code.entry\` / \`code.export\` at the right file, add \`code.tailwind\` with the library's global CSS URL.
Leave a handful of unfixable previews skipped rather than spending long on them; say which in your summary.

### 5. Finish
- Tags: the report lists components without a \`ui/type/…\` tag. Assign them in the source file's \`tags\` map (one line per slug, vocabulary values only) and sync again — the plugin fills them into notes that have no type tag yet. Edit a single note's frontmatter only for one-off corrections.
- Open a couple of component notes to confirm description, tags, usage and the live preview look right.
- Tell the user: library name, how many components (free / pro), license and pricing summary, and anything that needs their decision (e.g. a Pro token).

## Rules
- Never edit text between \`<!-- ui-shelf:start -->\` and \`<!-- ui-shelf:end -->\`, nor \`catalog.*\`, \`Tag vocabulary.md\` or the report: the plugin rewrites them. Edit tags and the area outside the markers freely.
- Never write tokens, cookies or passwords into the vault.
- Other commands: \`sync-all\`, \`sync-sources\`, \`check-sources\`, \`check-previews\` (every library, slow), \`generate-covers\`, \`rebuild-catalog\`, \`cancel\` (stops the running sync / check; the report then says so). All are \`gogoga-ui-shelf:<id>\`. Only one run at a time: a command sent while another runs is ignored, so wait for \`status: done\` first.
`;
}
