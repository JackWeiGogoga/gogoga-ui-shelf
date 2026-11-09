/**
 * 生成写进 vault 的内容。全部是数据，不走 i18n。
 * 组件笔记 = frontmatter（事实字段每次同步覆盖；discovered / tags 只在创建时写）
 *          + 机器区（标记之间每次同步重写）+ 用户区（标记之外，永不触碰）。
 */
import type { ComponentItem, LibraryConfig, LibraryProfile } from "../types";
import type { Integration } from "./integration";

export const START = "<!-- ui-shelf:start -->";
export const END = "<!-- ui-shelf:end -->";

export interface Paths {
  root: string;
  componentsDir: string;
  librariesDir: string;
  home: string;
  base: string;
  catalog: string;
  catalogJson: string;
  vocabulary: string;
}

export function pathsFor(root: string): Paths {
  const r = root.replace(/\/+$/, "") || "UI Shelf";
  return {
    root: r,
    componentsDir: `${r}/components`,
    librariesDir: `${r}/libraries`,
    home: `${r}/UI Shelf.md`,
    base: `${r}/Components.base`,
    catalog: `${r}/catalog.md`,
    catalogJson: `${r}/catalog.json`,
    vocabulary: `${r}/Tag vocabulary.md`,
  };
}

/** 文件名里不能出现的字符 */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "untitled";
}

export function componentPath(p: Paths, lib: LibraryConfig, slug: string): string {
  return `${p.componentsDir}/${safeName(lib.id)}/${safeName(slug)}.md`;
}

export function libraryPath(p: Paths, lib: LibraryConfig): string {
  return `${p.librariesDir}/${safeName(lib.id)}.md`;
}

/**
 * 每次同步都覆盖的 frontmatter 字段。
 * cover 只在来源自带封面时写；来源没有的，留给本地生成的封面（不能被同步清空）。
 */
export function factFields(lib: LibraryConfig, item: ComponentItem, integ: Integration, codeDir: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    type: "ui-component",
    library: lib.name,
    library_id: lib.id,
    slug: item.slug,
    title: item.name,
    tier: item.tier,
    category: item.categories,
    frameworks: item.frameworks,
    page: item.page,
    source: item.source || null,
    install: item.install || null,
    styling: integ.styling,
    dependencies: integ.dependencies,
    export: integ.exportName,
    code_dir: item.preview ? codeDir : null,
  };
  if (item.cover) fields.cover = item.cover;
  return fields;
}

export function componentZone(
  lib: LibraryConfig,
  item: ComponentItem,
  libLink: string,
  integ: Integration,
  codeDir: string,
): string {
  const lines = [START];
  if (item.description) lines.push(`> ${item.description.replace(/\n+/g, " ")}`, "");
  lines.push("```ui-preview", `${lib.id}/${item.slug}`, "```", "");
  const meta = [`**Library** [[${libLink}|${lib.name}]]`, `**Tier** ${item.tier}`, `[Official page](${item.page})`];
  lines.push(meta.join(" · "), "");
  lines.push("## Use it", "");
  if (!item.preview) {
    lines.push(
      item.tier === "pro"
        ? "Pro component — source is not available here. Buy a license or use your own token on the official site; do not rebuild it from the preview."
        : "No source code from this library's index — see the official page.",
    );
  } else {
    const code = (xs: string[]) => (xs.length ? xs.map((x) => `\`${x}\``).join(", ") : "none");
    lines.push(`- **Styling** ${integ.styling}`);
    lines.push(`- **npm dependencies** ${code(integ.dependencies)}`);
    for (const r of integ.requires) lines.push(`- **Requires** ${r}`);
    if (integ.exportName) {
      lines.push(`- **Export** \`${integ.exportName}\` · **Required props** ${code(integ.propsRequired)} · **Optional props** ${code(integ.propsOptional)}`);
    }
    lines.push(`- **Local code** \`${codeDir}/\` — ${integ.files.map((f) => `\`${f}\``).join(", ")}`);
    if (item.install) lines.push("", "```bash", item.install, "```");
    if (integ.usage) lines.push("", item.preview.kind === "html" ? "```html" : "```tsx", integ.usage, "```");
  }
  if (item.source) lines.push("", `**Code** <${item.source}>`);
  lines.push(END);
  return lines.join("\n");
}

