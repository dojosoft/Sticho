#!/usr/bin/env node
/**
 * 把 Vditor 的运行时资源从 node_modules 同步到 public/vditor（零依赖，只用 node 内置模块）
 *
 * 为什么需要这一步：
 * 编辑器把 mermaid / KaTeX / ECharts / abcjs 等引擎按需从 `${CDN_PATH}/dist/js/…` 懒加载
 * （见 src/lib/editor.ts 的 CDN_PATH、CONTENT_THEME_PATH、EMOJI_PATH），这些文件不在 Vditor
 * 的入口模块里、也进不了 vite 的模块图，必须原样躺在 public/vditor 下才会被复制进产物。
 *
 * 为什么改成构建期同步，而不是把这十几 MB 提交进仓库：
 * 1. 仓库不再背负大体积二进制资源；
 * 2. 资源版本与 package.json 锁定的 `vditor` 版本天然一致，不会再出现「手工维护的副本与
 *    依赖版本漂移」。此前那份副本正是手工放的，还被 .gitignore 里未加前导斜杠的 `dist/`
 *    规则连带忽略——从仓库克隆构建出来的程序会缺这些文件，表现为公式、图表、代码块高亮
 *    配色、表情面板图片全部加载失败，而本机因为文件尚在毫无察觉。
 *
 * 同步范围（`DIRS`）：只复制 `dist/` 下真正会被运行时请求的三个前缀。其余内容
 * （`index.js` / `index.min.js` / `method*.js` / `index.css` / `types/` / `ts/`）由 vite
 * 直接从 npm 包本体打包进前端 bundle，再往 public 里塞一份纯属重复，故一并排除。
 *
 * 排除项（**加回任何一项都必须同步更新 THIRD_PARTY_LICENSES.md**）：
 * - `js/graphviz`：EPL-1.0，不在本项目的许可证白名单内；
 * - `js/mathjax`：本项目数学公式走 KaTeX（editor.ts 的 math 选项），MathJax 未启用，纯属体积。
 *
 * 用法：node scripts/sync-vditor-assets.mjs（已挂到 npm 的 predev / prebuild 钩子，
 * 因此 `npm run dev` 与 `npm run build` 都会自动先跑一遍）
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "vditor", "dist");
const dest = join(root, "public", "vditor", "dist");

/** 需要同步的顶层目录：js = 引擎 / 语言脚本 / 图标与高亮样式，css = 正文主题，images = emoji 与占位图 */
const DIRS = ["js", "css", "images"];

/** `DIRS` 之内不再复制的路径（相对 `vditor/dist`） */
const EXCLUDED = ["js/graphviz", "js/mathjax"];

if (!existsSync(src)) {
  console.error(`找不到 Vditor 资源：${src}\n请先执行 npm install（或 npm ci）。`);
  process.exit(1);
}

const denied = EXCLUDED.map((rel) => join(src, ...rel.split("/")));
const isDenied = (path) => denied.some((d) => path === d || path.startsWith(d + sep));

// 先删后建：保证副本是依赖版本的严格镜像，不会留下上一版多出来的旧文件
rmSync(dest, { recursive: true, force: true });
for (const dir of DIRS) {
  const from = join(src, dir);
  if (!existsSync(from)) {
    console.error(`Vditor 发行包里缺少 dist/${dir} —— vditor 版本换了？请检查同步范围。`);
    process.exit(1);
  }
  cpSync(from, join(dest, dir), { recursive: true, filter: (path) => !isDenied(path) });
}

let files = 0;
let bytes = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else {
      files += 1;
      bytes += stat.size;
    }
  }
};
walk(dest);

console.log(
  `Vditor 资源已同步：${files} 个文件 / ${(bytes / 1024 / 1024).toFixed(1)} MB → public/vditor/dist` +
    `（同步 ${DIRS.join("、")}；已排除 ${EXCLUDED.join("、")}）`,
);

// 白名单之外若冒出新的顶层目录，多半是 Vditor 加了资源目录：提示一句，避免静默漏同步
const others = readdirSync(src, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !DIRS.includes(e.name))
  .map((e) => e.name);
if (others.length > 0) {
  console.log(`提示：vditor/dist 下还有未同步的目录 ${others.join("、")} —— 若其中有运行时需要的资源，请并入 DIRS。`);
}
