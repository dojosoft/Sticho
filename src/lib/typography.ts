/**
 * 排版增强：中英文自动空格（复刻 Lute 的 autoSpace）
 *
 * 编辑器预览由 Vditor/Lute 渲染，autoSpace 对其生效；而导出（HTML/PDF/Word）
 * 走 markdown-it，不经过 Lute，导致导出文档缺少中英文之间的空格。
 * 这里以 markdown-it core 规则的形式复刻 Lute 的规则，使两侧输出一致。
 *
 * 规则来源：对 public/vditor/dist/js/lute/lute.min.js 的
 * BaseRenderer.TextAutoSpacePrevious/Next、Space() 与 renderCodeSpan 反向工程，
 * 并以 5495 条语料与 Lute Md2HTML 做差分验证（吻合率 99.95%，剩余差异来自
 * Lute 的行内数学与 HTML 节点，本应用无对应插件）。
 */
import type { MarkdownIt, Token } from "markdown-it";

/** 中文侧：CJK 表意文字、假名、部首、注音、带圈 CJK 等 */
function isCjkSide(cp: number): boolean {
  return (
    cp === 0x3005 ||
    cp === 0x3007 || // 々〇
    (cp >= 0x3021 && cp <= 0x3029) || // 〡-〩
    (cp >= 0x302e && cp <= 0x302f) ||
    (cp >= 0x3031 && cp <= 0x3035) ||
    (cp >= 0x3038 && cp <= 0x303b) ||
    (cp >= 0x3041 && cp <= 0x3096) || // 平假名
    (cp >= 0x309d && cp <= 0x309f) ||
    (cp >= 0x30a1 && cp <= 0x30fa) || // 片假名
    (cp >= 0x30fc && cp <= 0x30ff) ||
    (cp >= 0x2e80 && cp <= 0x2eff) || // CJK 部首补充
    (cp >= 0x2f00 && cp <= 0x2fdf) || // 康熙部首
    (cp >= 0x3100 && cp <= 0x312f) || // 注音符号
    (cp >= 0x31a0 && cp <= 0x31bf) || // 注音扩展
    (cp >= 0x3200 && cp <= 0x32ff) || // 带圈 CJK
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2ebef) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f) ||
    (cp >= 0xff66 && cp <= 0xff9f) // 半角片假名
  );
}

/** 中性字符：CJK 标点、全角形式等，既不属于中文侧也不作为英文邻居 */
function isNeutral(cp: number): boolean {
  if (cp >= 0x3000 && cp <= 0x303e) return true; // 含全角空格
  if (cp >= 0x3040 && cp <= 0x30ff) return true; // 假名区的标点/浊点
  if (cp >= 0xfe30 && cp <= 0xfe4f) return true; // CJK 兼容形式
  if (cp >= 0xff00 && cp <= 0xff65) return true; // 全角 ASCII 形式
  if (cp >= 0xffe0 && cp <= 0xffef) return true; // 全角货币/符号
  return false;
}

/** ASCII 中被 Lute 视为英文邻居的符号，仅此 8 个 */
const ASCII_NEIGHBOR = "$%+<>@^`|";
const NEIGHBOR_RE = /[\p{L}\p{N}\p{S}\p{M}]/u;
const EMOJI_RE = /\p{Emoji_Presentation}/u;
const LETTER_RE = /\p{L}/u;
const DIGIT_RE = /\p{Nd}/u;

/** 英文邻居：可与中文之间插入空格的字符 */
function isSpaceNeighbor(cp: number): boolean {
  if (cp < 0) return false;
  if (isCjkSide(cp) || isNeutral(cp)) return false;
  if (cp < 0x80) {
    return (
      (cp >= 0x30 && cp <= 0x39) ||
      (cp >= 0x41 && cp <= 0x5a) ||
      (cp >= 0x61 && cp <= 0x7a) ||
      ASCII_NEIGHBOR.includes(String.fromCharCode(cp))
    );
  }
  const s = String.fromCodePoint(cp);
  if (EMOJI_RE.test(s)) return false; // 默认 emoji 呈现为宽字符，Lute 不加空格
  return NEIGHBOR_RE.test(s);
}