/** 把正文里的机器区换成新的；没有标记（用户删了）就插到正文开头。 */
export function replaceZone(body: string, zone: string): string {
  const s = body.indexOf(START);
  const e = body.indexOf(END);
  if (s >= 0 && e > s) return body.slice(0, s) + zone + body.slice(e + END.length);
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(body);
  const at = fm ? fm[0].length : 0;
  return `${body.slice(0, at)}${zone}\n\n${body.slice(at)}`;
}

export function libraryZone(lib: LibraryConfig, p: Paths, stats: { total: number; free: number }, profile: LibraryProfile = {}): string {
  const row = (k: string, v: string | undefined) => (v ? [`- **${k}** ${v}`] : []);
  return [
    START,
    ...(profile.description ? [`> ${profile.description}`, ""] : []),
    `**Homepage** <${lib.homepage}> · **Source** \`${lib.kind}\` <${lib.url}>`,
    "",
    `${stats.total} components · ${stats.free} free · ${stats.total - stats.free} pro`,
    "",
    "## For agents",
    "",
    ...row("License", [profile.license ?? "unknown", profile.license_url ? `<${profile.license_url}>` : ""].filter(Boolean).join(" ")),
    ...row("License notes", profile.license_notes),
    ...row("Pricing", profile.pricing),
    ...row("Frameworks", profile.frameworks?.join(", ")),
    ...row("Styling", profile.styling),
    ...row("Install", profile.install),
    ...row("Repo", profile.repo ? `<${profile.repo}>` : undefined),
    ...row("Docs", profile.docs ? `<${profile.docs}>` : undefined),
    ...row("llms.txt", profile.llms_txt ? `<${profile.llms_txt}>` : undefined),
    ...row("Author", profile.author),
    ...row("Notes", profile.agent_notes),
    "",
    "```base",
    "filters:",
    "  and:",
    `    - file.inFolder("${p.componentsDir}")`,
    `    - note.library_id == "${lib.id}"`,
    "views:",
    "  - type: cards",
    "    name: Components",
    "    image: note.cover",
    "    order:",
    "      - file.name",
    "      - title",
    "      - tier",
    "      - tags",
    "    sort:",
    "      - property: note.discovered",
    "        direction: DESC",
    "```",
    END,
  ].join("\n");
}

export function baseFile(p: Paths): string {
  const order = (props: string[]) => props.map((x) => `      - ${x}`).join("\n");
  return `filters:
  and:
    - file.inFolder("${p.componentsDir}")
    - note.type == "ui-component"
properties:
  note.title:
    displayName: Component
  note.library:
    displayName: Library
  note.discovered:
    displayName: Discovered
views:
  - type: cards
    name: Latest
    image: note.cover
    order:
${order(["title", "library", "tier", "tags"])}
    sort:
      - property: note.discovered
        direction: DESC
  - type: cards
    name: This week
    image: note.cover
    filters:
      and:
        - note.discovered >= today() - "7 days"
    order:
${order(["title", "library", "tier", "tags"])}
    sort:
      - property: note.discovered
        direction: DESC
  - type: table
    name: By type
    order:
${order(["title", "library", "tier", "tags", "frameworks", "discovered"])}
    sort:
      - property: file.name
        direction: ASC
  - type: table
    name: By library
    groupBy:
      property: note.library
      direction: ASC
    order:
${order(["title", "tier", "tags", "frameworks", "discovered"])}
  - type: table
    name: Free
    filters:
      and:
        - note.tier == "free"
    order:
${order(["title", "library", "tags", "frameworks", "install"])}
  - type: table
    name: Untagged
    filters:
      and:
        - '!file.hasTag("ui/type")'
    order:
${order(["title", "library", "category", "tags"])}
`;
}

