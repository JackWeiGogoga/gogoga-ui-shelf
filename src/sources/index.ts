import type { LibraryConfig, SourceAdapter, SourceKind, SyncContext } from "../types";
import { manifestAdapter } from "./manifest";
import { rIndexAdapter } from "./r-index";
import { shadcnAdapter } from "./shadcn";
import { transitionsAdapter } from "./transitions";

const BUILTIN = {
  shadcn: shadcnAdapter,
  "r-index": rIndexAdapter,
  transitions: transitionsAdapter,
};

export const ADAPTERS: Record<SourceKind, SourceAdapter> = {
  ...BUILTIN,
  manifest: manifestAdapter(BUILTIN),
};

/** 设置页「推荐来源」：用户自己选择添加，插件默认不预置任何来源。 */
export const PRESETS: LibraryConfig[] = [
  {
    id: "aicss",
    name: "AICSS",
    kind: "r-index",
    url: "https://www.aicss.dev/r",
    homepage: "https://www.aicss.dev/",
    enabled: true,
    profile: {
      description: "UI components for AI agent conversations: thinking states, tool calls, streaming text, citations, tables.",
      license: "MIT",
      license_url: "https://github.com/kvnkld/aicss",
      license_notes: "Free components are MIT. Pro components need a one-time license; their source is not public and must not be reconstructed from previews.",
      pricing: "free + one-time Pro license",
      frameworks: ["react", "vue", "svelte"],
      styling: "Self-contained CSS (CSS Modules in React) with design tokens; theme via [data-theme]",
      install: "Copy the component file + its CSS into your project (each component JSON has React / Vue / Svelte versions)",
      repo: "https://github.com/kvnkld/aicss",
      llms_txt: "https://www.aicss.dev/llms.txt",
      agent_notes: "Fetch https://www.aicss.dev/r/{slug}?format=md for a ready-to-paste prompt. Locked components need `Authorization: Bearer <token>` from the user's account.",
    },
  },
  {
    id: "beautifului",
    name: "Beautiful UI",
    kind: "shadcn",
    url: "https://www.beautifului.dev/r/registry.json",
    homepage: "https://www.beautifului.dev/",
    enabled: true,
    profile: {
      description: "Crafted primitives for AI-native interfaces (agent traces, approval cards, composers, data tables).",
      license: "MIT",
      license_url: "https://www.beautifului.dev/",
      license_notes: "MIT (stated in the site footer). All components are free.",
      pricing: "free",
      frameworks: ["react"],
      styling: "Tailwind CSS v4 + the library's foundation.css tokens",
      install: "npx shadcn@latest add https://www.beautifului.dev/r/{name}.json (pulls foundation.css and dependent items)",
      agent_notes: "Every component depends on the `foundation` registry item; the shadcn CLI installs it. Components ship demo data as default props.",
    },
  },
  {
    id: "transitions",
    name: "Transitions.dev",
    kind: "transitions",
    url: "https://raw.githubusercontent.com/Jakubantalik/transitions.dev/main/assets/community",
    homepage: "https://transitions.dev/",
    enabled: true,
    profile: {
      description: "A library of crafted UI motion transitions (CSS + small JS), plus an agent skill.",
      license: "custom",
      license_url: "https://transitions.dev/terms.html",
      license_notes:
        "Free transitions: use in unlimited personal and commercial projects, modify freely. Do not redistribute the library itself or a substantial part of it as a competing motion pack. Pro transitions need a Pro plan (individuals) or Business seats (companies).",
      pricing: "free + Pro / Business plans",
      frameworks: ["css", "js"],
      styling: "Plain CSS with custom properties; theme via html[data-theme]",
      install: "Copy the HTML / CSS / JS snippet; keep the transitions.dev comment in the code",
      repo: "https://github.com/Jakubantalik/transitions.dev",
      docs: "https://transitions.dev/skill.html",
      agent_notes: "The repo also ships an agent skill (agent/skill/SKILL.md) for applying transitions.",
    },
  },
];

/**
 * 从用户粘贴的网址识别来源类型。依次尝试：
 * 已知预设 → shadcn registry（/r/registry.json、/registry.json）→ /r 索引。
 */
export async function detectLibrary(input: string, ctx: Pick<SyncContext, "fetchJson">): Promise<LibraryConfig | null> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const repoPath = url.pathname.replace(/\/$/, "").toLowerCase();
  const preset = PRESETS.find(
    (p) =>
      new URL(p.homepage).hostname.replace(/^www\./, "") === host ||
      (host === "github.com" && repoPath.length > 1 && p.url.toLowerCase().includes(repoPath)),
  );
  if (preset) return { ...preset };

  const origin = url.origin;
  const id = host.split(".")[0].replace(/[^a-z0-9-]/gi, "").toLowerCase() || "library";
  const name = host.split(".")[0];
  const base = { id, name, homepage: `${origin}/`, enabled: true };

  const candidates = url.pathname.endsWith(".json")
    ? [url.href]
    : [`${origin}/r/registry.json`, `${origin}/registry.json`];
  for (const c of candidates) {
    try {
      const j = await ctx.fetchJson<{ items?: unknown[] }>(c);
      if (Array.isArray(j.items)) return { ...base, kind: "shadcn", url: c };
    } catch {
      /* 试下一个 */
    }
  }
  try {
    const j = await ctx.fetchJson<{ components?: unknown[] }>(`${origin}/r`);
    if (Array.isArray(j.components)) return { ...base, kind: "r-index", url: `${origin}/r` };
  } catch {
    /* 都不是 */
  }
  return null;
}

export async function collect(lib: LibraryConfig, ctx: SyncContext) {
  return ADAPTERS[lib.kind].collect(lib, ctx);
}
