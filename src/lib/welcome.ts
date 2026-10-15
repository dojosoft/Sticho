/**
 * 欢迎页正文：配置目录 `docs/Welcome.<locale>.md` 的默认内容 + 读取器。
 *
 * 设计要点：
 * 1. **内容真源在 TS**（与 locales/themes/fonts 一致）：Rust 侧只负责「缺失时写入」，
 *    用户把文件改掉或删掉后不会被静默覆盖（删掉则下次启动重新释放一份默认的）。
 * 2. **按界面语言各放一份**：中文用 `Welcome.zh-CN.md`，英文用 `Welcome.en-US.md`；
 *    两份都读不到时，调用方回落到内置的 i18n 欢迎文案；非中文 / 英文界面语言统一用英文版。
 */
import { getDataRoot, readTextFile, writeTextFile, type DefaultPackFile } from "./tauri-api";

/** 支持「按界面语言读欢迎 md」的语种，与 i18n.LOCALES 的 id 一致 */
export const WELCOME_LOCALES = ["zh-CN", "en-US"] as const;

/**
 * 已从默认模板删掉的旧版宣传语（整行）。
 *
 * 存量安装的 `docs/Welcome.*.md` 是按「已存在即不覆盖」释放的，用户没删过就还留着这句；
 * 读取时按整行去掉并回写一次，保证界面上看不到它（只删这一行，不动用户的其它改动）。
 */
const LEGACY_WELCOME_LINES = [
  "轻量级 Markdown / 纯文本 / 代码 / HTML 文档编辑器 —— 打开、编辑与转换全部在本机完成，文档不上传。",
];

/** 去掉旧版遗留宣传语整行；未命中则原样返回（保证幂等，不影响已清理过的文件） */
function stripLegacyLines(text: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => !LEGACY_WELCOME_LINES.includes(line.trim()));
  if (kept.length === lines.length) return text;
  // 删行后可能出现连续空行：折叠成单个空行，保持段落间距整齐
  const out: string[] = [];
  for (const line of kept) {
    if (line.trim() === "" && out.length > 0 && out[out.length - 1]!.trim() === "") continue;
    out.push(line);
  }
  return out.join(eol);
}

const DOCS_DIR = "docs";
const fileOf = (locale: string): string => `Welcome.${locale}.md`;

/** 中文欢迎页正文 */
const WELCOME_ZH = [
  "# 欢迎使用 Sticho",
  "",
  "## 新手入门",
  "",
  "**1. 新建与打开**",
  "- 用工具栏或「文件」菜单新建 / 打开文档；也可以把 `.md` / `.html` / `.docx` / `.pdf` 直接拖进窗口。",
  "- 支持三类文档：**Markdown**、**HTML**（编辑并实时预览）、**代码文件**（打开 `.js` / `.py` 等自动按代码高亮）。",
  "",
  "**2. 快捷排版**",
  "- `Ctrl+B` 加粗、`Ctrl+I` 斜体、`Ctrl+K` 链接、`Ctrl+Shift+K` 代码块、`Ctrl+1`~`Ctrl+6` 各级标题。",
  "- 工具栏左侧下拉可在「所见即所得 / 即时渲染 / 分屏预览」三种视图之间切换。",
  "",
  "**3. 命令面板**",
  "- 按 `Ctrl+P` 搜索并执行菜单里的任意命令，不必记住它在哪一级菜单。",
  "",
  "**4. 侧边栏**",
  "- 文件目录树、大纲、属性与全文搜索都收在侧边栏；「搜索」标签能在当前文件夹内全文查找。",
  "- 顶栏按钮可收起 / 展开侧边栏。",
  "",
  "**5. 保存与导出**",
  "- `Ctrl+S` 保存、`Ctrl+Shift+S` 另存为；自动保存可在「设置」里开关。",
  "- 可导出 Word / PDF / HTML；配置 WebDAV 后还可把文档同步备份到云端目录。",
  "",
  "**6. 设置与帮助**",
  "- 「设置」里有界面语言、外观主题、阅读排版（字体 / 字号 / 行距）等；版本号与更新入口在「关于」。",
  "- 想再看一遍这份说明：菜单「帮助 → 入门指南」。",
  "",
  "---",
  "",
  "本页正文来自配置文件目录下的 `docs/Welcome.zh-CN.md`。你可以随意修改它：改动在重启后生效，只影响之后新建的标签，不会动你正在编辑的文档。",
  "",
].join("\n");

