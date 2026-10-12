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