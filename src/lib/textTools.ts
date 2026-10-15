/**
 * 文本处理小工具：整篇文档级的纯字符串变换，不碰编辑器状态（便于单独测）。
 *
 * 与 codeTools 的分工：那边面向「代码格式化」（JSON/CSS/JS），这边面向「排版清洗」
 * （去空行、去行尾空白、中英文混排加/去空格），三种文档模式（纯文本 / Markdown / HTML）都适用。
 *
 * 设计约定：
 * 1. 全部是 `(src: string) => string` 的纯函数：这类工具不会失败，没有必要套 ToolResult
 *    的错误分支；调用方只需比较「结果是否与原串相同」来决定要不要写回。
 * 2. **行尾风格必须保真**：多行输出一律用 `eolOf(src)` 还原原始行尾，末尾换行也照旧保留，
 *    否则整个文件会在 git 里显示为「全文件改动」。
 * 3. 中英文混排只处理「CJK ↔ 半角字母数字」这一处边界（常见的中英混排排版需求），
 *    不处理标点、也不区分 inline code / 链接——刻意保持简单可预期。
 */

import { eolOf, keepTrailingEol } from "./codeTools";

/** 一行按 `\r\n` / `\r` / `\n` 切分（单行内不会再有换行符） */
function splitLines(src: string): string[] {
  return src.split(/\r\n|\r|\n/);
}

/* ────────────────────────── 空白清理 ────────────────────────── */

/** 批量去空行：删掉所有空行与只含空白（空格 / 制表符）的行 */
export function removeBlankLines(src: string): string {
  const kept = splitLines(src).filter((line) => line.trim() !== "");
  // 整篇都是空行时结果就该是空串：交给 keepTrailingEol 反而会补出一个换行
  if (kept.length === 0) return "";
  return keepTrailingEol(kept.join(eolOf(src)), src);
}

/** 去掉每行行尾的空格与制表符（常见于网页复制过来的正文） */
export function removeTrailingSpaces(src: string): string {
  const text = splitLines(src)
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join(eolOf(src));
  return keepTrailingEol(text, src);
}

/**
 * 合并行内多余空格：把行内连续的空格 / 制表符压成一个空格。
 *
 * 行首缩进原样保留——缩进在 Markdown 列表、代码里是有含义的，不能一并压掉。
 */
export function collapseInnerSpaces(src: string): string {
  const text = splitLines(src)
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)![0];
      return indent + line.slice(indent.length).replace(/[ \t]{2,}/g, " ");
    })
    .join(eolOf(src));
  return keepTrailingEol(text, src);
}

/* ────────────────────────── 中英文混排 ────────────────────────── */

/** 汉字区间：扩展 A + 基本区 + 兼容表意文字（够覆盖常见中文正文） */
const CJK = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff";

/** 「汉字紧跟字母数字」与「字母数字紧跟汉字」（用于加空格） */
const RE_CJK_THEN_LATIN = new RegExp(`([${CJK}])([A-Za-z0-9])`, "g");
const RE_LATIN_THEN_CJK = new RegExp(`([A-Za-z0-9])([${CJK}])`, "g");

/** 同上，但要求中间已经有一个及以上的行内空白（用于去空格；只吃空格/制表符，不跨行） */
const RE_CJK_SP_LATIN = new RegExp(`([${CJK}])[ \\t]+([A-Za-z0-9])`, "g");
const RE_LATIN_SP_CJK = new RegExp(`([A-Za-z0-9])[ \\t]+([${CJK}])`, "g");

/** 中文与数字字母之间加空格：在紧邻的汉字↔半角字母数字边界补一个空格（已有空格的边界不动） */
export function cjkLatinAddSpace(src: string): string {
  return src.replace(RE_CJK_THEN_LATIN, "$1 $2").replace(RE_LATIN_THEN_CJK, "$1 $2");
}

/** 中文与数字字母之间去空格：删掉汉字↔半角字母数字边界上的空格 / 制表符 */
export function cjkLatinRemoveSpace(src: string): string {
  return src.replace(RE_CJK_SP_LATIN, "$1$2").replace(RE_LATIN_SP_CJK, "$1$2");
}
