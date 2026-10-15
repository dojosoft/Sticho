#!/usr/bin/env node
/**
 * 一键发布（零依赖，只用 node 内置模块）
 *
 * 用法：
 *   npm run release                        构建 → 校验 → 归档 → 打印校验和 → 复制绿色版到桌面
 *   node scripts/release.mjs --no-build    跳过构建，用现有产物跑后续步骤
 *   node scripts/release.mjs --no-desktop  不往桌面复制
 *   node scripts/release.mjs --desktop D:\some\dir   指定桌面替代目录
 *   node scripts/release.mjs --strict-desktop        复制桌面失败时以非零码退出（默认只告警）
 *
 * 为什么要脚本化：发布链路上只要有一两步靠手做，就会出现「编译明明成功、桌面上的却还是
 * 旧版本」这类假故障——三步分离之后，任何一步被跳过都不再显眼。本脚本把三步绑在一起，
 * 任一步失败即以非零码退出（唯一例外：复制桌面失败默认只告警，见下方 --strict-desktop）。
 *
 * 步骤：
 *   1. 三处版本号必须一致（package.json / tauri.conf.json / Cargo.toml），不一致立刻退出
 *   2. npm run tauri build（--no-build 可跳过）
 *   3. 产物收进 release/：安装包 + 绿色版 exe，并从 CHANGELOG.md 抽出本版本段落作 release notes
 *   4. 写 release/SHA256SUMS.txt 并打印
 *   5. 绿色版 exe 复制到桌面（路径取自注册表 User Shell Folders，兼容桌面被重定向的情况）
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/** 取 --flag 的值；不存在时返回 undefined */
function flagValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

