/**
 * 查找 / 替换的纯逻辑（批次 3.3 从 App.svelte 抽取）
 *
 * 这里只放不依赖组件状态的函数：正则编译、命中收集、替换展开、命中高亮。
 * 与组件状态（findText / findCase …）和编辑器实例对接的薄适配留在 App.svelte，
 * 因此本模块可直接单测。
 *
 * 三条通路共用同一套「编译 → 找位置」逻辑：
 *   - Markdown / 编辑器正文：Range（DOM）命中；
 *   - HTML 源码视图：字符串命中（textarea 无法登记 Range 高亮）；
 *   - 大文档分节 / HTML 预览：复用 DOM 命中，只是根节点不同。
 */

/** 三个匹配开关（对应顶栏 大小写 / 全词 / 正则） */
export type FindFlags = { caseSensitive: boolean; wholeWord: boolean; regex: boolean };

/** 正则元字符转义（字面量模式下把用户输入当成纯文本） */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 按三个开关编译查找正则。
 *
 * 统一走正则引擎的好处：大小写、全词、正则三种匹配共用同一套「找位置」逻辑，
 * 替换也能直接用 `String.replace` 的 `$1` 捕获组语义。
 * 返回 null 表示无查询内容或正则语法有误（前端提示，不抛异常）。
 *
 * 注意：返回的正则带 `g` 标志且**有状态**（`lastIndex`），复用前必须自行重置。
 */
