/**
 * 导出纯文本（阶段 10：文件菜单 → 导出 → 导出为 txt）
 *
 * 路线：Markdown → HTML（markdown-it，与 HTML 导出同一套渲染规则）→
 * 按块级元素抽取纯文本。相比用正则剥离 Markdown 标记，这条路线对
 * 列表、引用、表格等结构的处理更稳定，也不会误伤正文里的 * _ # 等字符。
 */
import MarkdownIt from "markdown-it";
import { writeTextFile } from "./tauri-api";

const md = new MarkdownIt({ html: false, linkify: false, breaks: false });

/** 块级元素：进入/离开时补换行，保证段落之间不粘连 */
const BLOCK_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "BLOCKQUOTE", "PRE", "TR", "UL", "OL", "TABLE", "SECTION", "ARTICLE",
]);

function collect(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node as Text).data);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as HTMLElement;
  const tag = el.tagName;

  if (tag === "BR") {
    out.push("\n");
    return;
  }
  if (tag === "HR") {
    out.push("\n----------\n");
    return;
  }
  // 表格单元格用制表符分隔，粘贴到 Excel / 记事本时仍保持列结构
  if (tag === "TD" || tag === "TH") out.push("\t");

  const block = BLOCK_TAGS.has(tag);
  if (block) out.push("\n");
  el.childNodes.forEach((child) => collect(child, out));
  if (block) out.push("\n");
}

/**
 * 源类型：Markdown 要渲染后再抽正文；代码 / 纯文本 / HTML 源码必须原样导出——
 * 过一遍 markdown-it 会把单换行并成段、行首缩进剥掉、把 `#` `*` 当语法
 * （与 export-pdf、export-html 的 kind 分支同一口径）。
 */
export type TextExportKind = "markdown" | "code";

/** Markdown 源码 → 纯文本 */
export function markdownToPlainText(source: string, kind: TextExportKind = "markdown"): string {
  if (kind === "code") return source;
  const doc = new DOMParser().parseFromString(md.render(source), "text/html");
  const out: string[] = [];
  collect(doc.body, out);
  const text = out
    .join("")
    .replace(/[ \t]+\n/g, "\n") // 行尾空白
    .replace(/\n{3,}/g, "\n\n") // 连续空行压缩为一段间距
    .trim();
  // 空文档就该导出成空文件：无条件补换行会凭空多出内容
  return text === "" ? "" : text + "\n";
}

/** 导出为 .txt（走与 Markdown 保存相同的原子写通道；纯文本导出统一 UTF-8） */
export async function exportTxt(
  path: string,
  source: string,
  kind: TextExportKind = "markdown",
): Promise<void> {
  await writeTextFile(path, markdownToPlainText(source, kind), "utf-8");
}
