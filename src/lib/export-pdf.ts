/**
 * 导出 PDF（任务书阶段 4）
 *
 * 与 Rust 侧 export_pdf 命令配合：
 * 这里负责把 Markdown 组装成「完整打印 HTML」（@page 规则 + 中文字体 + 打印样式），
 * WebView2 在不可见窗口中加载后由 COM 接口 PrintToPdf 静默输出 PDF。
 *
 * 中文字体策略（开工前确认的方案）：
 * 打印 CSS 显式声明 "Microsoft YaHei"（Win10/11 内置），WebView2 用系统
 * DirectWrite 渲染，无内嵌字体文件、无联网，中文不可能出方块。
 *
 * 页眉页脚（批次九补全）：页码与文档名由 Rust 侧 CDP 的 headerTemplate /
 * footerTemplate 生成，其中页眉取 `<span class="title">`——它来自本文件的 `<title>`，
 * 所以这里必须把文档名传进来。
 */
import MarkdownIt from "markdown-it";
import { invoke } from "@tauri-apps/api/core";
import { applyAutoSpace } from "./typography";

const md = new MarkdownIt({ html: false, linkify: true });
applyAutoSpace(md);

/** 导出源类型：与打印（print.ts 的 PrintKind）一致，HTML / 纯文本不能被当 Markdown 渲染 */
export type ExportKind = "markdown" | "html" | "code";

/**
 * 导出 PDF。
 *
 * `title` 为文档主名，写入打印 HTML 的 `<title>`，由页眉模板取出显示。
 * `locale` 写入 `<html lang>`，让打印环境按界面语言排版（标点、断行规则）。
 * `kind` 决定正文怎么来：HTML 文档必须原样出 HTML（否则标签会被转义成源码文本），
 * 纯文本文件按等宽纯文本出，只有 Markdown 才走渲染。
 */
export async function exportPdf(
  path: string,
  source: string,
  title = "",
  locale = "zh-CN",
  kind: ExportKind = "markdown",
): Promise<void> {
  const body =
    kind === "html"
      ? sanitizeHtmlBody(source)
      : kind === "code"
        ? `<pre class="plain">${escapeHtml(source)}</pre>`
        : md.render(source);
  const html = buildPrintHtml(body, title, locale);
  await invoke("export_pdf", { path, htmlB64: toBase64(new TextEncoder().encode(html)) });
}

/**
 * HTML 文档导出前的净化。
 *
 * Rust 侧会把这份 HTML 落成临时文件交给隐藏 WebView 渲染，而本应用 CSP 允许 inline
 * 脚本、隐藏窗口同样会执行它们，所以先摘掉 `<script>` 与 `on*` 事件属性——
 * 只留下结构与样式，导出结果与「打印」看到的一致。
 */
function sanitizeHtmlBody(source: string): string {
  const doc = new DOMParser().parseFromString(source, "text/html");
  doc.querySelectorAll("script, noscript").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  });
  return doc.body ? doc.body.innerHTML : "";
}

/** HTML 文本转义（title 里可能出现 `&` `<` 等字符） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 完整打印文档：A4 纵向 + 中文排版 + 分页控制。导出 PDF 与「打印」共用同一份样式 */
export function buildPrintHtml(bodyHtml: string, title: string, locale = "zh-CN"): string {
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  /* 页边距只在 @page 上设一次：正文再用 body margin 会与打印参数叠加成双倍边距 */
  @page { size: A4 portrait; margin: 0.7in; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "SimSun", sans-serif;
    font-size: 10.5pt;          /* 五号字 */
    line-height: 1.75;
    color: #1f2328;
    margin: 0;                   /* 边距由 @page / 打印参数负责 */
  }

  /* ---- 标题 ---- */
  h1 { font-size: 19pt; color: #0a3069; margin: 0 0 0.6em; }
  h2 { font-size: 14.5pt; color: #0550ae; margin: 1.1em 0 0.45em; page-break-after: avoid; }
  h3 { font-size: 12.5pt; margin: 1em 0 0.4em; page-break-after: avoid; }
  h4 { font-size: 11.5pt; margin: 0.9em 0 0.35em; page-break-after: avoid; }
  h5, h6 { font-size: 10.5pt; color: #57606a; margin: 0.8em 0 0.3em; page-break-after: avoid; }

  p { margin: 0.45em 0; }
  /* 段首缩进：仅正文段落（列表项、引用块内的段落不缩进） */
  body > p { text-indent: 2em; }

  /* ---- 行内 ---- */
  code {
    font-family: Consolas, "Microsoft YaHei", monospace;
    font-size: 9pt;
    background: #f0f0f0;
    padding: 0.5pt 3pt;
    border-radius: 2pt;
  }
  a { color: #0969da; text-decoration: none; }
  del { color: #6e7781; }

  /* ---- 表格：边框 + 表头底色 + 防跨页断行 ---- */
  table { width: 100%; border-collapse: collapse; margin: 0.7em 0; font-size: 9.5pt; }
  th, td { border: 0.75pt solid #9aa0a6; padding: 4pt 7pt; text-align: left; }
  th { background: #eef2f5; font-weight: 600; }
  tr { page-break-inside: avoid; }

  /* ---- 代码块：灰底等宽 + 长行换行（防溢出页宽）---- */
  pre {
    background: #f5f5f5;
    border: 0.75pt solid #c9ced4;
    padding: 8pt 10pt;
    margin: 0.7em 0;
    white-space: pre-wrap;
    word-break: break-all;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; font-size: 9pt; line-height: 1.5; }
  /* 纯文本 / 代码文件的打印：只要等宽换行，不要灰底与边框（那圈框打印出来很难看） */
  pre.plain {
    background: none;
    border: none;
    padding: 0;
    page-break-inside: auto;
  }

  /* ---- 引用块 ---- */
  blockquote {
    margin: 0.6em 0;
    padding: 0.25em 1em;
    border-left: 2.5pt solid #b4b9c0;
    background: #f6f8fa;
    color: #57606a;
  }
  blockquote p { margin: 0.3em 0; }

  /* ---- 列表 / 图片 / 分隔线 ---- */
  ul, ol { padding-left: 1.7em; margin: 0.5em 0; }
  li { margin: 0.2em 0; }
  img { max-width: 100%; }
  hr { border: none; border-top: 0.75pt solid #99a0a8; margin: 1em 0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** Uint8Array → base64（分块避免参数上限）；导出 HTML 复用同一实现 */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
