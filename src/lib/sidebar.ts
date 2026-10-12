/**
 * 侧边栏相关纯逻辑（任务书阶段 11）
 *
 * 视图类型 + Markdown 标题层级解析。DOM 渲染在 components/Sidebar.svelte，
 * 这里只做与界面无关的计算，便于单独推理与复用。
 */

/** 侧边栏视图：文件目录树 / 文档大纲 / 文件属性 */
export type SidebarView = "tree" | "outline" | "props";

/** 大纲条目 */
export type OutlineItem = {
  /** 标题层级 1-6 */
  level: number;
  /** 标题文字（已去掉链接、强调等 Markdown 标记，仅用于显示与定位比对） */
  text: string;
  /** 源文件行号（0 起） */
  line: number;
  /** HTML 大纲：标题标签在源码中的起止字符偏移（Markdown 大纲不提供） */
  start?: number;
  end?: number;
};

/**
 * HTML 源码 → 纯文本：剔除 script/style/noscript 与全部标签，还原常见实体。
 *
 * 用于 HTML 文档模式下的字数统计与标题文字提取（不做完整解析，够用即可）。
 */
export function htmlPlainText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** 去掉标题里的行内 Markdown 标记，只留下人类可读的文字 */
function plainText(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // 图片 → 替代文字
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 → 链接文字
    .replace(/[*_~`]/g, "")
    .trim();
}

/**
 * front matter 区块的结束行号（-1 = 没有 front matter）。
 *
 * 判定条件：首行恰为 `---`，其后再出现一行 `---` 或 `...`。
 */
function frontMatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i]!)) return i;
  }
  return -1;
}

/**
 * 解析头部 front matter（首行 `---` 与结束 `---` / `...` 之间的 YAML 区块）。
 *
 * 只认顶层 `key: value`：值支持引号、`[a, b]` 流式数组，以及写在下一行的 `- item`
 * 列表（tags 常见写法）。嵌套结构、锚点等原样跳过——属性面板只需要
 * title / date / tags 这类扁平字段。没有 front matter 时返回空数组。
 */
export function parseFrontMatter(markdown: string): [string, string][] {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const end = frontMatterEnd(lines);
  if (end < 0) return [];

  const map = new Map<string, string>();
  let listKey: string | null = null; // 值写在后续 `- item` 行里的字段名

  for (let i = 1; i < end; i++) {
    const line = lines[i]!;
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const prev = map.get(listKey) ?? "";
      const value = frontMatterScalar(item[1]!);
      map.set(listKey, prev ? `${prev}, ${value}` : value);
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      listKey = null; // 缩进的嵌套结构：不解析，也不再往上一个字段追加列表项
      continue;
    }
    const key = kv[1]!;
    const raw = kv[2]!.trim();
    if (raw === "") {
      listKey = key; // 值在后面的 `- item` 行里
      map.set(key, "");
      continue;
    }
    listKey = null;
    map.set(key, frontMatterScalar(raw));
  }

  return [...map];
}

/** front matter 单值归一化：去掉引号、展开 `[a, b]` 流式数组 */
function frontMatterScalar(raw: string): string {
  const value = raw.trim();
  const flow = /^\[(.*)\]$/.exec(value);
  if (flow) {
    return flow[1]!
      .split(",")
      .map((part) => frontMatterScalar(part))
      .filter((part) => part !== "")
      .join(", ");
  }
  return value.replace(/^["']|["']$/g, "").trim();
}

/**
 * 解析 Markdown 生成大纲：支持 ATX（# 标题）与 Setext（下划线式）两种写法。
 *
 * 围栏代码块内的 `#` 不是标题，必须跳过，否则代码示例会污染大纲。
 * 头部 front matter 整块也跳过：否则 `title: x` 的下一行是 `---`，会被 Setext 规则
 * 误判成二级标题，博客类文档的大纲首项就会多出一条 `title: x`。
 * 缩进引用（`> # 标题`）等边缘写法不识别，属可接受的取舍。
 */
export function parseOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = markdown.split(/\r\n|\r|\n/);
  const fmEnd = frontMatterEnd(lines);
  let fence: string | null = null; // 当前所处的围栏标记（``` 或 ~~~）

  for (let i = 0; i < lines.length; i++) {
    if (fmEnd >= 0 && i <= fmEnd) continue;
    const line = lines[i]!;

    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (fence === null) fence = marker[0]!;
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const atx = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (atx) {
      items.push({ level: atx[1]!.length, text: plainText(atx[2]!), line: i });
      continue;
    }

    // Setext：下一行是 ===（1 级）或 ---（2 级）时，本行是标题
    const next = lines[i + 1];
    if (next && line.trim() && /^\s{0,3}(=+|-+)\s*$/.test(next)) {
      items.push({ level: next.trim().startsWith("=") ? 1 : 2, text: plainText(line), line: i });
    }
  }

  return items;
}

/**
 * 解析 HTML 生成大纲（HTML 文档模式）。
 *
 * 只取 `<h1>`~`<h6>` 的可见文字，并记录标签在源码中的起止字符偏移，
 * 供源码视图精确定位——压缩型 HTML 里几十个标题可能同处一行（实测有 44 万字符
 * 一行），只靠行号只能落到行首，无法区分是哪一个标题。
 *
 * 偏移量以 **LF 换行**计：它最终被用来操作源码 textarea，而 textarea 的 value
 * 会把 CRLF 规范成 LF（每行少一个字符）。若直接在含 CRLF 的原文上算偏移，
 * Windows 换行的文件会整体偏移、定位落到标题之外，故先把换行统一成 LF。
 * 行号按扫描进度累加换行数，避免逐条 slice 造成 O(n²)。
 */
export function parseOutlineFromHtml(html: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const source = html.replace(/\r\n?/g, "\n");
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;

  const countNewlines = (text: string): number => {
    let n = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  };

  let scanned = 0;
  let line = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    line += countNewlines(source.slice(scanned, match.index));
    scanned = match.index;

    const text = htmlPlainText(match[2]!);
    if (text) {
      items.push({
        level: Number(match[1]),
        text,
        line,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return items;
}
