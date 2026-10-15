/**
 * 跨文件搜索的结果整理
 *
 * 真正的目录遍历与匹配在 Rust 侧（commands/file_io.rs 的 search_files），
 * 这里只做"按文件分组 + 截断标记 + 高亮切片"这些纯计算，便于单独推理与单测。
 */

/** 单条命中（line 为 1 起行号，column 为行内字符下标、0 起） */
export type SearchHit = {
  path: string;
  line: number;
  column: number;
  text: string;
};

/** 按文件分组后的结果 */
export type SearchGroup = {
  path: string;
  /** 实际展示的命中（最多 perFile 条） */
  hits: SearchHit[];
  /** 该文件还有未展示的命中 */
  truncated: boolean;
};

/** 每个文件默认最多展示的命中条数，避免单个大文件淹没其他结果 */
export const SEARCH_PER_FILE_LIMIT = 20;

/**
 * 按文件分组，保留文件首次出现的顺序（与 Rust 侧的遍历顺序一致，看起来更稳定）。
 */
export function groupSearchHits(
  hits: SearchHit[],
  perFile = SEARCH_PER_FILE_LIMIT,
): SearchGroup[] {
  const groups: SearchGroup[] = [];
  const index = new Map<string, number>();

  for (const hit of hits) {
    let at = index.get(hit.path);
    if (at === undefined) {
      at = groups.length;
      index.set(hit.path, at);
      groups.push({ path: hit.path, hits: [], truncated: false });
    }
    const group = groups[at]!;
    if (group.hits.length >= perFile) {
      group.truncated = true;
      continue;
    }
    group.hits.push(hit);
  }
  return groups;
}

/** 文本切片：hit 为 true 的片段需要高亮 */
export type TextSegment = {
  text: string;
  hit: boolean;
};

/**
 * 把一行文本按查询词切成"高亮 / 非高亮"片段，交给模板渲染，避免拼 HTML 字符串。
 *
 * 字面量匹配（不解析正则），大小写不敏感（caseSensitive 可关）。空查询返回原样一段。
 */
export function highlightSegments(
  text: string,
  query: string,
  caseSensitive = false,
): TextSegment[] {
  if (query === "" || text === "") return [{ text, hit: false }];

  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const segments: TextSegment[] = [];

  let cursor = 0;
  while (cursor < text.length) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) segments.push({ text: text.slice(cursor, at), hit: false });
    segments.push({ text: text.slice(at, at + needle.length), hit: true });
    cursor = at + needle.length;
  }

  if (segments.length === 0) return [{ text, hit: false }];
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}

/** 正则里的元字符：出现在这些字符之前的 `\` 表示「按字面量取该字符」 */
const REGEX_META = new Set(["\\", "^", "$", ".", "|", "?", "*", "+", "(", ")", "[", "]", "{", "}"]);

/**
 * 从正则源码里挑出最长的一段**字面量**，用作粗筛关键词。
 *
 * Rust 侧的跨文件搜索只认字面量（不引 regex crate），正则模式于是先抽一段「必然出现」
 * 的字面量交给它缩小范围，再由前端用完整正则对候选行二次匹配。
 *
 * 这个返回值是**硬性粗筛**（Rust 侧按 `line.find(needle)` 过滤），所以一旦它不是真命中的
 * 子串，那些行根本回不来——「搜不到明明存在的内容」比放宽范围严重得多。故下列情形一律
 * 放弃（返回空串，由调用方提示用户补一段确定的文字）：交替 `a|b`、环视
 * `(?=` `(?!` `(?<=` `(?<!`、以及量词直接作用于字面量（`colou?r` 的 u、`\d{4}` 的计数 4）。
 */
