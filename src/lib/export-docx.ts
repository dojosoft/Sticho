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
 *
 * 图片与 Mermaid（批次九补全）：渲染阶段（inlineRuns）是同步的，而图片要读盘、
 * Mermaid 要走浏览器渲染，都是异步的。故导出前先做一遍「预取」——把图片字节与
 * Mermaid 图准备好放进缓存，渲染时按 src / 源码命中，命中不到就回落成占位文字
 * （旧行为），单张图失败绝不影响整篇导出。
 */
import MarkdownIt from "markdown-it";
import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { readImageBase64, writeFileBase64 } from "./tauri-api";
import { classifyImageSrc, decodeDataUri, resolveLocalImagePath } from "./imageSrc";
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

// ---- 图片嵌入（预取缓存）----

/** 正文最大宽度（px）：A4 去掉 1 英寸边距约 602px，超出的插图按比例缩放 */
const MAX_IMAGE_WIDTH = 600;

/** 已备好、可直接嵌入的图片 */
export type DocxImage = {
  data: Uint8Array;
  width: number;
  height: number;
  /** docx 只认得这四种位图；SVG/WebP 一律不嵌入（保持占位文字） */
  type: "png" | "jpg" | "gif" | "bmp";
};

export type DocxExportOptions = {
  /** 文档所在目录（解析相对路径图片）；未保存的文档传 null */
  baseDir?: string | null;
  /** Mermaid 源码 → PNG；不提供时 mermaid 代码块按普通代码块导出 */
  renderMermaid?: (code: string) => Promise<DocxImage | null>;
  /**
   * 取词函数（键 = 英文原文）。用于把「未能嵌入的图片说明」与占位文字并入当前界面语言；
   * 不提供时原样返回英文键（兜底英文，与界面未覆盖处一致）。
   */
  t?: (key: string, vars?: Record<string, string | number>) => string;
};

export type DocxExportResult = {
  /** 实际嵌入的图片数量（含 Mermaid 图） */
  embedded: number;
  /** 未能嵌入的图片说明，供调用方汇总提示 */
  skipped: string[];
};

/**
 * 单次导出的上下文：图片 / Mermaid 缓存、未嵌入清单、计数与取词函数全部装在对象里，
 * 由 exportDocx 每次导出新建后逐层传入，避免模块级可变状态跨次导出互相污染
 * （图片可能已被替换、Mermaid 源码也可能变了）。
 */
type ExportContext = {
  /** 预取的图片，key 为 img 的 src（列表项里节点被克隆也能命中） */
  images: Map<string, DocxImage>;
  /** 预取的 Mermaid 图，key 为 mermaidKey(源码) */
  mermaid: Map<string, DocxImage>;
  /** 未能嵌入的图片说明 */
  skipped: string[];
  /** 实际嵌入的图片数 */
  embedded: number;
  /** 取词函数（缺省为英文兜底） */
  t: (key: string, vars?: Record<string, string | number>) => string;
};

/** Mermaid 缓存 key：预取与 PRE 分支必须用同一口径取值 */
function mermaidKey(code: string): string {
  return `mermaid:${code.replace(/\n$/, "")}`;
}

/** 按扩展名/MIME 判断能否嵌入 docx */
function docxImageType(nameOrMime: string): DocxImage["type"] | null {
  const value = nameOrMime.toLowerCase();
  if (value === "image/png" || /\.png$/.test(value)) return "png";
  if (value === "image/jpeg" || /\.jpe?g$/.test(value)) return "jpg";
  if (value === "image/gif" || /\.gif$/.test(value)) return "gif";
  if (value === "image/bmp" || /\.bmp$/.test(value)) return "bmp";
  return null;
}

/** base64 → 字节（Rust 侧 read_image_base64 的返回值） */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * 还原 img 的 src：markdown-it 会把中文等非 ASCII 路径按 URL 规则转成 %XX，
 * 而我们最终要拿它去读盘，必须还原成原始路径。
 */
function decodeSrcPath(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src; // 含非法 % 序列（文件名里真有 %）时按原文处理
  }
}