/** 英文欢迎页正文 */
const WELCOME_EN = [
  "# Welcome to Sticho",
  "",
  "A lightweight Markdown / plain text / code / HTML document editor — editing and conversions all happen on your machine; nothing is uploaded.",
  "",
  "## Getting started",
  "",
  "**1. Create or open**",
  "- Use the toolbar or the File menu, or drag a `.md` / `.html` / `.docx` / `.pdf` file into the window.",
  "- Three document types: **Markdown**, **HTML** (edit with a live preview) and **code files** (open `.js` / `.py` etc. for syntax highlighting).",
  "",
  "**2. Quick formatting**",
  "- `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link, `Ctrl+Shift+K` code block, `Ctrl+1`–`Ctrl+6` headings.",
  "- The left dropdown in the toolbar switches between WYSIWYG / Instant Rendering / Split View (SV) views.",
  "",
  "**3. Command palette**",
  "- Press `Ctrl+P` to search for and run any command in the menus.",
  "",
  "**4. Sidebar**",
  "- The sidebar holds the file tree, outline, properties and full-text search; the “Search” tab looks through the whole current folder.",
  "- The top-bar button shows or hides it.",
  "",
  "**5. Save and export**",
  "- `Ctrl+S` saves, `Ctrl+Shift+S` saves as; auto-save can be toggled in Settings.",
  "- Export to Word / PDF / HTML; with WebDAV configured you can also sync documents to a cloud folder.",
  "",
  "**6. Settings and help**",
  "- Settings covers interface language, theme and reading typography (font / size / line height); the version and update entry live under About.",
  "- To read this page again: Help → Getting Started.",
  "",
  "---",
  "",
  "This page is loaded from `docs/Welcome.en-US.md` in the app’s config folder. Feel free to edit it: changes take effect after a restart and only affect newly created tabs, never the document you are editing.",
  "",
].join("\n");

/** `docs/` 目录的说明文件 */
const DOCS_README = [
  "Sticho 欢迎页文件夹",
  "",
  "用法：本目录下的 Markdown 文件会作为「新建 / 首次打开」标签时的欢迎正文。",
  "- Welcome.zh-CN.md：界面语言为「简体中文」时使用",
  "- Welcome.en-US.md：界面语言为其它语言（英文）时使用",
  "",
  "说明：",
  "- 欢迎页只在程序启动时读取，改完请重启程序；改动只影响之后新建 / 首次打开的标签，",
  "  不会动当前正在编辑的文档（默认标签始终是未命名的，并不绑定本文件）。",
  "- 程序只在文件缺失时释放默认正文，已存在的文件不会被覆盖；删掉后会被重新释放一份默认的。",
  "  两份都读不到或内容为空时，界面回落到内置欢迎文案。",
  "- 本文件可以删掉，不影响程序运行。",
  "",
].join("\n");

/** 欢迎页默认文件（不带 version：仅缺失时释放，已存在即跳过，绝不覆盖用户改动） */
export const WELCOME_DOC_FILES: DefaultPackFile[] = [
  { dir: DOCS_DIR, name: "README.txt", content: DOCS_README },
  { dir: DOCS_DIR, name: fileOf("zh-CN"), content: WELCOME_ZH },
  { dir: DOCS_DIR, name: fileOf("en-US"), content: WELCOME_EN },
];

/** locale → 读到的正文；读不到的不入表，留给调用方回落内置文案 */
const welcomeCache = new Map<string, string>();

/** 数据根可能是 `C:\...` 或 `<exe>\Sticho`；统一用 `/` 拼接（Rust 的 Path 在 Windows 也吃 `/`） */
function joinUnderRoot(root: string, ...parts: string[]): string {
  return [root.replace(/[\\/]+$/, ""), ...parts].join("/");
}

/**
 * 启动时（释放默认包之后）读入两份欢迎 md。
 * 任何失败都静默降级：拿不到数据根、文件缺失 / 不可读 / 空白都视为「没有」。
 */
export async function loadWelcomeDocs(): Promise<void> {
  welcomeCache.clear();
  let root: string;
  try {
    root = await getDataRoot();
  } catch {
    return;
  }
  await Promise.all(
    WELCOME_LOCALES.map(async (loc) => {
      try {
        const path = joinUnderRoot(root, DOCS_DIR, fileOf(loc));
        const file = await readTextFile(path);
        // 存量文件里若还留着已下线的旧宣传语，去掉后回写一次（只删那一行，改动在下次启动可见）
        const content = stripLegacyLines(file.content);
        if (content !== file.content) {
          await writeTextFile(path, content, file.encoding).catch(() => {});
        }
        if (content.trim() !== "") welcomeCache.set(loc, content);
      } catch {
        /* 缺失 / 不可读：视为没有 */
      }
    }),
  );
}

/** 取某界面语言的欢迎正文：中文（含 zh-TW 等变体）用中文版，其余语言一律用英文版；未读到返回 null（由调用方回落内置文案） */
export function welcomeFor(locale: string): string | null {
  // 与 i18n / Vditor 的语言判定同一口径（按 zh 前缀），否则用户在 locales/ 里
  // 自建 zh-TW 语言包时，界面是中文而欢迎页却回落成英文版
  return welcomeCache.get(locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US") ?? null;
}
