/** 临时探针：node build/probe.mjs <registry.json URL> —— 看 shadcn 适配器对某个 registry 的采集结果 */
import { analyze } from "../src/core/integration";
import { autoTags } from "../src/core/tags";
import { compileModules } from "../src/preview/build";
import { shadcnAdapter } from "../src/sources/shadcn";

const url = process.argv[2];
const ctx = {
  fetchJson: async <T>(u: string) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`);
    return (await r.json()) as T;
  },
  fetchText: async (u: string) => (await fetch(u)).text(),
  exists: async () => false,
  progress: () => {},
};
const items = await shadcnAdapter.collect({ id: "probe", name: "probe", kind: "shadcn", url, homepage: "", enabled: true }, ctx);
const withCode = items.filter((i) => i.preview);
const demo = withCode.filter((i) => i.preview?.kind === "react" && i.preview.component);
const untyped = items.filter((i) => !autoTags(i).some((t) => t.startsWith("ui/type/")));
const remote = new Set<string>();
for (const i of withCode) if (i.preview?.kind === "react") compileModules(i.preview.files).remote.forEach((r) => remote.add(r));
console.log(`items ${items.length}, with code ${withCode.length}, demo previews ${demo.length}, pro ${items.filter((i) => i.tier === "pro").length}`);
console.log(`source sample: ${items[0]?.source}`);
console.log(`no code: ${items.filter((i) => !i.preview).map((i) => i.slug).join(", ") || "-"}`);
console.log(`untyped (${untyped.length}): ${untyped.map((i) => i.slug).join(", ")}`);
console.log(`esm.sh deps: ${[...remote].join(", ")}`);
const mq = items.find((i) => i.slug === "marquee");
if (mq?.preview?.kind === "react") {
  console.log(`marquee keyframes in css: ${/@keyframes marquee/.test(mq.preview.tailwindCss ?? "")}, --animate-marquee: ${/--animate-marquee/.test(mq.preview.tailwindCss ?? "")}`);
  console.log("marquee usage:\n" + analyze(mq).usage);
}