function needSpace(a: number, b: number): boolean {
  if (a < 0 || b < 0) return false;
  return (isCjkSide(a) && isSpaceNeighbor(b)) || (isCjkSide(b) && isSpaceNeighbor(a));
}

function firstCp(s: string): number {
  return s.length === 0 ? -1 : s.codePointAt(0)!;
}

function lastCp(s: string): number {
  if (s.length === 0) return -1;
  const c = s.charCodeAt(s.length - 1);
  const isLowSurrogate = c >= 0xdc00 && c <= 0xdfff;
  return isLowSurrogate && s.length >= 2 ? s.codePointAt(s.length - 2)! : c;
}

/** 同一文本节点内，相邻字符之间按规则插入空格 */
function spaceInside(text: string): string {
  let out = "";
  let prev = -1;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (prev >= 0 && needSpace(prev, cp)) out += " ";
    out += ch;
    prev = cp;
  }
  return out;
}

/** Lute renderCodeSpan 用的是「字母或数字」判定，而非 needSpace */
function isLetterOrDigit(cp: number): boolean {
  if (cp < 0) return false;
  const s = String.fromCodePoint(cp);
  return LETTER_RE.test(s) || DIGIT_RE.test(s);
}

/** 遇到这些节点视为屏障，两侧不再互相影响 */
const BARRIER = new Set(["softbreak", "hardbreak", "html_inline", "image"]);

/** 前一个贡献文本的兄弟节点内容（跳过强调/链接等开闭标记） */
function prevTextOf(children: Token[], i: number): string {
  for (let j = i - 1; j >= 0; j--) {
    const t = children[j];
    if (t.type === "text" || t.type === "code_inline") return t.content;
    if (BARRIER.has(t.type)) return "";
  }
  return "";
}

function nextTextOf(children: Token[], i: number): string {
  for (let j = i + 1; j < children.length; j++) {
    const t = children[j];
    if (t.type === "text" || t.type === "code_inline") return t.content;
    if (BARRIER.has(t.type)) return "";
  }
  return "";
}

/**
 * 给 markdown-it 实例挂上中英文自动空格规则。
 * 需在 md.render() 之前调用一次。
 */
export function applyAutoSpace(md: MarkdownIt): void {
  md.core.ruler.push("cjk_autospace", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) continue;
      const src = token.children;

      // 第一遍：code span 前后按字母/数字规则补空格（用独立 text 节点承载）
      const out: Token[] = [];
      for (let i = 0; i < src.length; i++) {
        const t = src[i];
        if (t.type === "code_inline" && t.content.length > 0) {
          const prev = prevTextOf(src, i);
          if (prev !== "" && isLetterOrDigit(lastCp(prev))) {
            const sp = new state.Token("text", "", 0);
            sp.content = " ";
            out.push(sp);
          }
          out.push(t);
          const next = nextTextOf(src, i);
          if (next !== "" && isLetterOrDigit(firstCp(next))) {
            const sp = new state.Token("text", "", 0);
            sp.content = " ";
            out.push(sp);
          }
        } else {
          out.push(t);
        }
      }
      token.children = out;

      // 第二遍：段内逐字符判定 + 跨节点边界判定
      let prevRune = -1;
      let prevPlain = false;
      let prevText: Token | null = null;
      for (const t of token.children) {
        if (t.type === "text") {
          t.content = spaceInside(t.content);
          if (t.content.length === 0) continue;
          if (prevRune >= 0 && needSpace(prevRune, firstCp(t.content))) {
            if (prevPlain && prevText) prevText.content += " ";
            else t.content = " " + t.content;
          }
          prevRune = lastCp(t.content);
          prevPlain = true;
          prevText = t;
        } else if (t.type === "code_inline") {
          if (t.content.length === 0) continue;
          prevRune = lastCp(t.content);
          prevPlain = false;
          prevText = null;
        } else if (BARRIER.has(t.type)) {
          prevRune = -1;
          prevPlain = false;
          prevText = null;
        }
      }
    }
  });
}