/** 交给浏览器解码拿原始像素尺寸；解不出来（如无尺寸的 SVG）返回 null */
async function measureImage(
  data: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) return null;
    return { width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 按正文宽度等比缩放，避免插图超出页宽 */
function scaledSize(image: DocxImage): { width: number; height: number } {
  if (image.width <= MAX_IMAGE_WIDTH) return { width: image.width, height: image.height };
  const ratio = MAX_IMAGE_WIDTH / image.width;
  return { width: MAX_IMAGE_WIDTH, height: Math.round(image.height * ratio) };
}

/** 构造可嵌入的 ImageRun（尺寸已按正文宽度缩放） */
function imageRun(ctx: ExportContext, image: DocxImage, alt: string): ImageRun {
  ctx.embedded++;
  return new ImageRun({
    type: image.type,
    data: image.data,
    transformation: scaledSize(image),
    altText: { name: alt, description: alt, title: alt },
  });
}

/**
 * 导出前把图片与 Mermaid 图预备好。
 *
 * 远端地址刻意不下载：本程序面向涉密环境，导出过程不发起任何网络请求，
 * 这类图片一律回落成占位文字，并在导出结果里说明原因。
 */
async function prefetchImages(dom: Document, options: DocxExportOptions, ctx: ExportContext): Promise<void> {
  for (const img of Array.from(dom.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    const alt = img.getAttribute("alt") || ctx.t("No description");
    if (ctx.images.has(src)) continue; // 同一张图重复引用只读一次

    const kind = classifyImageSrc(src);
    if (kind === "data") {
      const payload = decodeDataUri(src);
      const type = payload ? docxImageType(payload.mime) : null;
      const size = payload && type ? await measureImage(payload.bytes, payload.mime) : null;
      if (!payload || !type || !size) {
        ctx.skipped.push(ctx.t("[Image: {alt}] (unsupported format; only PNG/JPG/GIF/BMP)", { alt }));
        continue;
      }
      ctx.images.set(src, { data: payload.bytes, ...size, type });
      continue;
    }

    if (kind === "absolute" || kind === "relative") {
      const local = resolveLocalImagePath(decodeSrcPath(src), options.baseDir ?? null);
      if (!local) {
        ctx.skipped.push(ctx.t("[Image: {alt}] (save the document first to resolve relative paths)", { alt }));
        continue;
      }
      const type = docxImageType(local);
      if (!type) {
        ctx.skipped.push(ctx.t("[Image: {alt}] (unsupported format; only PNG/JPG/GIF/BMP)", { alt }));
        continue;
      }
      try {
        const bytes = base64ToBytes(await readImageBase64(local));
        const size = await measureImage(bytes, `image/${type === "jpg" ? "jpeg" : type}`);
        if (!size) {
          ctx.skipped.push(ctx.t("[Image: {alt}] (image could not be decoded)", { alt }));
          continue;
        }
        ctx.images.set(src, { data: bytes, ...size, type });
      } catch (e) {
        ctx.skipped.push(
          ctx.t("[Image: {alt}] ({detail})", { alt, detail: e instanceof Error ? e.message : String(e) }),
        );
      }
      continue;
    }

    ctx.skipped.push(
      kind === "remote"
        ? ctx.t("[Image: {alt}] (remote image not downloaded offline)", { alt })
        : ctx.t("[Image: {alt}] (invalid image address)", { alt }),
    );
  }

  if (!options.renderMermaid) return;
  const blocks = Array.from(dom.querySelectorAll("pre > code.language-mermaid"));
  for (const code of blocks) {
    const source = code.textContent ?? "";
    const key = mermaidKey(source);
    if (ctx.mermaid.has(key)) continue;
    try {
      const png = await options.renderMermaid(source.replace(/\n$/, ""));
      if (png) ctx.mermaid.set(key, png);
    } catch {
      // 渲染失败保持代码块形态：导出不能因为一张图失败
    }
  }
}

// ---- 行内元素 → (TextRun | ExternalHyperlink | ImageRun)[] ----

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

/** 行内元素产物：文本 / 超链接 / 嵌入图片（图片走 ImageRun） */
type InlineChild = TextRun | ExternalHyperlink | ImageRun;

function inlineRuns(el: Node, ctx: ExportContext, init: RunProps = {}): InlineChild[] {
  const out: InlineChild[] = [];

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
        out.push(...inlineRuns(node, ctx, { ...init, bold: true }));
        break;
      case "EM":
      case "I":
        out.push(...inlineRuns(node, ctx, { ...init, italics: true }));
        break;
      case "DEL":
      case "S":
        out.push(...inlineRuns(node, ctx, { ...init, strike: true }));
        break;
      case "CODE":
        out.push(...inlineRuns(node, ctx, { ...init, code: true }));
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
          out.push(...inlineRuns(node, ctx, init));
        }
        break;
      }
      case "BR":
        out.push(new TextRun({ text: "", break: 1 }));
        break;
      case "IMG": {
        const src = node.getAttribute("src") ?? "";
        const alt = node.getAttribute("alt") || ctx.t("No description");
        const image = ctx.images.get(src);
        if (image) {
          out.push(imageRun(ctx, image, alt));
        } else {
          // 未命中预取缓存（远端图 / 不支持格式 / 文档未保存）：回落为占位文字
          out.push(
            new TextRun({ text: ctx.t("[Image: {alt}]", { alt }), italics: true, color: "6E7781", font: cnFont() }),
          );
        }
        break;
      }
      default:
        out.push(...inlineRuns(node, ctx, init)); // 未知行内标签：透明递归
    }
  });

  return out;
}

