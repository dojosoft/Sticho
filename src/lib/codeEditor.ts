/**
 * 代码文件编辑视图（CodeMirror 6 宿主）。
 *
 * 与 `editor.ts` 平级：这里是命令式 API，不做 Svelte 组件。应用层用 `docKind === "code"`
 * 决定何时把 `.code-view` 覆盖层挂出来，再调 `mountCodeEditor` 把 CM 挂进去。
 *
 * 三个必须守住的约定：
 * 1. **CRLF 保真**（最高危）。记事本打开的 .bat / .ps1 基本都是 CRLF，CM 默认会把文档
 *    规范化成 LF，保存后整个文件在 git 里变成「全文件改动」。所以建 state 时按原文风格
 *    设置 `EditorState.lineSeparator`，取值时用 `state.sliceDoc()`（它按 lineBreak 拼行），
 *    **不要用 `doc.toString()`**（那个固定用 "\n"）。
 * 2. **覆盖层高度塌陷**。CM 在 0 高度容器里挂载会渲染 0 行。挂载后补一次 rAF 的
 *    `requestMeasure()`，并挂 ResizeObserver 兜住后续的尺寸变化。
 * 3. **所有 setter 在未挂载时是 no-op**，与 `setEditorTheme` 的既有约定一致——
 *    应用层可以放心地在任意时机调，不必先判断是否处于代码模式。
 *
 * CodeMirror 的运行时模块在 mount 时动态载入（首屏不为代码编辑器付出代价），
 * 载入结果缓存到 `cm`，因此其余 setter / getter 保持同步签名。
 */

import { codeLangForExt, codeLangForId } from "./codeLang";
import type { TagStyle } from "@codemirror/language";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

/* ─────────────────────── 模块与类型 ─────────────────────── */

type CmModules = {
  state: typeof import("@codemirror/state");
  view: typeof import("@codemirror/view");
  commands: typeof import("@codemirror/commands");
  language: typeof import("@codemirror/language");
  autocomplete: typeof import("@codemirror/autocomplete");
  search: typeof import("@codemirror/search");
  highlight: typeof import("@lezer/highlight");
};

type Ext = import("@codemirror/state").Extension;
type Comp = import("@codemirror/state").Compartment;
type St = import("@codemirror/state").EditorState;
type View = import("@codemirror/view").EditorView;
type RangeValueT = import("@codemirror/state").RangeValue;
type RangeOf<T extends RangeValueT> = import("@codemirror/state").Range<T>;
type RangeSetOf<T extends RangeValueT> = import("@codemirror/state").RangeSet<T>;
type GutterMarkerT = import("@codemirror/view").GutterMarker;
type Deco = import("@codemirror/view").Decoration;
type DecorationSetT = import("@codemirror/view").DecorationSet;
type SearchQueryT = import("@codemirror/search").SearchQuery;
type ViewUpdateT = import("@codemirror/view").ViewUpdate;

/**
 * `SearchQuery.getCursor()` 在官方 d.ts 里只声明成 `Iterator<{from,to}>`（没有 `value`），
 * 运行时返回的却是自带 `value` / `done` 的 `SearchCursor`。这里按实际形状补一份声明，
 * 免得每次取值都要 `as any`。
 */
type MatchCursor = { next(): { done: boolean }; readonly value: { from: number; to: number } };

/** 与 `ReaderStyle` 对齐的阅读排版：代码视图消费字号 / 行距 / 背景 / 字体 / 文字色 */
export type CodeReaderStyle = {
  fontSize?: string;
  lineHeight?: string;
  /**
   * 正文区底色（护眼背景）。
   */
  background?: string;
  /** 正文字体（阅读排版 → 字体）；缺省时沿用内置等宽栈 CODE_FONT */
  fontFamily?: string;
  /**
   * 正文文字色（阅读排版 → 文字颜色）。
   *
   * 只在语法高亮的生效语言为「纯文本」时由应用层下发；切到某个程序语言后文字色交给
   * 语法高亮配色，应用层不会传这一项（见 App.svelte 的 applyCodeReaderStyle）。
   */
  textColor?: string;
};

export interface CodeEditorOptions {
  /** 初始正文 */
  value: string;
  /** 文件扩展名（决定语言与缩进单位） */
  ext: string;
  /**
   * 手动指定的语言 id（「视图 → 语法高亮语言」）：
   * - `undefined`：按 `ext` 自动判定（默认）；
   * - `null`：纯文本，不做语法高亮；
   * - 其他：用该语言的扩展，同时缩进单位也跟着它走。
   */
  langId?: string | null;
  /**
   * 打字机模式：光标行始终停在视口垂直中线（视图 → 打字机模式）。
   * 与 Markdown 侧的 Vditor 同名功能行为一致。
   */
  typewriter?: boolean;
  /** 段落聚焦：只亮光标所在段落，其余行压暗（视图 → 段落聚焦） */
  paragraphFocus?: boolean;
  dark: boolean;
  lineNumbers: boolean;
  /** 自动换行（视图 → 自动换行）：开时长行按窗口宽度折行，关时一行占一行、横向滚动 */
  wrap: boolean;
  /** 只读（阅读模式）：由应用层的 browseMode 决定 */
  readonly: boolean;
  /** 正文变化（含中文输入法的组合期）；应用层自行防抖后再做统计 */
  onChange: () => void;
  /** 光标移动 / 正文变化后的行列号回调（行、列均从 1 起） */
  onCursor?: (line: number, column: number) => void;
  /** 选中词在全文中的出现次数（无选中或选中不足 2 字符时为 0），200ms 防抖后回调 */
  onMatchCount?: (count: number) => void;
}

/** 等宽字体栈：Windows 上优先 Cascadia Mono（Win10 1809+ 自带） */
const CODE_FONT = '"Cascadia Mono", Consolas, "Courier New", monospace';

let cm: CmModules | null = null;
let view: View | null = null;
let hostEl: HTMLElement | null = null;
let opts: CodeEditorOptions | null = null;
let resizeObs: ResizeObserver | null = null;

