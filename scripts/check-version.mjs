#!/usr/bin/env node
/**
 * 版本一致性校验 + 发布产物摘要（零依赖，只用 node 内置模块）
 *
 * 用法：
 *   node scripts/check-version.mjs                只校验三处版本号是否一致
 *   node scripts/check-version.mjs sticho.exe     校验后再打印指定文件的 SHA256
 *
 * 「三处」指 package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml——
 * 版本号各写一份，改漏一处就会出现「安装包版本与关于页版本不一致」这类低级问题，
 * 而且很难被单测发现。任一不一致即非零码退出，因此可以直接接进 CI 当门禁。
 *
 * 不带参数时，若已存在打包产物（src-tauri/target/release/bundle 下的 exe/msi），
 * 会顺带打印它们的 SHA256，供发布时贴到 release 说明里核对。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 读取并解析 JSON（失败时给出「哪个文件坏了」而不是裸异常） */
function readJson(rel) {
  const path = join(root, rel);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`无法解析 ${rel}：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/** 取 Cargo.toml 里 [package] 段的 version（其它依赖表的 version 不参与） */
function cargoVersion(rel) {
  const text = readFileSync(join(root, rel), "utf8");
  const start = text.indexOf("[package]");
  if (start < 0) throw new Error(`${rel} 里找不到 [package] 段`);
  const rest = text.slice(start + "[package]".length);
  const next = rest.indexOf("\n[");
  const body = next >= 0 ? rest.slice(0, next) : rest;
  const match = body.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`${rel} 的 [package] 段里找不到 version`);
  return match[1];
}

const sources = [
  ["package.json", readJson("package.json").version],
  ["src-tauri/tauri.conf.json", readJson("src-tauri/tauri.conf.json").version],
  ["src-tauri/Cargo.toml", cargoVersion("src-tauri/Cargo.toml")],
];

const versions = new Set(sources.map(([, v]) => v));
for (const [file, version] of sources) console.log(`${version}  ${file}`);

if (versions.size !== 1) {
  console.error(`\n版本号不一致：请把三处改成同一个值后再发布。`);
  process.exit(1);
}
console.log(`\n版本号一致：${sources[0][1]}`);

/** 递归列出目录下所有匹配后缀的文件 */
function walk(dir, re) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, re));
    else if (re.test(name)) out.push(full);
  }
  return out;
}

const asked = process.argv.slice(2);
const bundleDir = join(root, "src-tauri", "target", "release", "bundle");
const targets = asked.length
  ? asked.map((p) => join(root, p))
  : existsSync(bundleDir)
    ? walk(bundleDir, /\.(exe|msi)$/)
    : [];

if (targets.length === 0) {
  console.log("\n未找到打包产物，跳过 SHA256（无参数时自动扫描 bundle 目录）。");
} else {
  console.log("");
  for (const path of targets) {
    if (!existsSync(path)) {
      console.error(`找不到文件：${path}`);
      process.exit(1);
    }
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    console.log(`sha256  ${digest}  ${relative(root, path) || path}`);
  }
}