/** 调试用：node build/dump.mjs <cache json> <out.html> —— 把缓存里某个组件的预览页面写成文件，在浏览器里打开排查 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildSrcdoc } from "../src/preview/build";
import type { ComponentItem } from "../src/types";

const item = JSON.parse(readFileSync(process.argv[2], "utf8")) as ComponentItem;
if (!item.preview) throw new Error("no preview");
writeFileSync(process.argv[3], buildSrcdoc(item.preview, { theme: "light", background: "#ffffff" }));