/** 跑一条命令，失败即退出（stdio 直连终端，保留构建的彩色输出） */
function run(command) {
  const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`\n失败：${command}`);
    process.exit(result.status ?? 1);
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** 跑一条命令（参数数组，不经过 shell；给路径带引号/空格的场合用） */
function runExec(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n失败：${command} ${commandArgs.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

/**
 * PowerShell 单引号字符串字面量：内部的 `'` 必须写成 `''`。
 *
 * 直接把路径塞进单引号里，路径含 `'`（合法文件名字符）时会提前闭合字符串，
 * 后面的内容被当成命令解析——轻则压缩失败，重则执行到意外命令。
 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 展开 Windows 的 %VAR% 写法（注册表里存的是 REG_EXPAND_SZ） */
function expandEnv(text) {
  return text.replace(/%([^%]+)%/g, (whole, name) => process.env[name] ?? whole);
}

/**
 * 桌面目录。优先命令行覆盖，其次问注册表——用户的桌面常被重定向到非默认盘符
 * （本项目所在机器就是 D:\Users\Desktop），只靠 os.homedir() 会复制到错地方。
 */
function desktopDir() {
  const override = flagValue("--desktop");
  if (override) return resolve(override);
  if (process.platform === "win32") {
    const res = spawnSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop',
      { encoding: "utf8", shell: true },
    );
    const match = res.stdout?.match(/Desktop\s+REG_(?:EXPAND_)?SZ\s+(.+)/);
    if (match) return resolve(expandEnv(match[1].trim()));
  }
  return join(homedir(), "Desktop");
}

/** 从 CHANGELOG.md 里抽出 `## [x.y.z]` 段落，作为 release notes */
function changelogSection(version) {
  if (!existsSync(join(root, "CHANGELOG.md"))) return null;
  const text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const start = text.indexOf(`## [${version}]`);
  if (start < 0) return null;
  const rest = text.slice(start);
  const next = rest.indexOf("\n## [", 1);
  return `${(next >= 0 ? rest.slice(0, next) : rest).trim()}\n`;
}

// ---- 1. 版本号一致性（复用 check-version，规则只写一处） ----
const gate = spawnSync("node scripts/check-version.mjs", {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (gate.status !== 0) {
  console.error(gate.stdout ?? "");
  console.error(gate.stderr ?? "");
  console.error("版本号校验未通过，已中止发布。");
  process.exit(gate.status ?? 1);
}
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
console.log(`发布版本：${version}\n`);

// ---- 2. 构建 ----
if (args.includes("--no-build")) {
  console.log("跳过构建（--no-build），直接使用现有产物。\n");
} else {
  console.log("开始构建（npm run tauri build）…\n");
  run(`${NPM} run tauri build`);
}

// ---- 3. 归档产物 ----
const releaseDir = join(root, "src-tauri", "target", "release");
const greenSrc = join(releaseDir, "sticho.exe");
const nsisDir = join(releaseDir, "bundle", "nsis");

if (!existsSync(greenSrc)) {
  console.error(`找不到绿色版：${greenSrc}（构建未产出？）`);
  process.exit(1);
}
const installers = existsSync(nsisDir)
  ? readdirSync(nsisDir).filter((name) => name.endsWith(".exe"))
  : [];
if (installers.length === 0) {
  console.error(`找不到安装包：${nsisDir}\\*.exe（构建未产出？）`);
  process.exit(1);
}

const outDir = join(root, "release");
mkdirSync(outDir, { recursive: true });
// 清掉上一次的可分发产物，避免新旧版本混在一起看不出用了哪个。
// 只删本脚本自己产出的（Sticho_ 前缀的安装包 / 绿色版、Sticho-Portable-*.zip），
// 不动用户或其它工具放在 release/ 里的无关文件。
const isOurArtifact = (name) =>
  /^Sticho[_.-]/i.test(name) && (name.endsWith(".exe") || name.endsWith(".zip"));
for (const name of readdirSync(outDir)) {
  if (isOurArtifact(name)) rmSync(join(outDir, name));
}

const greenName = `Sticho_${version}_x64-portable.exe`;
copyFileSync(greenSrc, join(outDir, greenName));
const installerNames = [];
for (const name of installers) {
  copyFileSync(join(nsisDir, name), join(outDir, name));
  installerNames.push(name);
}

// 便携 zip：与历史发布产物同名同结构（压缩包内只有 Sticho.exe 一个文件）
let zipName = null;
if (process.platform === "win32") {
  const staging = join(outDir, ".portable-staging");
  mkdirSync(staging, { recursive: true });
  copyFileSync(join(outDir, greenName), join(staging, "Sticho.exe"));
  zipName = `Sticho-Portable-${version}-x64.zip`;
  runExec("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -Path ${psQuote(join(staging, "Sticho.exe"))} -DestinationPath ${psQuote(join(outDir, zipName))} -Force`,
  ]);
  rmSync(staging, { recursive: true, force: true });
} else {
  console.log("非 Windows 平台，跳过便携 zip 打包。");
}

const notes = changelogSection(version);
if (notes) {
  writeFileSync(join(outDir, `release-notes-${version}.md`), notes, "utf8");
}

// ---- 4. 校验和 ----
const artifacts = [greenName, ...installerNames, ...(zipName ? [zipName] : [])];
const sums = artifacts
  .map((name) => `${sha256(join(outDir, name))}  ${name}`)
  .join("\n");
writeFileSync(join(outDir, "SHA256SUMS.txt"), `${sums}\n`, "utf8");

console.log(`\n产物已归档到 release/：`);
for (const line of sums.split("\n")) console.log(`  ${line}`);
if (notes) console.log(`  release-notes-${version}.md`);

// ---- 5. 绿色版到桌面 ----
if (args.includes("--no-desktop")) {
  console.log("\n已跳过桌面复制（--no-desktop）。");
  process.exit(0);
}

// 复制桌面是「交付便利」而非发布本体：构建与归档已经成功，此处失败（最常见是绿色版
// 正被运行中的程序占用）不该让整条命令报「失败」，否则会被误读成编译失败。
// 默认只告警并以 0 退出；需要严格门禁时加 --strict-desktop。
const strictDesktop = args.includes("--strict-desktop");
function desktopFailure(message) {
  console.error(message);
  process.exit(strictDesktop ? 1 : 0);
}

const desktop = desktopDir();
if (!existsSync(desktop)) {
  desktopFailure(`\n桌面目录不存在：${desktop}（可用 --desktop 指定，或加 --no-desktop 跳过）`);
}
const desktopExe = join(desktop, "Sticho.exe");
const freshExe = join(outDir, greenName);
// 覆盖前先校验：内容一致就不必写（省一次 IO，也不改动桌面文件的修改时间）
if (existsSync(desktopExe) && sha256(desktopExe) === sha256(freshExe)) {
  console.log(`\n桌面上的绿色版已是最新（SHA256 一致），无需复制：${desktopExe}`);
  process.exit(0);
}
// 内容不同才会被覆盖：先留一份备份到 release/（不往桌面堆 .prev 文件）。
// 万一桌面上的同名文件不是本程序产出的，也不会被无声抹掉。
if (existsSync(desktopExe)) {
  const backup = join(outDir, "desktop-Sticho.exe.prev");
  try {
    copyFileSync(desktopExe, backup);
    console.log(`已备份桌面旧文件到：${backup}`);
  } catch (err) {
    desktopFailure(
      `\n备份桌面旧文件失败：${backup}\n${err instanceof Error ? err.message : String(err)}` +
        `\n为避免覆盖丢失数据，已中止桌面复制。`,
    );
  }
}
try {
  copyFileSync(freshExe, desktopExe);
} catch (err) {
  desktopFailure(
    `\n复制到桌面失败：${desktopExe}\n${err instanceof Error ? err.message : String(err)}` +
      `\n若程序正在运行，请先退出再重试。安装包与绿色版已归档在 release/，只差这一步。` +
      `\n（构建与归档均已成功，故默认不视为失败；希望失败即报错请加 --strict-desktop）`,
  );
}
console.log(`\n绿色版已复制到桌面：${desktopExe}`);
console.log(`（${basename(greenName)} → Sticho.exe，SHA256 与 release/ 中的产物一致）`);