/** 挂载序号：语言包是异步加载的，加载期间用户可能已经切走或又挂了别的文件 */
let seq = 0;

let cSep: Comp | null = null;
let cLang: Comp | null = null;
let cTheme: Comp | null = null;
let cReadonly: Comp | null = null;
let cGutter: Comp | null = null;
let cIndent: Comp | null = null;
let cType: Comp | null = null;
let cFocus: Comp | null = null;
let cWrap: Comp | null = null;

/* ─────────────────────── 主题 ─────────────────────── */

/** 光/暗两套语法配色。颜色沿 GitHub 的配色习惯，深浅底都有足够对比度 */
function tagStyles(tags: typeof import("@lezer/highlight").tags, dark: boolean): TagStyle[] {
  if (dark) {
    return [
      { tag: tags.keyword, color: "#ff7b72" },
      { tag: [tags.controlKeyword, tags.moduleKeyword, tags.definitionKeyword], color: "#ff7b72" },
      { tag: [tags.operatorKeyword, tags.self, tags.null, tags.atom, tags.bool], color: "#79c0ff" },
      { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "#a5d6ff" },
      { tag: [tags.number, tags.integer, tags.float], color: "#79c0ff" },
      { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#8b949e", fontStyle: "italic" },
      { tag: [tags.variableName, tags.propertyName], color: "#e6edf3" },
      { tag: [tags.typeName, tags.className, tags.namespace], color: "#ffa657" },
      { tag: [tags.function(tags.variableName), tags.labelName], color: "#d2a8ff" },
      { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: "#7ee787" },
      { tag: [tags.tagName], color: "#7ee787" },
      { tag: [tags.attributeName, tags.attributeValue], color: "#79c0ff" },
      { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: "#8b949e" },
      { tag: [tags.heading, tags.strong], color: "#e6edf3", fontWeight: "bold" },
      { tag: [tags.link, tags.url], color: "#a5d6ff", textDecoration: "underline" },
      { tag: tags.invalid, color: "#f85149" },
    ];
  }
  return [
    { tag: tags.keyword, color: "#cf222e" },
    { tag: [tags.controlKeyword, tags.moduleKeyword, tags.definitionKeyword], color: "#cf222e" },
    { tag: [tags.operatorKeyword, tags.self, tags.null, tags.atom, tags.bool], color: "#0550ae" },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "#0a3069" },
    { tag: [tags.number, tags.integer, tags.float], color: "#0550ae" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6e7781", fontStyle: "italic" },
    { tag: [tags.variableName, tags.propertyName], color: "#24292f" },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "#953800" },
    { tag: [tags.function(tags.variableName), tags.labelName], color: "#8250df" },
    { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: "#116329" },
    { tag: [tags.tagName], color: "#116329" },
    { tag: [tags.attributeName, tags.attributeValue], color: "#0550ae" },
    { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: "#6e7781" },
    { tag: [tags.heading, tags.strong], color: "#24292f", fontWeight: "bold" },
    { tag: [tags.link, tags.url], color: "#0a3069", textDecoration: "underline" },
    { tag: tags.invalid, color: "#82071e" },
  ];
}

/**
 * 构建整套视觉：EditorView.theme 管布局与配色，HighlightStyle 管词法着色。
 *
 * 颜色一律走 CSS 变量并给出内置缺省值：用户的自定义主题（`<style id="md-studio-user-theme">`）
 * 只要写 `.cm-content{…}` 或覆盖 `--cm-bg` 这类变量就能接管外观，不必改本文件。
 */
function buildTheme(modules: CmModules, dark: boolean): Ext {
  const { EditorView } = modules.view;
  const { HighlightStyle, syntaxHighlighting } = modules.language;
  const { tags } = modules.highlight;

  const bg = dark ? "#1e1f22" : "#ffffff";
  const fg = dark ? "#e6edf3" : "#24292f";
  const gutterBg = dark ? "#26282c" : "#f6f8fa";
  const gutterFg = dark ? "#7d8590" : "#8c959f";
  const activeLine = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.035)";
  const selection = dark ? "#2f4a76" : "#b6d7ff";
  const matchBg = dark ? "#5a4100" : "#ffe08a";

  const theme = EditorView.theme(
    {
      "&": {
        height: "100%",
        color: `var(--cm-fg, ${fg})`,
        backgroundColor: `var(--cm-bg, ${bg})`,
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: `var(--cm-font-family, ${CODE_FONT})`,
        fontSize: `var(--cm-font-size, 13px)`,
        lineHeight: `var(--cm-line-height, 1.6)`,
      },
      ".cm-content": {
        padding: "8px 0",
        caretColor: `var(--cm-fg, ${fg})`,
      },
      ".cm-gutters": {
        backgroundColor: `var(--cm-gutter-bg, ${gutterBg})`,
        color: `var(--cm-gutter-fg, ${gutterFg})`,
        border: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 8px" },
      // 折叠箭头默认是 <span> 文本（⌄/›），放大字号并留足点按区域
      ".cm-foldGutter .cm-gutterElement": {
        padding: "0 5px",
        fontSize: "15px",
        lineHeight: "1",
        minWidth: "1.1em",
        textAlign: "center",
      },
      ".cm-activeLine": { backgroundColor: `var(--cm-active-line, ${activeLine})` },
      ".cm-activeLineGutter": { backgroundColor: `var(--cm-active-line, ${activeLine})` },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: `var(--cm-selection, ${selection})`,
      },
      ".cm-selectionMatch": { backgroundColor: matchBg },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: matchBg,
        outline: "1px solid rgba(128,128,128,0.4)",
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: `var(--cm-fg, ${fg})` },
      ".cm-searchMatch": { backgroundColor: matchBg, outline: "1px solid rgba(0,0,0,0.15)" },
      ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#ff9d00" },
      // 书签：行上加一条左侧色条 + 淡底色；槽位里的圆点用相邻色
      ".cm-bookmark": {
        backgroundColor: dark ? "rgba(227,98,9,0.12)" : "rgba(227,98,9,0.09)",
        boxShadow: "inset 3px 0 0 #e36209",
      },
      ".cm-bookmark-dot": { color: "#e36209", fontSize: "0.7em", lineHeight: "1" },
      ".cm-bookmark-ghost": { visibility: "hidden" },
      ".cm-bookmark-gutter .cm-gutterElement": { padding: "0 2px 0 4px" },
      ".cm-tooltip": {
        border: "1px solid rgba(128,128,128,0.35)",
        backgroundColor: `var(--cm-bg, ${bg})`,
        color: `var(--cm-fg, ${fg})`,
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: selection, color: fg },
      ".cm-panels": { backgroundColor: gutterBg, color: fg },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: "none",
        color: gutterFg,
      },
      // 段落聚焦：压暗光标所在段落以外的行（见 focusExt）
      ".cm-focus-dim": { opacity: "0.35", transition: "opacity 120ms linear" },
    },
    { dark },
  );

  return [theme, syntaxHighlighting(HighlightStyle.define(tagStyles(tags, dark)))];
}