export function compileFindRegex(text: string, flags: FindFlags): RegExp | null {
  if (!text) return null;
  const source = flags.regex ? text : escapeRegExp(text);
  // 全词匹配用自定义边界而不是 \b：\b 只认 ASCII 单词边界，中文词会被整段吞掉。
  // 两侧字符只要不是字母数字/下划线/汉字，就算词的边界。
  const body = flags.wholeWord
    ? `(?<![\\w\\u4e00-\\u9fff])(?:${source})(?![\\w\\u4e00-\\u9fff])`
    : source;
  try {
    return new RegExp(body, flags.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/** 一个 DOM 内的命中：Range 用于定位/高亮/替换，text 与 groups 供替换时展开 `$1` */
export type DomHit = { range: Range; text: string; groups: string[] };

/**
 * 在给定根节点内收集全部命中（用传入的正则）。
 *
 * 只遍历文本节点，所以「被标签切开的短语」不匹配（如 `**加粗**` 里的跨标记短语），
 * 与阶段 10 的既有取舍一致。返回 null 表示正则语法有误。
 */
export function collectDomHits(root: Node | null, doc: Document, re: RegExp | null): DomHit[] | null {
  if (!re) return null;
  if (!root) return [];

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // script/style/noscript 里的文本不可见，不该被命中
      return (node as Text).parentElement?.closest("script,style,noscript")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  const hits: DomHit[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    const hay = textNode.data;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++; // 零宽匹配（如 `a*`）不推进 lastIndex 会死循环
        continue;
      }
      const range = doc.createRange();
      range.setStart(textNode, m.index);
      range.setEnd(textNode, m.index + m[0].length);
      hits.push({ range, text: m[0], groups: m.slice(1).map((g) => g ?? "") });
    }
  }
  return hits;
}

/** 字符串内的命中（HTML 源码视图的 textarea 走这条；textarea 没法登记 Range 高亮） */
export type StringHit = { index: number; text: string; groups: string[] };

/** 在字符串内收集全部命中（用传入的正则）。返回 null 表示正则语法有误。 */
export function collectStringHits(hay: string, re: RegExp | null): StringHit[] | null {
  if (!re) return null;

  const hits: StringHit[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    hits.push({ index: m.index, text: m[0], groups: m.slice(1).map((g) => g ?? "") });
  }
  return hits;
}

/**
 * 替换文本里的 `$&` / `$$` / `$1`…`$99` 展开；字面量模式（regex=false）不展开，输入什么就是什么。
 *
 * 组号语义对齐 JS 原生 `String.replace`：两位组号超出捕获组数时按「第一位组号 + 第二位字面数字」
 * 处理（`$12` 在只有 3 个组时展开成第 1 组加 "2"），组号不存在时原样保留 `$n`。
 * 不实现 `` $` `` / `$'`——那需要匹配点前后的上下文，查找栏也没有对外宣传这两种写法。
 */
export function applyReplacement(
  template: string,
  full: string,
  groups: string[],
  regex: boolean,
): string {
  if (!regex) return template;
  return template.replace(/\$(\$|&|\d{1,2})/g, (whole, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return full;
    const index = Number(token);
    if (index > 0 && index <= groups.length) return groups[index - 1] ?? "";
    if (token.length === 2) {
      const first = Number(token[0]);
      if (first > 0 && first <= groups.length) return (groups[first - 1] ?? "") + token[1];
    }
    return whole;
  });
}

/** 命中列表里第一处「偏移不小于 offset」的下标（列表按偏移升序，故可二分） */
export function hitIndexFrom(hits: StringHit[], offset: number): number {
  let lo = 0;
  let hi = hits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hits[mid]!.index < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---- 命中高亮（CSS Custom Highlight API，零 DOM 侵入）----
// 不用包裹 <mark>：那会改 DOM，Vditor 下一次 input 就会把包裹元素当正文回写进 Markdown。
// Custom Highlight 只登记 Range，正文结构与回写结果都不受影响。

/** 普通命中与「当前」命中分属两个名字，各用各的颜色 */
const HL_ALL = "md-find";
const HL_CURRENT = "md-find-current";

type HighlightCtor = new (...ranges: Range[]) => unknown;
type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };

/** 运行时能力：WebView2 的 Chromium ≥105 才有（更早版本返回 undefined，高亮降级为无） */
function highlightRegistry(): HighlightRegistry | null {
  return (CSS as unknown as { highlights?: HighlightRegistry }).highlights ?? null;
}

function highlightCtor(): HighlightCtor | null {
  return (window as unknown as { Highlight?: HighlightCtor }).Highlight ?? null;
}

/**
 * 单次登记的 Range 上限。
 *
 * `new Highlight(...ranges)` 是变参调用，实参数量有引擎上限（约 6.5 万）；正文命中极多时
 * （例如在大文件里搜一个空格）整批展开会直接抛 RangeError，把查找流程打断。
 * 高亮只是视觉辅助，超出部分丢掉不影响命中计数、定位与替换的正确性。
 */
const MAX_HIGHLIGHT_RANGES = 5000;

/** 登记高亮：普通命中的那一组与「当前」那处分两个名字，各用各的颜色 */
export function setHighlightRanges(ranges: Range[], current: Range | null): void {
  const registry = highlightRegistry();
  const Ctor = highlightCtor();
  if (!registry || !Ctor) return;
  const listed = ranges.length > MAX_HIGHLIGHT_RANGES ? ranges.slice(0, MAX_HIGHLIGHT_RANGES) : ranges;
  if (listed.length > 0) registry.set(HL_ALL, new Ctor(...listed));
  else registry.delete(HL_ALL);
  if (current) registry.set(HL_CURRENT, new Ctor(current));
  else registry.delete(HL_CURRENT);
}

/** 给全部命中上色，当前命中的那一处用另一种颜色区分 */
export function applyFindHighlights(hits: DomHit[], currentIdx: number): void {
  const others = hits.filter((_, i) => i !== currentIdx).map((h) => h.range);
  setHighlightRanges(others, currentIdx >= 0 ? (hits[currentIdx]?.range ?? null) : null);
}

/** 清掉高亮（关闭查找栏、切换文档、重新输入时都要清，否则会留下过期 Range） */
export function clearFindHighlights(): void {
  const registry = highlightRegistry();
  registry?.delete(HL_ALL);
  registry?.delete(HL_CURRENT);
}