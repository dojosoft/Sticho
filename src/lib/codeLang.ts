/**
 * 代码文件的扩展名 → 语言 映射表，以及代码文件的统一白名单。
 *
 * 为什么要集中在一处：打开对话框（筛选器）、目录树、拖拽、启动参数四个入口都要判断
 * 「这个文件算不算代码文件」。以前 Markdown/HTML 的白名单是四处各写一份，结果很容易
 * 出现「能拖进来但点不开」。这里统一成一个 `CODEX_EXTS`，所有入口都读它。
 *
 * 语言扩展一律懒加载（`load` 里 `await import`），首屏不因为装了 20 个语言包而变慢。
 */

import type { StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/** 一种代码语言：状态栏显示名、缩进单位、以及懒加载的 CodeMirror 扩展 */
export interface CodeLangSpec {
  /** 状态栏显示的语言名 */
  name: string;
  /** 缩进单位：数字 = 空格数，"tab" = 制表符 */
  indentUnit: number | "tab";
  /** 按需加载该语言的 CodeMirror 扩展 */
  load: () => Promise<Extension>;
}

/**
 * 把 legacy-modes 的 StreamParser 包成 CM 扩展。
 *
 * StreamLanguage 走动态 import：本文件的映射表（扩展名判断、语言名）被启动路径
 * 静态引用，若静态引入 @codemirror/language 会把整套 CodeMirror 拖进主包。
 */
function legacy(
  loader: () => Promise<Record<string, StreamParser<unknown>>>,
  key: string,
): () => Promise<Extension> {
  return async () => {
    const { StreamLanguage } = await import("@codemirror/language");
    return StreamLanguage.define((await loader())[key]);
  };
}

const LANGS: Record<string, CodeLangSpec> = {
  python: {
    name: "Python",
    indentUnit: 4,
    load: async () => (await import("@codemirror/lang-python")).python(),
  },
  batch: { name: "Batch", indentUnit: 2, load: async () => (await import("./batchLang")).batch() },
  powershell: {
    name: "PowerShell",
    indentUnit: 4,
    load: legacy(() => import("@codemirror/legacy-modes/mode/powershell"), "powerShell"),
  },
  shell: {
    name: "Shell",
    indentUnit: 2,
    load: legacy(() => import("@codemirror/legacy-modes/mode/shell"), "shell"),
  },
  javascript: {
    name: "JavaScript",
    indentUnit: 2,
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: false }),
  },
  "javascript-jsx": {
    name: "JavaScript (JSX)",
    indentUnit: 2,
    load: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  },
  typescript: {
    name: "TypeScript",
    indentUnit: 2,
    load: async () =>
      (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  },
  "typescript-jsx": {
    name: "TypeScript (TSX)",
    indentUnit: 2,
    load: async () =>
      (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
  },
  json: {
    name: "JSON",
    indentUnit: 2,
    load: async () => (await import("@codemirror/lang-json")).json(),
  },
  xml: {
    name: "XML",
    indentUnit: 2,
    load: async () => (await import("@codemirror/lang-xml")).xml(),
  },
  html: {
    name: "HTML",
    indentUnit: 2,
    load: async () => (await import("@codemirror/lang-html")).html(),
  },
  css: {
    name: "CSS",
    indentUnit: 2,
    load: async () => (await import("@codemirror/lang-css")).css(),
  },
  yaml: {
    name: "YAML",
    indentUnit: 2,
    load: async () => (await import("@codemirror/lang-yaml")).yaml(),
  },
  toml: {
    name: "TOML",
    indentUnit: 2,
    load: legacy(() => import("@codemirror/legacy-modes/mode/toml"), "toml"),
  },
  properties: {
    name: "Properties",
    indentUnit: 2,
    load: legacy(() => import("@codemirror/legacy-modes/mode/properties"), "properties"),
  },
  sql: {
    name: "SQL",
    indentUnit: 2,
    load: async () => (await import("@codemirror/lang-sql")).sql(),
  },
  cpp: {
    name: "C/C++",
    indentUnit: 4,
    load: async () => (await import("@codemirror/lang-cpp")).cpp(),
  },
  rust: {
    name: "Rust",
    indentUnit: 4,
    load: async () => (await import("@codemirror/lang-rust")).rust(),
  },
  go: {
    name: "Go",
    indentUnit: "tab",
    load: async () => (await import("@codemirror/lang-go")).go(),
  },
  java: {
    name: "Java",
    indentUnit: 4,
    load: async () => (await import("@codemirror/lang-java")).java(),
  },
};

/** 扩展名（小写，不含点）→ 语言 id */
const EXT_LANG: Record<string, string> = {
  py: "python",
  pyw: "python",
  bat: "batch",
  cmd: "batch",
  dos: "batch",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ksh: "shell",
  dash: "shell",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript-jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript-jsx",
  json: "json",
  jsonc: "json",
  xml: "xml",
  svg: "xml",
  xsl: "xml",
  xsd: "xml",
  plist: "xml",
  html: "html",
  htm: "html",
  css: "css",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "properties",
  cfg: "properties",
  conf: "properties",
  properties: "properties",
  env: "properties",
  sql: "sql",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  rs: "rust",
  go: "go",
  java: "java",
};

/**
 * .html / .htm 仍走原有的 HTML 文档通路（iframe 预览 + 源码编辑），
 * 不能被当成代码文件，否则会改坏既有行为。
 */
const HTML_DOC_EXTS = new Set(["html", "htm"]);

/**
 * 代码文件白名单。
 *
 * 额外含空串：无扩展名的文件（Makefile、LICENSE 之类）也按纯文本代码打开——
 * 有扩展名的二进制（.exe/.png/.zip）都会被白名单挡在外面，所以这条不会误开二进制。
 *
 * 另额外含 "txt"：纯文本按代码视图打开（默认无高亮，可在「视图 → 语法高亮语言」
 * 手动选语言），不再走 Markdown 渲染——.txt 里放几行 Python 是常见用法。
 */
export const CODEX_EXTS: ReadonlySet<string> = new Set([
  ...Object.keys(EXT_LANG).filter((ext) => !HTML_DOC_EXTS.has(ext)),
  "",
  "txt",
]);

/**
 * 代码文件的体积分界线。
 *
 * 判据是**字符数（UTF-16 码元）**，即 `text.length`，与常量名里的「字节」并不等价：
 * CJK 占比高的文件按 UTF-8 可能是这里的两三倍字节数。选码元而非字节是有意的——
 * CodeMirror 的索引开销本来就与码元数成正比。名字沿用历史叫法，不要在调用点上按字节理解。
 *
 * CodeMirror 的语法高亮、折叠、补全都要在整篇文档上建索引，几 MB 的源码会让挂载
 * 与每次输入都明显卡顿。超过这条线的代码文件因此不交给 CodeMirror，改走
 * 「只读分节纯文本」——复用大文档的 LargeReader（滚动虚拟化 + 行号 + 查找），
 * 代价是没有语法高亮。详见《代码文件语法高亮与代码编辑能力实施计划》第五节。
 */
export const CODE_LARGE_BYTES = 2 * 1024 * 1024;

/** 取路径的扩展名（小写、不含点）。无扩展名与 `.gitignore` 这类隐藏文件都返回空串 */
export function extOf(path: string): string {
  const base = path.toLowerCase().split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

/** 该扩展名是否按代码文件打开 */
export function isCodeExt(ext: string): boolean {
  return CODEX_EXTS.has(ext.toLowerCase());
}

/** 该路径是否按代码文件打开 */
export function isCodePath(path: string): boolean {
  return isCodeExt(extOf(path));
}

/** 该扩展名对应的语言 id；无对应语言（纯文本/未收录）返回 null */
export function codeLangIdForExt(ext: string): string | null {
  return EXT_LANG[ext.toLowerCase()] ?? null;
}

/** 该扩展名对应的语言；无对应语言（纯文本/未收录）返回 null */
export function codeLangForExt(ext: string): CodeLangSpec | null {
  return codeLangForId(codeLangIdForExt(ext));
}

/** 语言 id → 规格；`null`（或未知 id）表示纯文本，即不做语法高亮 */
export function codeLangForId(id: string | null): CodeLangSpec | null {
  return id ? (LANGS[id] ?? null) : null;
}

/** 代码文件在状态栏显示的语言名 */
export function codeLangName(ext: string): string {
  return codeLangForId(codeLangIdForExt(ext))?.name ?? PLAIN_TEXT_NAME;
}

/** 语言 id 对应的显示名（未知 id / null 一律回退纯文本） */
export function codeLangNameById(id: string | null): string {
  return codeLangForId(id)?.name ?? PLAIN_TEXT_NAME;
}

/** 没有对应语言时的显示名（状态栏与「视图 → 语法高亮语言」共用同一份文案） */
export const PLAIN_TEXT_NAME = "Plain Text";

/**
 * 「视图 → 语法高亮语言」子菜单用的语言清单。
 *
 * 顺序固定：按显示名排序一次并缓存，避免每次展开菜单都重排（也让菜单项位置稳定）。
 * 扩展名与语言是多对一（py/pyw → Python），这里只列语言本身。
 */
export const LANG_LIST: readonly { id: string; name: string }[] = Object.entries(LANGS)
  .map(([id, spec]) => ({ id, name: spec.name }))
  .sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));

/** 打开对话框用的筛选器扩展名（不含空串，按字母序） */
export const CODE_EXTS_SORTED: readonly string[] = Array.from(CODEX_EXTS)
  .filter((ext) => ext !== "")
  .sort();