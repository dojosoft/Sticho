# 第三方许可证声明（THIRD_PARTY_LICENSES.md）

> 本文件按任务书 2.2 节要求维护：所有直接依赖必须为「可商用 + 可闭源 + 无传染性」许可证。
> 每次新增依赖必须同步更新本文件。**GPL 系依赖禁止链接进本项目**（Pandoc 例外条款见文末）。

## npm 依赖（前端）

| 包名 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| `@tauri-apps/api` | ^2.1 | MIT OR Apache-2.0 | Tauri 前端 API |
| `@tauri-apps/plugin-dialog` | ^2.0 | MIT OR Apache-2.0 | 文件打开/保存对话框 |
| `@tauri-apps/plugin-store` | ^2.0 | MIT OR Apache-2.0 | 轻量键值存储（主题/最近文件记忆） |
| `@tauri-apps/plugin-clipboard-manager` | ^2.3 | MIT OR Apache-2.0 | 原生剪贴板（编辑菜单剪切/复制/粘贴） |
| `vditor` | ^3.11 | MIT | Markdown 编辑器内核 |
| `markdown-it` | ^14 | MIT | MD→HTML 渲染（导出管道） |
| `docx` | ^9 | MIT | 生成 .docx（导出 Word） |
| `pdfjs-dist` | ^4.10 | Apache-2.0 | 导入 PDF：文本层抽取（仅运行时解析，无传染性） |
| `turndown` | ^7.2 | MIT | 导入 HTML：HTML→Markdown 转换 |
| `turndown-plugin-gfm` | ^1.0 | MIT | turndown 的 GFM 扩展（表格/删除线/任务列表） |
| `@codemirror/*`（state / view / commands / language / search / autocomplete / legacy-modes 及各 `lang-*`） | ^6 | MIT | 代码文件视图内核、各语言模式与查找替换 |
| `@lezer/highlight` | ^1.2 | MIT | 代码高亮的标签体系 |
| `@tauri-apps/cli` | ^2.1 | MIT OR Apache-2.0 | Tauri CLI（开发期） |
| `@sveltejs/vite-plugin-svelte` | ^5.0 | MIT | Svelte 的 Vite 插件（开发期） |
| `svelte` | ^5.16 | MIT | 前端框架 |
| `typescript` | ^5.7 | Apache-2.0 | 类型系统（开发期） |
| `vite` | ^6.0 | MIT | 构建工具（开发期） |

## Rust 依赖（后端，经 Cargo.lock 传递闭包）

| crate | 版本 | 许可证 | 用途 |
|---|---|---|---|
| `tauri` | ^2 | MIT OR Apache-2.0 | 桌面框架 |
| `tauri-plugin-dialog` | ^2 | MIT OR Apache-2.0 | 对话框（Rust 侧） |
| `tauri-plugin-store` | ^2 | MIT OR Apache-2.0 | 键值存储（Rust 侧） |
| `tauri-plugin-single-instance` | ^2 | MIT OR Apache-2.0 | 单实例：文件关联后双击复用已有窗口 |
| `tauri-plugin-clipboard-manager` | ^2 | MIT OR Apache-2.0 | 原生剪贴板（Rust 侧） |
| `base64` | ^0.22 | MIT OR Apache-2.0 | 导出二进制 base64 编解码 |
| `webview2-com` | ^0.38 | MIT | PDF 导出：WebView2 COM 打印接口（wry 传递依赖，零额外体积） |
| `windows-core` | ^0.61 | MIT OR Apache-2.0 | COM 回调实现宏（wry 传递依赖） |
| `ureq` | ^2 | MIT OR Apache-2.0 | 下载 Pandoc 发行包（rustls，无 OpenSSL） |
| `zip` | ^2 | MIT OR Apache-2.0 | 解压 Pandoc 发行包 |
| `encoding_rs` | ^0.8 | (Apache-2.0 OR MIT) AND BSD-3-Clause | 文本编解码 |
| `chardetng` | ^0.1 | Apache-2.0 OR MIT | 打开文件时的编码嗅探（Firefox 组件） |
| `winreg` | ^0.52 | MIT | 文件关联与右键菜单读写 HKCU |
| `windows-sys` | ^0.61 | MIT OR Apache-2.0 | 原生对话框、打开链接、WebView2 注册表检测 |
| `sha2` | ^0.10 | MIT OR Apache-2.0 | Pandoc 发行包完整性校验 |
| `tauri-build` | ^2 | MIT OR Apache-2.0 | 构建脚本（开发期） |
| `serde` / `serde_json` | ^1 | MIT OR Apache-2.0 | 序列化 |