/* ─────────────────────── 打字机模式 / 段落聚焦 ─────────────────────── */

/**
 * 打字机模式（代码视图版）：光标行始终停在视口垂直中线。
 *
 * 不能在 update 周期里同步派发 scrollIntoView 事务（CM 会因重入而再触发一轮更新），
 * 故用 rAF 延后一帧；视图已销毁时 dispatch 会抛错，吞掉即可。
 */
function typewriterExt(modules: CmModules): Ext {
  const { view: viewMod } = modules;
  return viewMod.EditorView.updateListener.of((u: ViewUpdateT) => {
    if (!u.selectionSet && !u.docChanged) return;
    const v = u.view;
    requestAnimationFrame(() => {
      try {
        v.dispatch({
          effects: viewMod.EditorView.scrollIntoView(v.state.selection.main.head, { y: "center" }),
        });
      } catch {
        // 视图已销毁：忽略
      }
    });
  });
}

/**
 * 段落聚焦（代码视图版）：只亮「光标所在的连续非空行块」，其余行压暗。
 *
 * 与 Markdown 侧 Vditor 的聚光灯语义对齐（只亮当前编辑块）；代码里没有块结构，
 * 故以「光标行上下的连续非空行」当段落。装饰只铺在可视范围上——几万行的文件里
 * 给每一行都挂装饰会让滚动掉帧。
 */
