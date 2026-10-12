/**
 * 导出 Word（.docx）—— 任务书阶段 3
 *
 * 管道：Markdown --markdown-it--> HTML --DOMParser 递归遍历--> docx 元素树 --Packer--> .docx
 *
 * 为什么基于 HTML DOM 而非 markdown-it 的 token 流：
 * DOM 天然表达嵌套结构（列表嵌套、行内格式组合），遍历逻辑直观且不易漏分支。
 *
 * 中文字体（任务书 3.5，最易翻车处）：
 * Word 的 w:rFonts 有 ascii（西文）/ hAnsi（高位 ANSI）/ eastAsia（CJK）三个槽位，
 * 只设 name 时 Word 会把中文标点回落到默认宋体甚至方框。必须三处齐设 + hint: "eastAsia"。
 */
import MarkdownIt from "markdown-it";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { writeFileBase64 } from "./tauri-api";
import { applyAutoSpace } from "./typography";

// ---- 常量 ----
const CN_FONT = "微软雅黑";
const CODE_FONT = "Consolas";
const TEXT_COLOR = "1F2328";
const BORDER_COLOR = "C0C0C0";
const CODE_BG = "F5F5F5";

/** 中文字体三处齐设（ascii/eastAsia/hAnsi）+ hint 指向东亚槽位 */
function cnFont() {
  return { name: CN_FONT, ascii: CN_FONT, eastAsia: CN_FONT, hAnsi: CN_FONT, hint: "eastAsia" as const };
}

/** 代码字体：西文用 Consolas，eastAsia 槽位给雅黑（代码注释中的中文可读性更好） */
function codeFont() {
  return { name: CODE_FONT, ascii: CODE_FONT, eastAsia: CN_FONT, hAnsi: CODE_FONT, hint: "eastAsia" as const };
}

const md = new MarkdownIt({ html: false, linkify: true });
applyAutoSpace(md);

// ---- 行内元素 → (TextRun | ExternalHyperlink)[] ----

interface RunProps {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
}

/** 收集元素内的纯文本（用于超链接） */
function textOf(el: Element): string {
  return el.textContent ?? "";
}

function inlineRuns(el: Node, init: RunProps = {}): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];

  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) {
        out.push(
          new TextRun({
            text,
            font: init.code ? codeFont() : cnFont(),
            bold: init.bold,
            italics: init.italics,
            strike: init.strike,
            shading: init.code ? { fill: CODE_BG } : undefined,
          }),
        );
      }
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const node = child as Element;

    switch (node.tagName) {
      case "STRONG":
      case "B":
        out.push(...inlineRuns(node, { ...init, bold: true }));
        break;
      case "EM":
      case "I":
        out.push(...inlineRuns(node, { ...init, italics: true }));
        break;
      case "DEL":
      case "S":
        out.push(...inlineRuns(node, { ...init, strike: true }));
        break;
      case "CODE":
        out.push(...inlineRuns(node, { ...init, code: true }));
        break;
      case "A": {
        const href = node.getAttribute("href") ?? "";
        if (href) {
          out.push(
            new ExternalHyperlink({
              link: href,
              children: [
                new TextRun({ text: textOf(node), style: "Hyperlink", font: cnFont() }),
              ],
            }),
          );
        } else {
          out.push(...inlineRuns(node, init));
        }
        break;
      }
      case "BR":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      case "IMG": {
        const alt = node.getAttribute("alt") || "无描述";
        out.push(new TextRun({ text: `[图片：${alt}]`, italics: true, color: "6E7781", font: cnFont() }));
        break;
      }
      default:
        out.push(...inlineRuns(node, init)); // 未知行内标签：透明递归
    }
  });

  return out;
}

/** 表头单元格变体：内容整体加粗 */
function inlineRunsBold(el: Node): (TextRun | ExternalHyperlink)[] {
  return inlineRuns(el, { bold: true });
}

// ---- 块级元素 → (Paragraph | Table)[] ----

const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
};

function alignOf(el: Element): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const style = el.getAttribute("style") ?? "";
  if (style.includes("text-align:center")) return AlignmentType.CENTER;
  if (style.includes("text-align:right")) return AlignmentType.RIGHT;
  return undefined;
}