export function literalAnchor(source: string): string {
  let best = "";
  let run = "";
  let inClass = false;
  /** 上一个结构是不是「分组收尾」：用于识别 `(abc)?` 这类作用于分组的量词 */
  let afterGroup = false;

  const flush = (): void => {
    if (run.length > best.length) best = run;
    run = "";
  };

  /** 量词作用于刚读完的字面量：退掉被量化的那个字符再结算；返回本次是否退掉了字符 */
  const dropQuantified = (): boolean => {
    if (run === "") return false;
    run = run.slice(0, -1);
    flush();
    return true;
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;

    if (ch === "\\") {
      const next = source[i + 1];
      // 转义的元字符（\. \+ \/ \- …）是字面量；转义字母（\d \w \n …）是字符类别，不算
      if (next !== undefined && REGEX_META.has(next)) {
        if (!inClass) run += next;
      } else {
        flush();
      }
      afterGroup = false;
      i++; // 跳过被转义的字符
      continue;
    }

    if (inClass) {
      if (ch === "]") inClass = false;
      continue; // 字符类内部是「择一」，取任一字符都不能代表整体命中，故不作锚点
    }
    if (ch === "[") {
      flush();
      inClass = true;
      afterGroup = false;
      continue;
    }
    if (ch === "|") {
      // 交替：命中可能落在任一分支，各分支共有的字面量求不出来，一律放弃
      return "";
    }
    if (ch === "?") {
      if (source[i - 1] === "(") {
        const next = source[i + 1];
        const after = source[i + 2];
        // 环视的内容不属于命中本身，整条正则都不能拿它做粗筛
        if (next === "=" || next === "!" || (next === "<" && (after === "=" || after === "!"))) {
          return "";
        }
        // `(?:` 与 `(?<name>` 只是分组标记，标记字符不是字面量，跳到标记之后继续读
        if (next === ":") {
          i += 1;
          afterGroup = false;
          continue;
        }
        if (next === "<") {
          const end = source.indexOf(">", i + 2);
          i = end === -1 ? source.length : end;
          afterGroup = false;
          continue;
        }
      }
      // 普通量词：`colou?r` 的 u 不保证出现，必须退掉；`(abc)?` 整体不可证，放弃
      if (!dropQuantified() && afterGroup) return "";
      afterGroup = false;
      continue;
    }
    if (ch === "*") {
      if (!dropQuantified() && afterGroup) return "";
      afterGroup = false;
      continue;
    }
    if (ch === "{") {
      if (!dropQuantified() && afterGroup) return "";
      // 量词体（4 / 2,5 / 3,）里是计数而不是字面量，整段跳过
      const end = source.indexOf("}", i + 1);
      i = end === -1 ? source.length : end;
      afterGroup = false;
      continue;
    }
    if (ch === "+") {
      // `x+` 至少要出现一次，字面量仍然成立；`(abc)+` 同理（分组内容已计入 best）
      flush();
      afterGroup = false;
      continue;
    }
    if (REGEX_META.has(ch)) {
      afterGroup = ch === ")";
      flush(); // 元字符切断当前片段
      continue;
    }
    run += ch; // 普通字符即字面量
    afterGroup = false;
  }
  flush();

  return best;
}

/**
 * 正则模式下把一行切成「高亮 / 非高亮」片段（与 highlightSegments 同构）。
 *
 * source 语法有误时按「整行不高亮」处理：语法错误由搜索入口提前拦截，这里是渲染兜底。
 */
export function highlightRegexSegments(
  text: string,
  source: string,
  caseSensitive = false,
): TextSegment[] {
  if (source === "" || text === "") return [{ text, hit: false }];

  let re: RegExp;
  try {
    re = new RegExp(source, caseSensitive ? "g" : "gi");
  } catch {
    return [{ text, hit: false }];
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  // 空匹配（如 `a*`）会让 exec 原地打转，强制把 lastIndex 前移一格跳过
  while ((m = re.exec(text)) !== null) {
    if (m[0] === "") {
      re.lastIndex += 1;
      continue;
    }
    if (m.index > cursor) segments.push({ text: text.slice(cursor, m.index), hit: false });
    segments.push({ text: m[0], hit: true });
    cursor = m.index + m[0].length;
  }

  if (segments.length === 0) return [{ text, hit: false }];
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}