export function homeNote(p: Paths): string {
  const base = p.base.split("/").pop() ?? "Components.base";
  return `---
type: ui-shelf-home
---
# UI Shelf

![[${base}]]

## For agents / 给 agent

1. Read [[catalog]] first: one line per component with library, tier, frameworks, tags and where to get the code.
2. Tags follow [[Tag vocabulary]] (\`ui/type/…\`, \`ui/scene/…\`, \`ui/motion/…\`, \`ui/style/…\`). Map the user's words to these values; the vocabulary lists Chinese synonyms.
3. Get code from the \`source\` / \`install\` fields only. **Pro components**: never reconstruct them from previews, DOM or site scripts — ask the user to buy a license or use their own token.
4. Respect each library's license; note which library a component came from.

先读 [[catalog]]（每个组件一行），按 [[Tag vocabulary]] 的标签筛选；只从 \`source\` / \`install\` 取代码；付费组件不要从预览还原。
`;
}

export interface CatalogRow {
  key: string;
  library: string;
  title: string;
  note: string;
  styling: string;
  dependencies: string[];
  requires: string[];
  exportName: string | null;
  propsRequired: string[];
  propsOptional: string[];
  usage: string;
  codeDir: string;
  codeFiles: string[];
  cover: string;
  tier: string;
  frameworks: string[];
  tags: string[];
  description: string;
  source: string;
  install: string;
  page: string;
}

export function catalogMarkdown(rows: CatalogRow[], date: string): string {
  const lines = [
    "# UI component catalog",
    "",
    `<!-- generated by gogoga UI Shelf on ${date} — rewritten on every sync, do not edit -->`,
    "",
    "Format: `library/slug` · tier · frameworks · styling · npm deps · tags · description · install / local code / remote code / page",
    "Full details (props, usage, requirements) per component: catalog.json or the component note.",
    "",
  ];
  for (const r of [...rows].sort((a, b) => a.key.localeCompare(b.key))) {
    const tags = r.tags.map((t) => t.replace(/^ui\//, "")).join(" ") || "untagged";
    const how = [
      r.install ? `install: \`${r.install}\`` : "",
      r.codeDir ? `local: ${r.codeDir}/` : "",
      r.source ? `code: ${r.source}${r.tier === "pro" ? " (license token required)" : ""}` : "",
      `page: ${r.page}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const deps = r.dependencies.length ? r.dependencies.join(",") : "no-deps";
    lines.push(
      `- \`${r.key}\` · ${r.tier} · ${r.frameworks.join(",")} · ${r.styling} · ${deps} · ${tags} · ${r.description.replace(/\s+/g, " ")} · ${how}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function catalogJson(rows: CatalogRow[], libraries: Record<string, unknown>[], meta: { date: string; vault: string; root: string }): string {
  return JSON.stringify(
    {
      generated: meta.date,
      generator: "gogoga UI Shelf",
      vault: meta.vault,
      root: meta.root,
      note: "Paths are relative to the vault. Pro components carry no code: never reconstruct them from previews.",
      libraries,
      components: [...rows]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((r) => ({
          key: r.key,
          library: r.library,
          title: r.title,
          description: r.description,
          tier: r.tier,
          frameworks: r.frameworks,
          tags: r.tags,
          styling: r.styling,
          dependencies: r.dependencies,
          requires: r.requires,
          export: r.exportName,
          props_required: r.propsRequired,
          props_optional: r.propsOptional,
          usage: r.usage,
          install: r.install || null,
          code_dir: r.codeDir || null,
          code_files: r.codeFiles,
          source: r.source || null,
          page: r.page,
          note: r.note,
          cover: r.cover || null,
        })),
    },
    null,
    2,
  );
}
