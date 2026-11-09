/**
 * 标签词表 + 规则打标签。
 *
 * 标签是三维层级标签：ui/type/…（它是什么）、ui/scene/…（用在哪）、ui/motion/…（怎么动）。
 * 第四维 ui/style/… 是主观判断，词表里列出可选值，但规则不自动打。
 *
 * 规则只在组件首次入库时运行；之后用户改过的标签同步永不覆盖。
 * 值统一用英文 kebab-case（和 registry 的 slug 一致，agent 好匹配），
 * 中文释义和同义词写进词表笔记，人和 agent 都能按中文找到对应值。
 */

export type Dimension = "type" | "scene" | "motion" | "style";

export interface TagDef {
  dim: Dimension;
  value: string;
  en: string;
  zh: string;
  /** 匹配用的英文词（小写，可多词）；以词首为边界，末尾允许复数 s/es */
  terms: string[];
  /** 只给人和 agent 看的中文同义词，不参与匹配 */
  zhSynonyms?: string[];
}

const d = (dim: Dimension, value: string, en: string, zh: string, terms: string[], zhSynonyms: string[] = []): TagDef => ({
  dim,
  value,
  en,
  zh,
  terms,
  zhSynonyms,
});

export const VOCABULARY: TagDef[] = [
  // ── type：只看 slug、名称和来源分类，描述里的词太泛
  d("type", "button", "Button", "按钮", ["button", "btn", "cta", "actions", "learn more", "link"], ["按钮", "操作按钮"]),
  d("type", "input", "Input / composer", "输入框", ["input", "composer", "prompt bar", "textarea", "field", "search", "upload", "signup", "login", "contact"], ["输入", "搜索框", "对话输入"]),
  d("type", "menu", "Menu / dropdown", "菜单", ["menu", "dropdown", "popover", "context menu", "selection actions"], ["下拉", "弹出菜单"]),
  d("type", "tabs", "Tabs", "标签页", ["tabs", "tab", "segmented"], ["选项卡", "分段控件"]),
  d("type", "modal", "Modal / dialog / panel", "弹窗", ["modal", "dialog", "sheet", "drawer", "panel"], ["对话框", "抽屉", "面板"]),
  d("type", "toast", "Toast / notification", "通知", ["toast", "notification", "banner", "snackbar"], ["提示条", "消息提醒", "徽标"]),
  d("type", "tooltip", "Tooltip", "气泡提示", ["tooltip", "hint"], ["悬浮提示"]),
  d("type", "table", "Table", "表格", ["table", "records", "data table"], ["数据表"]),
  d("type", "card", "Card", "卡片", ["card", "cards", "testimonial", "testimonials", "pricing", "tier", "tiers"], ["卡片"]),
  d("type", "list", "List / rows", "列表", ["list", "rows", "task", "to-do", "todo", "checklist", "recents", "marquee", "tree"], ["任务列表", "清单"]),
  d("type", "chip", "Chip / pill / badge", "标签块", ["chip", "pill", "badge", "tag"], ["胶囊", "徽章"]),
  d("type", "avatar", "Avatar", "头像", ["avatar"], ["头像组"]),
  d("type", "loader", "Loader / skeleton", "加载", ["loader", "loading", "spinner", "skeleton", "progress", "placeholder", "thinking", "orbs"], ["转圈", "骨架屏", "进度"]),
  d("type", "text", "Text effect", "文字", ["text", "texts", "typography", "heading", "label", "citation", "reasoning stream", "typing", "word rotate", "highlighter", "ticker", "velocity", "typewriter", "flip words", "highlight", "words", "text generate"], ["文本", "文字效果", "引用"]),
  d("type", "code", "Code / diff", "代码", ["code", "diff", "file diff"], ["代码块", "差异对比"]),
  d("type", "chart", "Chart / diagram", "图表", ["chart", "flowchart", "graph", "waves", "insight", "map"], ["流程图", "可视化"]),
  d("type", "nav", "Navigation", "导航", ["nav", "sidebar", "navigation", "breadcrumb", "page", "dock", "navbar", "menu bar", "notch"], ["侧边栏", "页面切换"]),
  d("type", "toggle", "Toggle / checkbox", "开关", ["toggle", "switch", "checkbox", "radio", "slider", "effort", "toggler"], ["复选框", "单选"]),
  d("type", "icon", "Icon", "图标", ["icon", "check"], ["图标切换"]),
  d("type", "media", "Media", "媒体", ["image", "audio", "voice", "video", "carousel", "compare", "gallery"], ["图片", "语音", "音频", "轮播"]),
  d("type", "effect", "Effect / decoration", "特效", ["confetti", "dissolve", "shimmer", "tilt", "shake", "glow", "physics", "drag", "burst", "beam", "border", "glare", "blur", "glyph", "shine", "orbiting", "sparkles", "spotlight", "lamp", "vortex", "stars", "mask", "lens", "canvas reveal", "following pointer", "gemini", "pixel", "pixelated", "ascii", "dither", "glass", "hover"], ["装饰动效", "粒子"]),
  d("type", "background", "Background / pattern", "背景", ["background", "pattern", "meteors", "particles", "ripple", "retro grid", "flickering grid", "noise", "light rays", "warp", "backlight", "dotted map", "globe", "aurora", "shader", "beams"], ["背景图案", "网格", "粒子", "流星"]),
  d("type", "cursor", "Cursor", "光标", ["cursor", "pointer", "cool mode", "lens"], ["鼠标指针", "放大镜"]),
  d("type", "mockup", "Device mockup", "设备样机", ["mockup", "android", "iphone", "safari", "terminal", "device", "browser", "macbook", "laptop", "keyboard"], ["手机外壳", "浏览器框", "终端"]),
  d("type", "layout", "Layout", "布局", ["bento", "layout", "masonry", "parallax", "sticky scroll", "container scroll", "timeline", "hero", "grid", "features", "section", "cta", "footer", "logo cloud", "logos"], ["便当格", "瀑布流"]),
  d("type", "accordion", "Accordion / collapsible", "折叠", ["accordion", "collapsible", "expandable"], ["展开收起"]),

  // ── scene
  d("scene", "ai-chat", "AI chat", "AI 对话", ["chat", "message", "conversation", "composer", "agent", "assistant", "bot", "ai"], ["聊天", "对话", "智能体"]),
  d("scene", "ai-thinking", "AI thinking / reasoning", "AI 思考", ["thinking", "reasoning", "thought", "orbs"], ["推理", "思考中"]),
  d("scene", "ai-streaming", "AI streaming output", "AI 流式输出", ["streaming", "stream", "typing"], ["逐字输出", "打字机"]),
  d("scene", "ai-tool-call", "AI tool call", "AI 工具调用", ["tool", "tool call", "action states", "file diff", "image generation", "fine-tune"], ["工具调用", "执行状态"]),
  d("scene", "ai-approval", "Human in the loop", "人工确认", ["approval", "human-in-the-loop", "permission", "secure input", "reasoning effort"], ["审批", "确认", "授权"]),
  d("scene", "ai-citation", "Citations / sources", "引用来源", ["citation", "citations", "sources", "context cards"], ["出处", "参考"]),
  d("scene", "data-display", "Data display", "数据展示", ["table", "data", "records", "comparison", "chart", "insight", "structured outputs", "flowchart"], ["数据", "对比"]),
  d("scene", "form", "Form", "表单", ["form", "input", "field", "checkbox", "toggle", "filter", "select", "secure input"], ["填写", "筛选"]),
  d("scene", "feedback", "Feedback / status", "反馈", ["success", "error", "toast", "notification", "loading", "progress", "confetti", "like", "check", "badge"], ["成功", "失败", "状态提示"]),
  d("scene", "navigation", "Navigation", "导航", ["nav", "sidebar", "tabs", "menu", "page", "search", "dropdown"], ["切换", "菜单"]),
  d("scene", "media", "Media", "媒体", ["image", "audio", "voice", "video"], ["图片", "语音"]),

  // ── motion
  d("motion", "enter-exit", "Enter / exit", "进出场", ["open", "close", "reveal", "appear", "pop-in", "pop in", "dissolve", "stacking", "fade"], ["出现", "消失", "展开"]),
  d("motion", "morph", "Morph / resize", "形变", ["morph", "resize", "swap", "transform", "states swap"], ["变形", "切换"]),
  d("motion", "hover", "Hover", "悬停", ["hover"], ["鼠标悬停"]),
  d("motion", "shimmer", "Shimmer / glow", "流光", ["shimmer", "shine", "skeleton", "glow", "gradient text", "orbs"], ["闪光", "光泽"]),
  d("motion", "stream", "Text stream", "逐字", ["streaming", "typing", "typewriter", "texts reveal", "reasoning stream"], ["打字", "流式"]),
  d("motion", "physics", "Physics / spring", "物理", ["physics", "drag", "spring", "gooey", "bounce"], ["拖拽", "弹簧"]),
  d("motion", "3d", "3D / tilt", "3D", ["3d", "tilt"], ["倾斜", "立体"]),
  d("motion", "celebrate", "Celebrate", "庆祝", ["confetti", "burst", "celebrate", "like button"], ["彩带", "点赞"]),
  d("motion", "shake", "Shake", "抖动", ["shake"], ["错误抖动"]),
  d("motion", "counter", "Number change", "数字变化", ["number", "counter", "spinning counter"], ["计数", "数字滚动"]),

  // ── style：手动打
  d("style", "minimal", "Minimal", "极简", [], ["简洁"]),
  d("style", "playful", "Playful", "活泼", [], ["俏皮"]),
  d("style", "glass", "Glass", "玻璃", [], ["毛玻璃"]),
  d("style", "gradient", "Gradient", "渐变", [], ["炫彩"]),
  d("style", "dense", "Dense", "紧凑", [], ["信息密集"]),
];