> 注：`serde` 传递依赖 `proc-macro2`/`quote`/`syn` 均为 MIT OR Apache-2.0；
> `tauri` 传递依赖（`wry`、`tao`、`miniserve` 等）均为 MIT OR Apache-2.0 / BSD-3-Clause / Zlib，全部位于白名单内。
>
> **阶段 8 传递依赖抽查（共约 190 个 crate）结论**：除白名单内许可外，存在两类白名单之外但宽松可商用的许可——
> 1. `webpki-roots`（TLS 根证书数据，`ureq`→`rustls` 链路）：**CDLA-Permissive-2.0**，类 BSD 的宽松数据许可，可闭源分发
> 2. `icu_*` / `zerovec` / `zerofrom` / `litemap` 等（`url`→`idna` 链路的 Unicode 国际化库）：**Unicode-3.0**，OSI 认证的类 BSD 宽松许可
>
> 两者均无传染性、允许闭源商用；`ring`（`rustls` 加密后端）为 Apache-2.0 AND ISC，在白名单内。

## 内置第三方引擎（随 Vditor 发行包内嵌于 `public/vditor/dist/js`）

> 这些引擎不是 npm / Cargo 依赖，而是随 `vditor` 发行包一同落进 `public/vditor/dist/js` 的运行时资源，
> 由 Vditor 在渲染 mermaid / echarts / 数学公式等代码块时按需从本地目录懒加载
> （见 `src/lib/editor.ts` 的 `CDN_PATH`），全程不联网。下表列全并逐项确认「可商用 + 可闭源 + 无传染性」。

| 引擎 | 目录 | 许可证 | 用途 |
|---|---|---|---|
| Lute | `lute/` | MIT | Markdown 解析/渲染内核（Vditor 自带） |
| Mermaid | `mermaid/` | MIT | mermaid 代码块：流程图 / 时序图 |
| KaTeX（含 mhchem） | `katex/`（含 `fonts/`） | MIT | `$…$` 数学公式与化学式 |
| ECharts | `echarts/` | Apache-2.0 | echarts 代码块：图表 |
| abcjs | `abcjs/` | MIT | abc 代码块：乐谱 |
| flowchart.js | `flowchart.js/` | MIT | flowchart 代码块：流程图 |
| WaveDrom | `wavedrom/` | MIT | wavedrom 代码块：时序波形 |
| plantuml-encoder | `plantuml/` | MIT | PlantUML 源码编码 |
| markmap | `markmap/` | MIT | markmap 代码块：思维导图 |
| highlight.js | `highlight.js/`（含 `styles/`） | BSD-3-Clause | 代码块语法高亮 |
| smiles-drawer | `smiles-drawer/` | MIT | smiles 代码块：化学结构式 |
| Vditor 图标 / 语言包 / emoji | `icons/`、`i18n/`、`../images/emoji/` | MIT | 工具栏图标、界面文案、emoji 素材 |

> 许可原始文件：`highlight.js/LICENSE`（BSD-3-Clause）、`wavedrom/LICENSE.WaveDrom`（MIT）；
> 其余引擎的许可随各自上游发行包声明，均为上表所列宽松许可。
>
> **已移除**：Graphviz（`graphviz/viz.js` + `full.render.js`）为 **EPL-1.0**（Eclipse Public License，
> 具弱传染性的互惠许可，不在本项目白名单内）。编辑器工具栏未提供 Graphviz 入口（见 `editor.ts`），
> 故按「移除未使用能力」原则整目录删除，避免白名单外许可随包分发。
> 删除后 graphviz / dot 代码块不再渲染（与其余未启用引擎表现一致）。
>
> **同步机制（构建期）**：上表资源由 `scripts/sync-vditor-assets.mjs` 在 `predev` / `prebuild`
> 时从 `node_modules/vditor/dist` 同步到 `public/vditor/dist`（只同步 `js/`、`css/`、`images/`），
> 仓库不保存这份约 12MB 的副本。脚本里的排除项 `js/graphviz`（EPL-1.0）与 `js/mathjax`（本项目
> 数学走 KaTeX，未启用）是**许可证与体积的硬约束**：加回任何一项都必须先在本文件登记。

## 例外条款：Pandoc（阶段 5 引入时生效）

- **Pandoc**（GPL-2.0）：以独立 `pandoc.exe` 可执行文件形式存在，通过子进程（`std::process::Command`）调用，
  **不链接其任何源码或库**。依据 GPL-FAQ，独立进程边界不构成"衍生作品"，故本项目的闭源分发不受传染。
- 分发位置：不随主安装包分发（体积约 180MB），首次使用「导入 Word」功能时引导下载到用户数据目录。
- 官方源：https://github.com/jgm/pandoc/releases

---

*最后更新：发布前审查（补齐 npm / Rust 直接依赖清单，登记 Vditor 运行资源的构建期同步与排除项）*