function renderBlocks(parent: Node, listLevel = 0, inQuote = false): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  // 引用块段落样式：整体缩进 + 左侧竖线
  const quoteStyle = inQuote
    ? {
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: "B4B9C0" } },
      }
    : {};

  parent.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").trim();
      if (t) out.push(new Paragraph({ children: [new TextRun({ text: t, font: cnFont() })] }));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;

    switch (el.tagName) {
      // ---- 标题（Word 导航窗格大纲依赖内置 Heading 样式）----
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        out.push(
          new Paragraph({
            heading: HEADING_MAP[el.tagName],
            alignment: alignOf(el),
            children: inlineRuns(el),
          }),
        );
        break;

      case "P": {
        // 段首缩进：仅正文段落（引用块内的段落不缩进，改由 quoteStyle 控制左缩进）。
        // 正文默认字号 10.5pt，2 字符 = 420 twips；firstLineChars 让 Word 按「2 字符」识别。
        const bodyIndent = inQuote ? {} : { indent: { firstLine: 420, firstLineChars: 200 } };
        out.push(
          new Paragraph({ alignment: alignOf(el), children: inlineRuns(el), ...bodyIndent, ...quoteStyle }),
        );
        break;
      }

      // ---- 列表（嵌套递归）----
      case "UL":
      case "OL":
        renderList(el, listLevel, out);
        break;

      // ---- 引用块：递归时带上引用样式 ----
      case "BLOCKQUOTE":
        out.push(...renderBlocks(el, listLevel, true));
        break;

      // ---- 代码块：等宽 + 灰底 + 细框（相邻段落边框在 Word 中融合为一块）----
      case "PRE": {
        const code = el.querySelector("code")?.textContent ?? el.textContent ?? "";
        code
          .replace(/\n$/, "")
          .split("\n")
          .forEach((line) => {
            out.push(
              new Paragraph({
                shading: { fill: CODE_BG },
                spacing: { after: 0, line: 280 },
                border: {
                  top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
                  left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
                  right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
                },
                children: [new TextRun({ text: line || " ", font: codeFont(), size: 19, color: "24292F" })],
              }),
            );
          });
        out.push(new Paragraph({ text: "", spacing: { after: 60 } }));
        break;
      }

      case "TABLE":
        out.push(renderTable(el));
        break;

      // ---- 水平线：空段落 + 底边框 ----
      case "HR":
        out.push(
          new Paragraph({
            spacing: { before: 120, after: 120 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999" } },
          }),
        );
        break;

      default:
        out.push(...renderBlocks(el, listLevel));
    }
  });

  return out;
}

/** 列表：li 的子节点拆成「行内内容」与「嵌套子列表」分别处理 */
function renderList(listEl: Element, level: number, out: (Paragraph | Table)[]): void {
  const ordered = listEl.tagName === "OL";

  Array.from(listEl.children)
    .filter((c) => c.tagName === "LI")
    .forEach((li) => {
      // 本级行内内容（跳过子列表节点）
      const holder = document.createElement("span");
      Array.from(li.childNodes).forEach((c) => {
        if (c.nodeType === Node.ELEMENT_NODE && ["UL", "OL"].includes((c as Element).tagName)) return;
        holder.appendChild(c.cloneNode(true));
      });

      const runs = inlineRuns(holder);
      out.push(
        new Paragraph({
          children: runs.length ? runs : [new TextRun({ text: "", font: cnFont() })],
          ...(ordered
            ? { numbering: { reference: "md-ordered", level } }
            : { bullet: { level } }),
        }),
      );

      // 嵌套子列表
      Array.from(li.children)
        .filter((c) => c.tagName === "UL" || c.tagName === "OL")
        .forEach((sub) => renderList(sub, level + 1, out));
    });
}

function renderTable(tableEl: Element): Table {
  const rows: TableRow[] = [];

  Array.from(tableEl.querySelectorAll("tr")).forEach((tr, rowIndex) => {
    const isHeader = rowIndex === 0;
    const cells: TableCell[] = [];

    Array.from(tr.querySelectorAll("th, td")).forEach((cell) => {
      cells.push(
        new TableCell({
          shading: isHeader ? { fill: "EFF2F5" } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            new Paragraph({
              alignment: alignOf(cell),
              children: (isHeader ? inlineRunsBold(cell) : inlineRuns(cell)) as TextRun[],
            }),
          ],
        }),
      );
    });

    if (cells.length) rows.push(new TableRow({ children: cells }));
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
    // 表格边框（任务书验收：表格要有边框）
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDER_COLOR },
    },
  });
}

// ---- 主入口 ----

export async function exportDocx(path: string, markdown: string): Promise<void> {
  const html = md.render(markdown);
  const dom = new DOMParser().parseFromString(html, "text/html");
  const blocks = renderBlocks(dom.body);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: cnFont(), size: 21, color: TEXT_COLOR }, // 10.5pt ≈ 五号
          paragraph: { spacing: { line: 312, after: 120 } }, // 1.3 倍行距，段后 6pt
        },
        // 标题样式中文字体三处齐设（否则标题中文回落宋体）
        heading1: { run: { font: cnFont(), size: 36, bold: true, color: "0A3069" } },
        heading2: { run: { font: cnFont(), size: 32, bold: true, color: "0550AE" } },
        heading3: { run: { font: cnFont(), size: 28, bold: true, color: TEXT_COLOR } },
        heading4: { run: { font: cnFont(), size: 24, bold: true, color: TEXT_COLOR } },
        heading5: { run: { font: cnFont(), size: 22, bold: true, color: TEXT_COLOR } },
        heading6: { run: { font: cnFont(), size: 20, bold: true, color: "6E7781" } },
      },
    },
    numbering: {
      config: [
        {
          reference: "md-ordered",
          levels: [0, 1, 2, 3].map((i) => ({
            level: i,
            format: LevelFormat.DECIMAL,
            text: `%${i + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 + 480 * i, hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: blocks }],
  });

  const blob = await Packer.toBlob(doc);
  await writeFileBase64(path, await blobToBase64(blob));
}

/** Blob → base64（分块避免 String.fromCharCode 参数上限） */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
