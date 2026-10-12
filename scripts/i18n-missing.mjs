#!/usr/bin/env node
/**
 * i18n 缺失清单（开发辅助脚本，零依赖）
 *
 * 用法：node scripts/i18n-missing.mjs
 *
 * 扫描 src/ 下所有源文件里 `t("…")` / `t('…')` 的字面量键，与 src/lib/i18n.ts 的
 * EN 词表比对，列出：
 *   - 已使用但未收录英文的键（增量补齐用）；
 *   - 已收录但源码里已无人使用的键（清理用）。
 *
 * 之所以是「清单工具」而不是门禁：EN 词表刻意保留「缺失回落中文」的可增量设计，
 * 硬失败会挡住正常开发；真正的不变量（英文值不为空串）由 i18n.test.ts 断言。
 * 因此本脚本退出码恒为 0，输出仅供人工参考。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");

/** 递归收集 src/ 下的 .ts / .js / .svelte 源文件 */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|js|svelte)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * 把字面量里的转义还原成运行时字符串，保证「\uFFFD」与真实替换字符这类写法能被认成同一个键。
 */
function decode(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, esc) => {
    const kind = esc[0];
    if (kind === "u") return String.fromCharCode(parseInt(esc.slice(1), 16));
    if (kind === "x") return String.fromCharCode(parseInt(esc.slice(1), 16));
    const named = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" };
    return named[esc] ?? esc;
  });
}

/**
 * 从 i18n.ts 里解析 EN 词表的键。
 *
 * 不做 TS 解析：词表是扁平的「键: 值」列表，且 prettier 保证每个键都独占一行，
 * 因此按行匹配「缩进两格 + 键 + 冒号」即可。键有三种写法：汉字标识符（合法的 JS
 * 标识符，无引号）、双引号、单引号；注释行以 `/` 开头，不会被误判。
 */
function enKeys(text) {
  const start = text.indexOf("const EN: Record<string, string> = {");
  const end = text.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error("i18n.ts 里找不到 EN 词表");
  const body = text.slice(start, end);
  const keys = new Set();
  const re =
    /^ {2}(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([\p{L}\p{Nl}$_][\p{L}\p{Nl}\p{Nd}$_]*)):/gmu;
  for (const m of body.matchAll(re)) keys.add(decode(m[1] ?? m[2] ?? m[3]));
  return keys;
}

/** 抽取单个源文件里所有 t("…") / t('…') 的字面量键（按运行时字符串比对） */
function usedKeys(text) {
  const keys = new Set();
  const re = /\bt\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (const m of text.matchAll(re)) keys.add(decode(m[2]));
  return keys;
}

const en = enKeys(readFileSync(join(srcDir, "lib", "i18n.ts"), "utf8"));

/** 键 → 首次出现的文件（仅用于报告，方便定位） */
const used = new Map();
for (const file of walk(srcDir)) {
  if (file.endsWith(join("lib", "i18n.ts")) || file.endsWith(".test.ts")) continue;
  for (const key of usedKeys(readFileSync(file, "utf8"))) {
    if (!used.has(key)) used.set(key, file.slice(root.length + 1));
  }
}

const missing = [...used.keys()].filter((k) => !en.has(k));
const unused = [...en].filter((k) => !used.has(k));

console.log(`EN 词条：${en.size} 条；源码中出现的 t() 字面量键：${used.size} 条`);
console.log(`\n未收录英文的键（${missing.length} 条）：`);
for (const k of missing) console.log(`  ${used.get(k)}  ${JSON.stringify(k)}`);

console.log(`\n已收录但源码中未再使用的键（${unused.length} 条）：`);
for (const k of unused) console.log(`  ${JSON.stringify(k)}`);