export const DIMENSION_LABEL: Record<Dimension, { en: string; zh: string }> = {
  type: { en: "Type — what it is", zh: "类型：它是什么" },
  scene: { en: "Scene — where it is used", zh: "场景：用在哪里" },
  motion: { en: "Motion — how it moves", zh: "动效：怎么动" },
  style: { en: "Style — how it looks (tag by hand)", zh: "风格：长什么样（手动打）" },
};

export function tagOf(def: TagDef): string {
  return `ui/${def.dim}/${def.value}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const matchers = new Map<string, RegExp>();
function matches(text: string, term: string): boolean {
  let re = matchers.get(term);
  if (!re) {
    re = new RegExp(`(?:^|[^a-z0-9])${escape(term).replace(/ /g, "[\\s-]+")}(?:s|es)?(?![a-z0-9])`);
    matchers.set(term, re);
  }
  return re.test(text);
}

export interface TagInput {
  slug: string;
  name: string;
  description: string;
  categories: string[];
}

/** 规则打标签：type 只看名字和分类，scene/motion 还看描述。 */
export function autoTags(input: TagInput): string[] {
  const head = `${input.slug.replace(/-/g, " ")} ${input.name} ${input.categories.join(" ")}`.toLowerCase();
  const full = `${head} ${input.description}`.toLowerCase();
  const out: string[] = [];
  for (const def of VOCABULARY) {
    if (!def.terms.length) continue;
    const text = def.dim === "type" ? head : full;
    if (def.terms.some((t) => matches(text, t))) out.push(tagOf(def));
  }
  return out;
}

/** 不在词表里的 ui/ 标签（用户手打错的、旧版本遗留的），同步报告里列出来。 */
export function unknownTags(tags: string[]): string[] {
  const known = new Set(VOCABULARY.map(tagOf));
  return tags.filter((t) => t.startsWith("ui/") && !known.has(t));
}

/** 词表笔记正文（每次同步重写）。 */
export function vocabularyMarkdown(): string {
  const lines: string[] = [
    "# UI tag vocabulary / 标签词表",
    "",
    "<!-- generated by gogoga UI Shelf — 每次同步重写，别手改 -->",
    "",
    "Tags are hierarchical: `ui/<dimension>/<value>`. Only use values listed here.",
    "标签都是三层：`ui/维度/值`，只用这里列出的值。规则只在组件首次入库时打一次，之后手改不会被覆盖。",
    "",
  ];
  for (const dim of Object.keys(DIMENSION_LABEL) as Dimension[]) {
    lines.push(`## ${DIMENSION_LABEL[dim].zh} / ${DIMENSION_LABEL[dim].en}`, "");
    lines.push("| Tag | 中文 | English | Synonyms / 同义词 |", "| --- | --- | --- | --- |");
    for (const def of VOCABULARY.filter((v) => v.dim === dim)) {
      const syn = [...def.terms, ...(def.zhSynonyms ?? [])].join(", ");
      lines.push(`| #${tagOf(def)} | ${def.zh} | ${def.en} | ${syn} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