function focusExt(modules: CmModules): Ext {
  const { state: st, view: viewMod } = modules;
  const dim = viewMod.Decoration.line({ class: "cm-focus-dim" });

  const build = (view: View): RangeSetOf<Deco> => {
    const doc = view.state.doc;
    // 亮区 = 各光标所在行的连续非空行块
    const lit = new Set<number>();
    for (const range of view.state.selection.ranges) {
      const line = doc.lineAt(range.head).number;
      let from = line;
      let to = line;
      while (from > 1 && doc.line(from - 1).text.trim() !== "") from -= 1;
      while (to < doc.lines && doc.line(to + 1).text.trim() !== "") to += 1;
      for (let n = from; n <= to; n++) lit.add(n);
    }

    const builder = new st.RangeSetBuilder<Deco>();
    for (const visible of view.visibleRanges) {
      const last = doc.lineAt(visible.to).number;
      for (let n = doc.lineAt(visible.from).number; n <= last; n++) {
        if (lit.has(n)) continue;
        const pos = doc.line(n).from;
        builder.add(pos, pos, dim);
      }
    }
    return builder.finish();
  };

  return viewMod.ViewPlugin.fromClass(
    class {
      decorations: RangeSetOf<Deco>;
      constructor(view: View) {
        this.decorations = build(view);
      }
      update(u: ViewUpdateT): void {
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          this.decorations = build(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/* ─────────────────────── 只读 ─────────────────────── */

/**
 * 只读态由两个开关共同表达：`EditorState.readOnly` 让 CM 的编辑命令自动 no-op，
 * `EditorView.editable` 让正文退出 contenteditable（避免唤起输入法）。
 * 只读时仍可选中 / 复制 / 滚动，这正是阅读模式需要的。
 */
function readonlyExt(modules: CmModules, readonly: boolean): Ext {
  return [
    modules.state.EditorState.readOnly.of(readonly),
    modules.view.EditorView.editable.of(!readonly),
  ];
}

/* ─────────────────────── 换行风格 ─────────────────────── */

/** 按原文风格选行尾：含 CRLF 就用 CRLF，否则 LF（纯 LF 与混用都归到 LF） */
function sepOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/* ─────────────────────── 缩进 ─────────────────────── */

function indentText(spec: ReturnType<typeof codeLangForId>): string {
  if (!spec) return "  ";
  return spec.indentUnit === "tab" ? "\t" : " ".repeat(spec.indentUnit);
}

/* ─────────────────────── 文档内词汇补全 ─────────────────────── */

/** 词汇扫描范围上限（光标往前 200KB）：大文件里补全不能退化成全文扫描 */
const WORD_SCAN_LIMIT = 200 * 1024;
/** 候选词上限：CM 的过滤是线性的，给个天花板避免弹窗卡顿 */
const WORD_MAX = 2000;
/** 只收长度 ≥ 3 的词（`if` / `in` 这类短词噪音大于收益） */
const WORD_RE = /[A-Za-z_$][\w$]{2,}/g;

/**
 * 文档内词汇补全：扫光标前的正文取「标识符样」的词，去重后作为候选。
 *
 * 不做语义分析（那要接 language server），只解决「同一个变量名敲一半」这个高频场景，
 * 这也是 notepad4 / 记事本这类轻量编辑器的通行做法。
 */
function localWordSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_$][\w$]*/);
  const typed = word?.text ?? "";
  // 没落在词里、又不是显式按 Ctrl+Space：不弹
  if (typed.length < 1 && !context.explicit) return null;

  const from = word?.from ?? context.pos;
  const start = Math.max(0, context.pos - WORD_SCAN_LIMIT);
  const text = context.state.sliceDoc(start, context.pos);

  const seen = new Set<string>();
  const options: { label: string; type: string }[] = [];
  WORD_RE.lastIndex = 0;
  for (let m = WORD_RE.exec(text); m; m = WORD_RE.exec(text)) {
    const w = m[0];
    if (seen.has(w)) continue;
    seen.add(w);
    options.push({ label: w, type: "text" });
    if (options.length >= WORD_MAX) break;
  }
  if (options.length === 0) return null;

  // validFor：继续敲词内字符时不重新计算，敲到词外自动失效
  return { from, options, validFor: /^[\w$]*$/ };
}

/* ─────────────────────── 选中词出现次数 ─────────────────────── */

/** 选中文本在全文中的出现次数（用 CM 自己的 RegExpCursor，逐行扫描，不整篇拷贝字符串） */
function countMatches(modules: CmModules, state: St, text: string): number {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 整词匹配：前后不能紧邻标识符字符，避免把「词内出现」（如 cat 里的 cat）也算进去。
  // 用显式字符类而非 \w，是因为 RegExpCursor 见到 \w 会改走逐行拼装的多行正则分支。
  const pattern = `(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`;
  const cursor = new modules.search.RegExpCursor(state.doc, pattern, {}, 0, state.doc.length);
  let n = 0;
  while (!cursor.next().done) {
    n += 1;
    if (n > 99999) break; // 天花板：命中过多时状态栏数字已无意义，别把主线程占满
  }
  return n;
}

let matchTimer: ReturnType<typeof setTimeout> | null = null;

/** 计数防抖：IME 组合期与连续输入都会高频触发，静默 200ms 后才真正扫描 */
function scheduleMatchCount(): void {
  clearMatchCount();
  matchTimer = setTimeout(() => {
    matchTimer = null;
    if (!view || !cm) return;
    const state = view.state;
    const sel = state.selection.main;
    const text = sel.empty ? "" : state.sliceDoc(sel.from, sel.to);
    opts?.onMatchCount?.(text.length >= 2 ? countMatches(cm, state, text) : 0);
  }, 200);
}

/** 撤掉待执行的计数（卸载时调，避免定时器在视图销毁后跑） */
function clearMatchCount(): void {
  if (matchTimer !== null) clearTimeout(matchTimer);
  matchTimer = null;
}

/* ─────────────────────── 书签 ─────────────────────── */

type BookmarkKit = {
  field: import("@codemirror/state").StateField<RangeSetOf<GutterMarkerT>>;
  toggle: import("@codemirror/state").StateEffectType<number>;
  clear: import("@codemirror/state").StateEffectType<null>;
  ext: Ext;
};

let bmKit: BookmarkKit | null = null;

/**
 * 书签：一个 `StateField` 存「行首位置 → GutterMarker」，
 * 同时把标记投影成行装饰（`.cm-bookmark` 行底色）与行号槽右侧的圆点。
 *
 * 存的是行首位置而不是光标位置：书签的语义是「标记某一行」，光标在同一行内移动不该产生新书签。
 */
function bookmarkKit(modules: CmModules): BookmarkKit {
  if (bmKit) return bmKit;
  const { StateField, StateEffect, RangeSet } = modules.state;
  const { Decoration, EditorView, GutterMarker, gutter } = modules.view;

  const toggle = StateEffect.define<number>();
  const clear = StateEffect.define<null>();
  const lineDeco = Decoration.line({ class: "cm-bookmark" });
  const dot = new (class extends GutterMarker {
    toDOM(): HTMLElement {
      const el = document.createElement("span");
      el.className = "cm-bookmark-dot";
      el.textContent = "●";
      return el;
    }
  })();
  /** 只用来撑出书签槽的基准宽度（内容与圆点同宽、不可见，避免槽宽随书签增删跳动） */
  const spacer = new (class extends GutterMarker {
    toDOM(): HTMLElement {
      const el = document.createElement("span");
      el.className = "cm-bookmark-dot cm-bookmark-ghost";
      el.textContent = "●";
      return el;
    }
  })();

  const field = StateField.define<RangeSetOf<GutterMarkerT>>({
    create: () => RangeSet.empty,
    update(set, tr) {
      set = set.map(tr.changes);
      for (const e of tr.effects) {
        if (e.is(clear)) {
          set = RangeSet.empty;
          continue;
        }
        if (!e.is(toggle)) continue;
        const pos = Math.min(Math.max(e.value, 0), tr.state.doc.length);
        const lineFrom = tr.state.doc.lineAt(pos).from;
        const keep: RangeOf<GutterMarkerT>[] = [];
        let hit = false;
        set.between(0, tr.state.doc.length, (from, to, value) => {
          if (from === lineFrom) hit = true;
          else keep.push(value.range(from, to));
        });
        if (!hit) keep.push(dot.range(lineFrom));
        set = RangeSet.of(keep, true); // true：重新排序，因为新书签可能插在中间
      }
      return set;
    },
    provide: (f) => [
      EditorView.decorations.compute([f], (state) => {
        const ranges: RangeOf<Deco>[] = [];
        state.field(f).between(0, state.doc.length, (from) => {
          ranges.push(lineDeco.range(from));
        });
        return Decoration.set(ranges, true);
      }),
      gutter({
        class: "cm-bookmark-gutter",
        markers: (v) => v.state.field(f),
        initialSpacer: () => spacer,
        // 每行都要有可点的槽位元素（否则没书签的行根本没有 DOM，点不到）
        renderEmptyElements: true,
        domEventHandlers: {
          // 点槽位也能切换书签，不必记快捷键
          mousedown: (v, line) => {
            v.dispatch({ effects: toggle.of(line.from) });
            return true;
          },
        },
      }),
    ],
  });

  bmKit = { field, toggle, clear, ext: field };
  return bmKit;
}

/* ─────────────────────── 查找 / 替换（能力层） ─────────────────────── */

/** 查找参数：与查找栏的三个开关一一对应 */
export type CodeFindOptions = {
  search: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
};

/** 一处命中：`groups` 只在正则模式下非空，供替换模板展开 `$1` */
export type CodeMatch = { from: number; to: number; text: string; groups: string[] };

type FindState = { query: SearchQueryT | null; currentFrom: number; currentTo: number };

type FindKit = {
  field: import("@codemirror/state").StateField<FindState>;
  setQuery: import("@codemirror/state").StateEffectType<SearchQueryT | null>;
  setCurrent: import("@codemirror/state").StateEffectType<{ from: number; to: number }>;
  ext: Ext;
};

let findKit: FindKit | null = null;

/**
 * 查找状态与高亮。
 *
 * 不自带 `@codemirror/search` 的 `search()` 扩展：那套高亮器要求「查找面板已打开」
 * （`highlight()` 里 `!panel` 直接返回空装饰）才渲染 `.cm-searchMatch`，
 * 而本应用的查找 UI 是自有的顶栏，不打算开 CM 面板。这里改用它的**能力层**：
 * `SearchQuery` 负责匹配语义（大小写 / 整词 / 正则）、`getCursor` 负责遍历，
 * 高亮则由自己的 ViewPlugin 按可见范围铺装饰——同一份查询同时服务计数与上色。
 */
function findKitOf(modules: CmModules): FindKit {
  if (findKit) return findKit;
  const { StateField, StateEffect, RangeSetBuilder } = modules.state;
  const { Decoration, ViewPlugin } = modules.view;

  const setQuery = StateEffect.define<SearchQueryT | null>();
  const setCurrent = StateEffect.define<{ from: number; to: number }>();
  const matchMark = Decoration.mark({ class: "cm-searchMatch" });
  const selectedMark = Decoration.mark({ class: "cm-searchMatch cm-searchMatch-selected" });

  const field = StateField.define<FindState>({
    create: () => ({ query: null, currentFrom: -1, currentTo: -1 }),
    update(st, tr) {
      let next = st;
      for (const e of tr.effects) {
        if (e.is(setQuery)) {
          next = { query: e.value, currentFrom: -1, currentTo: -1 };
        } else if (e.is(setCurrent)) {
          next = { query: next.query, currentFrom: e.value.from, currentTo: e.value.to };
        }
      }
      return next;
    },
  });

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSetT;
      constructor(view: View) {
        this.decorations = buildFindDecos(view);
      }
      update(u: import("@codemirror/view").ViewUpdate) {
        if (
          u.startState.field(field) !== u.state.field(field) ||
          u.docChanged ||
          u.viewportChanged
        ) {
          this.decorations = buildFindDecos(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  /** 只铺可见范围：命中可能上万，全文装饰会拖垮滚动 */
  function buildFindDecos(view: View): DecorationSetT {
    const st = view.state.field(field, false);
    if (!st || !st.query || !st.query.valid) return Decoration.none;
    const ranges = view.visibleRanges;
    if (ranges.length === 0) return Decoration.none;

    const builder = new RangeSetBuilder<Deco>();
    const from = ranges[0]!.from;
    const to = ranges[ranges.length - 1]!.to;
    const cursor = st.query.getCursor(view.state, from, to) as unknown as MatchCursor;
    while (!cursor.next().done) {
      const m = cursor.value;
      const isCurrent = m.from === st.currentFrom && m.to === st.currentTo;
      builder.add(m.from, m.to, isCurrent ? selectedMark : matchMark);
    }
    return builder.finish();
  }

  findKit = { field, setQuery, setCurrent, ext: [field, plugin] };
  return findKit;
}

/** 取当前查询（未挂载 / 未设查询时为 null） */
function activeFind(): SearchQueryT | null {
  if (!view || !findKit) return null;
  return view.state.field(findKit.field, false)?.query ?? null;
}

/** 正则模式下取捕获组：拿「已被查询命中的子串」再跑一次用户的模式，必然匹配 */
function groupsOf(query: SearchQueryT, text: string): string[] {
  if (!query.regexp) return [];
  try {
    const m = new RegExp(query.search).exec(text);
    return m ? m.slice(1).map((g) => g ?? "") : [];
  } catch {
    return [];
  }
}

function matchesIn(query: SearchQueryT, state: St): CodeMatch[] {
  const out: CodeMatch[] = [];
  const cursor = query.getCursor(state, 0, state.doc.length) as unknown as MatchCursor;
  while (!cursor.next().done) {
    const m = cursor.value;
    const text = state.sliceDoc(m.from, m.to);
    out.push({ from: m.from, to: m.to, text, groups: groupsOf(query, text) });
  }
  return out;
}

/* ─────────────────────── 挂载 / 卸载 ─────────────────────── */

/**
 * 在指定容器里建一个代码编辑视图（异步：要先把语言包与 CM 运行时载进来）。
 *
 * 重复调用是安全的：会先销毁上一个实例。若在等待期间又发生了挂载 / 卸载，
 * 本次挂载自动放弃（用序号比对），不会留下孤儿视图。
 */
export async function mountCodeEditor(host: HTMLElement, options: CodeEditorOptions): Promise<void> {
  unmountCodeEditor();
  const mine = seq;

  const [state, viewMod, commands, language, autocomplete, search, highlight] = await Promise.all([
    import("@codemirror/state"),
    import("@codemirror/view"),
    import("@codemirror/commands"),
    import("@codemirror/language"),
    import("@codemirror/autocomplete"),
    import("@codemirror/search"),
    import("@lezer/highlight"),
  ]);
  if (mine !== seq) return;

  const modules: CmModules = { state, view: viewMod, commands, language, autocomplete, search, highlight };
  cm = modules;
  opts = options;
  hostEl = host;

  cSep = new state.Compartment();
  cLang = new state.Compartment();
  cTheme = new state.Compartment();
  cReadonly = new state.Compartment();
  cGutter = new state.Compartment();
  cIndent = new state.Compartment();
  cType = new state.Compartment();
  cFocus = new state.Compartment();
  cWrap = new state.Compartment();

  const bm = bookmarkKit(modules);
  const fk = findKitOf(modules);

  // langId 有值时（含 null=纯文本）以它为准，否则按扩展名自动判定
  const spec =
    options.langId !== undefined ? codeLangForId(options.langId) : codeLangForExt(options.ext);
  let langExt: Ext = [];
  if (spec) {
    try {
      langExt = await spec.load();
    } catch {
      // 语言包加载失败不能连编辑器都打不开：降级为纯文本，功能照旧
      langExt = [];
    }
  }
  if (mine !== seq) return;

  const extensions: Ext = [
    cSep.of(state.EditorState.lineSeparator.of(sepOf(options.value))),
    viewMod.highlightSpecialChars(),
    viewMod.drawSelection(),
    viewMod.dropCursor(),
    viewMod.rectangularSelection(),
    viewMod.crosshairCursor(),
    viewMod.highlightActiveLine(),
    viewMod.highlightActiveLineGutter(),
    state.EditorState.allowMultipleSelections.of(true),
    commands.history(),
    // 编辑体验（notepad4 对标）：折叠 / 自动缩进 / 括号引号配对 / 文档内词汇补全
    language.codeFolding(),
    language.foldGutter(),
    language.indentOnInput(),
    autocomplete.closeBrackets(),
    autocomplete.autocompletion({ override: [localWordSource] }),
    // 选中词高亮全部出现处（计数另走 updateListener，见下）
    search.highlightSelectionMatches({ minSelectionLength: 2 }),
    bm.ext,
    // 查找高亮（查询本体来自应用层顶栏，这里只负责按查询铺 .cm-searchMatch）
    fk.ext,
    // indentWithTab：Tab 在代码里就该是缩进（而不是跳焦点），写进帮助说明
    viewMod.keymap.of([
      ...commands.defaultKeymap,
      ...commands.historyKeymap,
      ...autocomplete.closeBracketsKeymap,
      ...language.foldKeymap,
      commands.indentWithTab,
      { key: "Ctrl-Space", run: autocomplete.startCompletion },
      // 书签快捷键（Ctrl+F2 / F4 / Shift+F4）统一由应用层的全局 keydown 处理：
      // 这里不注册，否则 CM 处理一次（CM 的 keymap 只 preventDefault、不停冒泡），
      // 事件继续冒到 window 又被应用层处理一次，会连跳两次 / 切了又立刻取消。
    ]),
    viewMod.EditorView.contentAttributes.of({ spellcheck: "false", autocapitalize: "off" }),
    cIndent.of(language.indentUnit.of(indentText(spec))),
    cGutter.of(options.lineNumbers ? viewMod.lineNumbers() : []),
    // 自动换行：默认关（一行占一行，超出横向滚动）；开关由应用层经 setCodeLineWrapping 驱动
    cWrap.of(options.wrap ? viewMod.EditorView.lineWrapping : []),
    cLang.of(langExt),
    cTheme.of(buildTheme(modules, options.dark)),
    cReadonly.of(readonlyExt(modules, options.readonly)),
    cType.of(options.typewriter ? typewriterExt(modules) : []),
    cFocus.of(options.paragraphFocus ? focusExt(modules) : []),
    viewMod.EditorView.updateListener.of((u) => {
      if (u.docChanged) opts?.onChange();
      if (u.docChanged || u.selectionSet) emitCursor(u.state);
    }),
    // 与装饰分开的一条：只在「选中 / 正文稳定 200ms 后」数一次，避免每次按键都全文扫描
    viewMod.EditorView.updateListener.of((u) => {
      if (u.docChanged || u.selectionSet) scheduleMatchCount();
    }),
  ];

  const st = state.EditorState.create({ doc: options.value, extensions });
  view = new viewMod.EditorView({ state: st, parent: host });

  // 容器在挂载的那一帧可能还没量出高度（覆盖层刚由 Svelte 插入），下一帧补量一次；
  // 之后交给 ResizeObserver，侧边栏开合、窗口缩放都能跟上。
  requestAnimationFrame(() => view?.requestMeasure());
  resizeObs = new ResizeObserver(() => view?.requestMeasure());
  resizeObs.observe(host);

  emitCursor(st);
  scheduleMatchCount(); // 新文档先同步一次状态栏计数（初始为 0）
}

/** 销毁代码视图（未挂载时为 no-op） */
export function unmountCodeEditor(): void {
  seq += 1;
  clearMatchCount();
  resizeObs?.disconnect();
  resizeObs = null;
  view?.destroy();
  view = null;
  if (hostEl) hostEl.innerHTML = "";
  hostEl = null;
  opts = null;
  cm = null;
  bmKit = null;
  findKit = null;
  cSep = null;
  cLang = null;
  cTheme = null;
  cReadonly = null;
  cGutter = null;
  cIndent = null;
  cType = null;
  cFocus = null;
  cWrap = null;
}

/** 代码视图是否处于挂载状态 */
export function isCodeEditorMounted(): boolean {
  return view !== null;
}

/* ─────────────────────── 取值 / 赋值 ─────────────────────── */

/**
 * 取正文。用 `sliceDoc()` 而不是 `doc.toString()`：前者按 state 的 lineBreak 拼行，
 * 后者固定用 "\n"，会把 CRLF 文件静默改成 LF（见文件头第 1 条）。
 */
export function getCodeValue(): string {
  return view ? view.state.sliceDoc() : "";
}

/**
 * 整体替换正文（切换标签、重新加载、应用编码）。
 *
 * 行尾风格随新内容走：CM 的 lineSeparator 是 facet，改它必须走 Compartment，
 * 且插入文本的切分用的是「改之前」的 facet，所以先单独发一次 reconfigure。
 */
export function setCodeValue(value: string): void {
  if (!view || !cm || !cSep) return;
  const sep = sepOf(value);
  if (view.state.lineBreak !== sep) {
    view.dispatch({ effects: cSep.reconfigure(cm.state.EditorState.lineSeparator.of(sep)) });
  }
  if (view.state.sliceDoc() === value) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    selection: { anchor: 0 },
    scrollIntoView: true,
    // 整篇替换等于换了一份文档：点在全文替换时会被映射到行首堆积，旧书签必须清掉
    effects: bmKit ? bmKit.clear.of(null) : [],
  });
}

/* ─────────────────────── 状态切换 ─────────────────────── */

export function setCodeReadonly(readonly: boolean): void {
  if (!view || !cm || !cReadonly) return;
  view.dispatch({ effects: cReadonly.reconfigure(readonlyExt(cm, readonly)) });
}

export function setCodeTheme(dark: boolean): void {
  if (!view || !cm || !cTheme) return;
  view.dispatch({ effects: cTheme.reconfigure(buildTheme(cm, dark)) });
}

export function setCodeLineNumbers(visible: boolean): void {
  if (!view || !cm || !cGutter) return;
  view.dispatch({ effects: cGutter.reconfigure(visible ? cm.view.lineNumbers() : []) });
}

/** 自动换行开关（视图 → 自动换行）：未挂载时 no-op */
export function setCodeLineWrapping(on: boolean): void {
  if (!view || !cm || !cWrap) return;
  view.dispatch({
    effects: cWrap.reconfigure(on ? cm.view.EditorView.lineWrapping : []),
  });
}

/** 打字机模式开关（未挂载时 no-op，与其余 setter 的既有约定一致） */
export function setCodeTypewriter(on: boolean): void {
  if (!view || !cm || !cType) return;
  view.dispatch({ effects: cType.reconfigure(on ? typewriterExt(cm) : []) });
}

/** 段落聚焦开关（未挂载时 no-op） */
export function setCodeParagraphFocus(on: boolean): void {
  if (!view || !cm || !cFocus) return;
  view.dispatch({ effects: cFocus.reconfigure(on ? focusExt(cm) : []) });
}

/** 阅读排版：消费字号 / 行距 / 背景 / 字体 / 文字色，作用在容器上（CM 的 theme 用 var() 读它们） */
export function setCodeReaderStyle(style: CodeReaderStyle): void {
  if (!hostEl) return;
  if (style.fontSize) hostEl.style.setProperty("--cm-font-size", style.fontSize);
  else hostEl.style.removeProperty("--cm-font-size");
  if (style.lineHeight) hostEl.style.setProperty("--cm-line-height", style.lineHeight);
  else hostEl.style.removeProperty("--cm-line-height");
  if (style.fontFamily) hostEl.style.setProperty("--cm-font-family", style.fontFamily);
  else hostEl.style.removeProperty("--cm-font-family");
  // 文字色走 --cm-fg：theme 里正文 / 光标 / 提示都读它；语法高亮 token 有显式 color，不受影响
  if (style.textColor) hostEl.style.setProperty("--cm-fg", style.textColor);
  else hostEl.style.removeProperty("--cm-fg");
  // 背景要同时覆盖正文与行号槽：只改正文会让左侧一条仍是默认色，看着像没生效
  if (style.background) {
    hostEl.style.setProperty("--cm-bg", style.background);
    hostEl.style.setProperty("--cm-gutter-bg", style.background);
  } else {
    hostEl.style.removeProperty("--cm-bg");
    hostEl.style.removeProperty("--cm-gutter-bg");
  }
}

export function focusCodeEditor(): void {
  view?.focus();
}

/* ─────────────────────── 书签命令 ─────────────────────── */

/** 切换光标所在行的书签；返回是否发生变更（供 keymap 用） */
export function toggleCodeBookmark(): boolean {
  if (!view || !bmKit) return false;
  view.dispatch({ effects: bmKit.toggle.of(view.state.selection.main.head) });
  return true;
}

/**
 * 跳到下一个（dir = 1）/ 上一个（dir = -1）书签，到端点后环绕。
 * 找不到书签时返回 false，把按键让给应用层的其它处理。
 */
export function nextCodeBookmark(dir: 1 | -1): boolean {
  if (!view || !bmKit) return false;
  const state = view.state;
  const pos = state.selection.main.head;
  const starts: number[] = [];
  state.field(bmKit.field).between(0, state.doc.length, (from) => {
    starts.push(from);
  });
  if (starts.length === 0) return false;

  const target =
    dir > 0
      ? (starts.find((s) => s > pos) ?? starts[0]!)
      : (starts.filter((s) => s < pos).pop() ?? starts[starts.length - 1]!);

  view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
  view.focus();
  return true;
}

/** 当前全部书签的行首位置（升序），供应用层按标签存档 */
export function getCodeBookmarkPositions(): number[] {
  if (!view || !bmKit) return [];
  const out: number[] = [];
  const state = view.state;
  state.field(bmKit.field).between(0, state.doc.length, (from) => {
    out.push(from);
  });
  return out;
}

/** 当前全部书签（行号从 1 起 + 行文本），供侧边栏「书签」面板展示 */
export function getCodeBookmarks(): { line: number; text: string }[] {
  if (!view || !bmKit) return [];
  const out: { line: number; text: string }[] = [];
  const state = view.state;
  state.field(bmKit.field).between(0, state.doc.length, (from) => {
    const ln = state.doc.lineAt(from);
    out.push({ line: ln.number, text: ln.text });
  });
  return out;
}

/** 清空全部书签 */
export function clearCodeBookmarks(): void {
  if (!view || !bmKit) return;
  view.dispatch({ effects: bmKit.clear.of(null) });
}

/**
 * 用一组行首位置重建书签：切换标签时把该标签存档的书签装回新文档。
 * 先清空再逐条 toggle；位置按当前文档长度夹紧。
 */
export function setCodeBookmarks(positions: number[]): void {
  const kit = bmKit;
  if (!view || !kit) return;
  const len = view.state.doc.length;
  const effects = [
    kit.clear.of(null),
    ...positions.map((p) => kit.toggle.of(Math.min(Math.max(p, 0), len))),
  ];
  view.dispatch({ effects });
}

/** 把选区落到指定偏移并滚入视口（侧边栏点击书签跳转用） */
export function scrollToCodeOffset(pos: number): void {
  if (!view) return;
  const target = Math.min(Math.max(pos, 0), view.state.doc.length);
  view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
  view.focus();
}

/** 在光标所在行添加书签（该行已有书签则不动）；返回是否可用（编辑器已挂载） */
export function addCodeBookmark(): boolean {
  if (!view || !bmKit) return false;
  const state = view.state;
  const lineFrom = state.doc.lineAt(state.selection.main.head).from;
  let exists = false;
  state.field(bmKit.field).between(0, state.doc.length, (from) => {
    if (from === lineFrom) exists = true;
  });
  if (!exists) view.dispatch({ effects: bmKit.toggle.of(lineFrom) });
  return true;
}

/** 删除处于某个行首位置的书签（侧边栏「书签」面板的单条删除） */
export function removeCodeBookmark(pos: number): void {
  if (!view || !bmKit) return;
  let exists = false;
  view.state.field(bmKit.field).between(0, view.state.doc.length, (from) => {
    if (from === pos) exists = true;
  });
  if (exists) view.dispatch({ effects: bmKit.toggle.of(pos) });
}

/** 当前选中文字（无选中则为空串）；文档右键菜单「复制 / 剪切」用 */
export function getCodeSelectionText(): string {
  if (!view) return "";
  const sel = view.state.selection.main;
  return sel.empty ? "" : view.state.sliceDoc(sel.from, sel.to);
}

/** 删除选区（文档右键菜单「剪切」用；无选中时 no-op） */
export function deleteCodeSelection(): void {
  if (!view) return;
  const sel = view.state.selection.main;
  if (sel.empty) return;
  view.dispatch({ changes: { from: sel.from, to: sel.to } });
  view.focus();
}

/** 在当前选区插入文本（文档右键菜单「粘贴」用） */
export function insertCodeText(text: string): void {
  if (!view) return;
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

/** 全选（文档右键菜单「全选」用） */
export function selectAllCode(): void {
  if (!view) return;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
}

/* ─────────────────────── 查找 / 替换命令 ─────────────────────── */

/**
 * 设置查询并返回命中总数；`null` 表示查询无效（正则语法错 / 空查询）。
 *
 * 计数与高亮走同一份 `SearchQuery`：语义（大小写 / 整词 / 正则）由它统一裁决，
 * 不会出现「数了 7 处却只亮 6 处」这类两套逻辑打架的情况。
 */
export function setCodeFind(options: CodeFindOptions | null): number | null {
  if (!view || !cm || !findKit) return null;
  if (!options || !options.search) {
    clearCodeFind();
    return null;
  }
  const query = new cm.search.SearchQuery({
    search: options.search,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    regexp: options.regexp,
    // literal: 不做 \n \t 转义展开——顶栏输入的是字面文本，用户按什么就找什么
    literal: true,
  });
  if (!query.valid) return null;

  let count = 0;
  const cursor = query.getCursor(view.state, 0, view.state.doc.length) as unknown as MatchCursor;
  while (!cursor.next().done) count += 1;
  view.dispatch({ effects: findKit.setQuery.of(query) });
  return count;
}

/** 当前查询的全部命中（含文本与捕获组），供应用层做替换；无查询时 null */
export function getCodeMatches(): CodeMatch[] | null {
  const query = activeFind();
  if (!view || !query) return null;
  return matchesIn(query, view.state);
}

/** 选中第 index 处命中并滚到视野中央 */
export function gotoCodeMatch(index: number): boolean {
  if (!view || !cm || !findKit) return false;
  const matches = getCodeMatches();
  if (!matches || index < 0 || index >= matches.length) return false;
  const m = matches[index]!;
  view.dispatch({
    selection: { anchor: m.from, head: m.to },
    effects: [
      findKit.setCurrent.of({ from: m.from, to: m.to }),
      cm.view.EditorView.scrollIntoView(m.from, { y: "center" }),
    ],
  });
  view.focus();
  return true;
}

/**
 * 一次性应用多处替换，返回实际替换数。
 *
 * 调用方（App.svelte）负责给出 from/to/insert；这里只校验区间合法性与不重叠，
 * 越界或互相重叠的改动会被丢弃，避免抛异常把整次替换带崩。
 */
export function replaceCodeMatches(changes: { from: number; to: number; insert: string }[]): number {
  if (!view || !findKit) return 0;
  const len = view.state.doc.length;
  const valid = changes
    .filter((c) => c.from >= 0 && c.to <= len && c.from <= c.to)
    .sort((a, b) => a.from - b.from)
    .filter((c, i, arr) => i === 0 || c.from >= arr[i - 1]!.to);
  if (valid.length === 0) return 0;

  view.dispatch({
    changes: valid,
    // 正文已变，旧的「当前命中」位置不再有意义，清掉以免高亮错位
    effects: findKit.setCurrent.of({ from: -1, to: -1 }),
  });
  return valid.length;
}

/** 清空查询与高亮（关闭查找栏、切标签时调用） */
export function clearCodeFind(): void {
  if (!view || !findKit) return;
  if (!view.state.field(findKit.field, false)?.query) return;
  view.dispatch({ effects: findKit.setQuery.of(null) });
}

/* ─────────────────────── 选中内容（代码工具用） ─────────────────────── */

/** 取当前选中内容；无选中（或未挂载）时返回空串 */
export function getCodeSelection(): string {
  if (!view) return "";
  const r = view.state.selection.main;
  return view.state.sliceDoc(r.from, r.to);
}

/** 用文本替换当前选中（无选中即插入到光标处）；未挂载时为 no-op */
export function replaceCodeSelection(text: string): void {
  if (!view) return;
  const r = view.state.selection.main;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: { anchor: r.from + text.length },
  });
  view.focus();
}

/* ─────────────────────── 光标 ─────────────────────── */

/** 取当前行列号（均从 1 起）；未挂载时给 1,1 */
export function getCursorPosition(): { line: number; column: number } {
  if (!view) return { line: 1, column: 1 };
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  return { line: line.number, column: pos - line.from + 1 };
}

function emitCursor(state: St): void {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  opts?.onCursor?.(line.number, pos - line.from + 1);
}