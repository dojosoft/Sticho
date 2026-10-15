/**
 * 导出 HTML（任务书 F10：单文件、带内联样式、浏览器直接打开）
 *
 * 「内联样式」= CSS 全部内嵌在 <style> 标签（无外部 css 文件依赖），
 * 图片若为 data URI 则天然自包含，产物是真正的单文件。
 * 屏幕阅读向排版（居中栏宽），中文字体策略与导出 PDF 一致。
 */
import MarkdownIt from "markdown-it";
import { writeFileBase64 } from "./tauri-api";
import { toBase64 } from "./export-pdf";
import { applyAutoSpace } from "./typography";
import { makeT, type Locale } from "./i18n";

const md = new MarkdownIt({ html: false, linkify: true });
applyAutoSpace(md);

/**
 * 导出源类型：code（纯文本 / 源码文件）不能被当 Markdown 渲染——单换行会被合并成段、
 * 行首缩进被剥掉、`#`/`*` 会被解释成标题与强调，导出结果面目全非（与 export-pdf 的
 * kind 分支同一口径）。HTML 文档不经过本函数：App.svelte 对 html 源码走原样写出。
 */
export type HtmlExportKind = "markdown" | "code";

export async function exportHtml(
  path: string,
  markdown: string,
  locale: Locale = "zh-CN",
  entries?: Record<string, string>,
  kind: HtmlExportKind = "markdown",
): Promise<void> {
  const body =
    kind === "code" ? `<pre class="plain">${escapeHtml(markdown)}</pre>` : md.render(markdown);
  const html = buildStandaloneHtml(body, locale, entries);
  await writeFileBase64(path, toBase64(new TextEncoder().encode(html)));
}

/** HTML 文本转义（正文里可能出现 `&` `<` 等字符） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildStandaloneHtml(
  bodyHtml: string,
  locale: Locale,
  entries?: Record<string, string>,
): string {
  // 文档标题与 html lang 都跟随界面语言，避免中文界面导出到英文环境时错配
  // entries 为语言包合并词表：由调用方注入后自定义语言包也能生效
  const title = makeT(locale, entries)("Sticho Export Document");
  // lang / title 一律转义：与 export-pdf（buildPrintHtml）的口径一致，
  // 语言包值与 locale 再受限也不该原样拼进标记
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "SimSun", sans-serif;
    font-size: 16px;
    line-height: 1.75;
    color: #1f2328;
    background: #ffffff;
    margin: 0;
    padding: 2.5rem 1rem 5rem;
  }
  main { max-width: 820px; margin: 0 auto; }

  h1 { font-size: 1.9em; color: #0a3069; margin: 0 0 0.6em; }
  h2 { font-size: 1.45em; color: #0550ae; margin: 1.2em 0 0.5em; }
  h3 { font-size: 1.22em; margin: 1.1em 0 0.45em; }
  h4, h5, h6 { font-size: 1.05em; color: #57606a; margin: 1em 0 0.4em; }

  p { margin: 0.6em 0; }
  /* 段首缩进：仅正文段落（列表项、引用块内的段落不缩进） */
  main > p { text-indent: 2em; }

  code {
    font-family: Consolas, "Microsoft YaHei", monospace;
    font-size: 0.88em;
    background: #f0f1f3;
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
  a { color: #0969da; }
  del { color: #6e7781; }

  table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.94em; }
  th, td { border: 1px solid #c9ced4; padding: 6px 10px; text-align: left; }
  th { background: #eef2f5; font-weight: 600; }

  pre {
    background: #f5f6f8;
    border: 1px solid #dcdee2;
    border-radius: 6px;
    padding: 12px 14px;
    margin: 1em 0;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; font-size: 0.86em; line-height: 1.6; }
  /* 代码 / 纯文本文件直接导出：只要等宽换行，不要代码块的灰底与边框 */
  pre.plain { background: none; border: none; border-radius: 0; padding: 0; }

  blockquote {
    margin: 0.8em 0;
    padding: 0.3em 1em;
    border-left: 4px solid #b4b9c0;
    background: #f6f8fa;
    color: #57606a;
    border-radius: 0 4px 4px 0;
  }

  ul, ol { padding-left: 1.8em; margin: 0.6em 0; }
  li { margin: 0.25em 0; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #99a0a8; margin: 1.5em 0; }

  @media print {
    body { padding: 0; }
    @page { margin: 18mm 16mm; }
  }
</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>`;
}
