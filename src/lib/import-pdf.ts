/**
 * PDF → Markdown 导入（任务书阶段 6）
 *
 * 策略：pdfjs-dist 在前端抽取文本层（仅文字版 PDF 有效），
 * 把文本项按 Y 坐标聚类重建行序，再用「字号相对正文众数的比值」
 * 启发式识别标题层级。表格/多栏等复杂排版尽力还原，需人工校正。
 * 扫描件（图片型 PDF）没有文本层，提取字符数近 0 时明确报错。
 */
import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import { readPdfBase64 } from "./tauri-api";

// 惰性创建 worker：不用 PDF 导入就不常驻线程
let workerReady = false;
function ensureWorker(): void {
  if (!workerReady) {
    pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
    workerReady = true;
  }
}

export interface PdfImportResult {
  markdown: string;
  pageCount: number;
}

/** pdfjs 文本项的结构子集（marked-content 项无 str，会被过滤） */
interface TextPiece {
  str: string;
  width: number;
  height: number; // ≈ 字号（缩放后的字体高度），标题判定的依据
  x: number; // transform[4]
  y: number; // transform[5]（PDF 坐标系：y 向上）
}

interface Line {
  y: number;
  text: string;
  size: number; // 行内最大字号
}

const CJK = /[\u2E80-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3000-\u303F\uFF01-\uFF60]/;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 同一行的文本项按 x 排序拼接；CJK 字符间不加空格，西文按间隙补空格 */
function joinParts(parts: TextPiece[]): string {
  const sorted = [...parts].sort((a, b) => a.x - b.x);
  let text = "";
  let prevEnd = Number.NEGATIVE_INFINITY;
  for (const p of sorted) {
    if (text.length > 0) {
      const gap = p.x - prevEnd;
      const endsCjk = CJK.test(text[text.length - 1]!);
      const startsCjk = CJK.test(p.str[0] ?? "");
      if (gap > 1 && !endsCjk && !startsCjk && !text.endsWith(" ")) text += " ";
    }
    text += p.str;
    prevEnd = p.x + p.width;
  }
  return text.replace(/\s+/g, " ").trim();
}

/** 按 Y 坐标聚类成行（y 降序 = 页面自上而下），容差随字号缩放以容忍上下标抖动 */
function clusterLines(pieces: TextPiece[]): Line[] {
  if (pieces.length === 0) return [];
  pieces.sort((a, b) => (Math.abs(b.y - a.y) > 0.001 ? b.y - a.y : a.x - b.x));
  const rows: TextPiece[][] = [];
  let rowY = 0;
  for (const p of pieces) {
    const tolerance = Math.max(2, p.height * 0.5);
    const last = rows[rows.length - 1];
    if (last && Math.abs(rowY - p.y) <= tolerance) {
      last.push(p);
    } else {
      rows.push([p]);
      rowY = p.y;
    }
  }
  return rows.map((parts) => ({
    y: parts.reduce((s, p) => s + p.y, 0) / parts.length,
    text: joinParts(parts),
    size: Math.max(...parts.map((p) => p.height)),
  }));
}

/** 字号量化到 0.5pt 后取「行数众数」作为正文字号 */
function findBodySize(lines: Line[]): number {
  const counts = new Map<number, number>();
  for (const l of lines) {
    const q = Math.round(l.size * 2) / 2;
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  let body = 0;
  let best = 0;
  for (const [size, n] of counts) {
    if (n > best) {
      best = n;
      body = size;
    }
  }
  return body > 0 ? body : 11;
}

function headingLevel(line: Line, bodySize: number): "h1" | "h2" | "h3" | null {
  const ratio = line.size / bodySize;
  if (line.text.length > 60 || ratio < 1.15) return null;
  if (ratio >= 1.7) return "h1";
  if (ratio >= 1.35) return "h2";
  return "h3";
}

type Block = { type: "h1" | "h2" | "h3" | "p"; text: string };

/** 主入口：读文件 → pdfjs 解析 → 逐页抽文本 → 重建行/段/标题 → Markdown */
export async function importPdf(path: string): Promise<PdfImportResult> {
  ensureWorker();
  const bytes = base64ToBytes(await readPdfBase64(path));

  const task = pdfjsLib.getDocument({ data: bytes, isEvalSupported: false });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === "PasswordException") throw new Error("PDF 已加密，无法导入");
    throw new Error(`无法解析 PDF：${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const pageLines: Line[][] = [];
    let totalChars = 0;

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pieces: TextPiece[] = [];
      for (const raw of content.items) {
        if (raw && typeof raw === "object" && "str" in raw) {
          const it = raw as { str: string; width: number; height: number; transform: number[] };
          if (!it.str) continue;
          totalChars += it.str.replace(/\s+/g, "").length;
          pieces.push({
            str: it.str,
            width: it.width,
            height: it.height,
            x: it.transform[4]!,
            y: it.transform[5]!,
          });
        }
      }
      pageLines.push(clusterLines(pieces));
      page.cleanup();
    }

    // 扫描件检测：全文档提取不到文字 → 图片型 PDF
    if (totalChars < 16) {
      throw new Error(
        "未从 PDF 中提取到文字。该文件很可能是扫描件（图片型 PDF），无法转换为 Markdown，请改用 OCR 工具。",
      );
    }

    const allLines = pageLines.flat();

    // 页首行号集合：页间强制分段
    const pageStarts = new Set<number>();
    let idx = 0;
    for (const lines of pageLines) {
      pageStarts.add(idx);
      idx += lines.length;
    }

    // 行距中位数（仅统计同页相邻行，避免跨页大跳变污染统计）→ 段落分隔阈值
    const gaps: number[] = [];
    for (let i = 1; i < allLines.length; i++) {
      if (pageStarts.has(i)) continue;
      gaps.push(allLines[i - 1]!.y - allLines[i]!.y);
    }
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : 0;
    const paraThreshold = medianGap * 1.6;

    const bodySize = findBodySize(allLines);
    const blocks: Block[] = [];
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i]!;
      if (!line.text) continue;
      const level = headingLevel(line, bodySize);
      if (level) {
        blocks.push({ type: level, text: line.text });
        continue;
      }
      const prev = i > 0 && !pageStarts.has(i) ? allLines[i - 1]! : null;
      const gap = prev ? prev.y - line.y : Infinity;
      const last = blocks[blocks.length - 1];
      if (last && last.type === "p" && prev && gap <= paraThreshold) {
        last.text += `\n${line.text}`; // 段内换行（Markdown 渲染时合并为同段）
      } else {
        blocks.push({ type: "p", text: line.text });
      }
    }

    const markdown = blocks
      .map((b) => (b.type === "p" ? b.text : `${b.type === "h1" ? "#" : b.type === "h2" ? "##" : "###"} ${b.text}`))
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return { markdown, pageCount: doc.numPages };
  } finally {
    void doc.destroy();
  }
}