/** 表头单元格变体：内容整体加粗 */
function inlineRunsBold(el: Node, ctx: ExportContext): InlineChild[] {
  return inlineRuns(el, ctx, { bold: true });
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

function renderBlocks(ctx: ExportContext, parent: Node, listLevel = 0, inQuote = false): (Paragraph | Table)[] {
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
            children: inlineRuns(el, ctx),
          }),
        );
        break;

      case "P": {
        // 段首缩进：仅正文段落（引用块内的段落不缩进，改由 quoteStyle 控制左缩进）。
        // 正文默认字号 10.5pt，2 字符 = 420 twips；firstLineChars 让 Word 按「2 字符」识别。
        const bodyIndent = inQuote ? {} : { indent: { firstLine: 420, firstLineChars: 200 } };
        out.push(
          new Paragraph({ children: inlineRuns(el, ctx), ...bodyIndent, ...quoteStyle }),
        );
        break;
      }

      // ---- 列表（嵌套递归）----
      case "UL":
      case "OL":
        renderList(ctx, el, listLevel, out);
        break;

      // ---- 引用块：递归时带上引用样式 ----
      case "BLOCKQUOTE":
        out.push(...renderBlocks(ctx, el, listLevel, true));
        break;

      // ---- 代码块：等宽 + 灰底 + 细框（相邻段落边框在 Word 中融合为一块）----
      case "PRE": {
        // Mermaid 代码块若已渲染成图，则替换成居中插图，不再输出源码
        const codeEl = el.querySelector("code");
        const isMermaid = !!codeEl?.classList.contains("language-mermaid");
        if (isMermaid) {
          const source = codeEl?.textContent ?? el.textContent ?? "";
          const mermaid = ctx.mermaid.get(mermaidKey(source));
          if (mermaid) {
            out.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 120, after: 120 },
                children: [imageRun(ctx, mermaid, ctx.t("Mermaid Diagram"))],
              }),
            );
            break;
          }
        }

        const code = codeEl?.textContent ?? el.textContent ?? "";
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
        out.push(renderTable(el, ctx));
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
        out.push(...renderBlocks(ctx, el, listLevel));
    }
  });

  return out;
}

/** 列表：li 的子节点拆成「行内内容」与「嵌套子列表」分别处理 */
function renderList(ctx: ExportContext, listEl: Element, level: number, out: (Paragraph | Table)[]): void {
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

      const runs = inlineRuns(holder, ctx);
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
        .forEach((sub) => renderList(ctx, sub, level + 1, out));
    });
}

function renderTable(tableEl: Element, ctx: ExportContext): Table {
  const rows: TableRow[] = [];

  // 只取本表的「直接行」：markdown-it 会把表头放在 thead、正文放在 tbody，
  // 用 :scope 限定层级可避免把单元格里嵌套表格的行也一并吞进来。
  const trs = Array.from(
    tableEl.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr"),
  );
  trs.forEach((tr) => {
    // 表头按是否含 th 判定（而非「第一行」），嵌套结构下也更稳
    const isHeader = tr.querySelector(":scope > th") !== null;
    const cells: TableCell[] = [];

    Array.from(tr.querySelectorAll(":scope > th, :scope > td")).forEach((cell) => {
      cells.push(
        new TableCell({
          shading: isHeader ? { fill: "EFF2F5" } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            new Paragraph({
              children: isHeader ? inlineRunsBold(cell, ctx) : inlineRuns(cell, ctx),
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

/**
 * 导出 Word。
 *
 * 返回实际嵌入的图片数与未嵌入图片的说明清单（调用方据此汇总提示用户）。
 * 任何单张图片失败都不会中断导出，最差就是回落成占位文字。
 */
export async function exportDocx(
  path: string,
  markdown: string,
  options: DocxExportOptions = {},
): Promise<DocxExportResult> {
  const html = md.render(markdown);
  const dom = new DOMParser().parseFromString(html, "text/html");
  // 每次导出新建上下文，缓存与计数不跨次复用
  const ctx: ExportContext = {
    images: new Map(),
    mermaid: new Map(),
    skipped: [],
    embedded: 0,
    t: options.t ?? ((key) => key),
  };

  // 渲染阶段是同步的，图片字节与 Mermaid 图必须在这里先备好
  await prefetchImages(dom, options, ctx);
  const blocks = renderBlocks(ctx, dom.body);

  const doc = new DocxDocument({
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
  return { embedded: ctx.embedded, skipped: [...ctx.skipped] };
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
