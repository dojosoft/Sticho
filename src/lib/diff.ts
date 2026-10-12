/**
 * 行级差异计算（版本对比视图）
 *
 * 自实现 LCS，不引 diff 类依赖：候选方案里库的体积与许可证成本都比这几十行贵。
 * 大文档直接跑 O(n·m) 会把内存打满，所以先剪掉公共前后缀（版本对比通常只有少数
 * 几处改动，剪完往往只剩几十行），再按剩余规模决定是否降级为分块粗比对。
 */

/** 差异行类型：相同 / 新增 / 删除 */
export type DiffLineType = "equal" | "add" | "del";

/** 一行差异（oldLine/newLine 为 1 起行号，缺失表示该侧没有这一行） */
export type DiffLine = {
  type: DiffLineType;
  text: string;
  oldLine?: number;
  newLine?: number;
};

/** 差异统计（用于"超出阈值只显示统计"的降级展示） */
export type DiffStats = {
  added: number;
  removed: number;
  unchanged: number;
};

/**
 * 动态规划的格子数上限（约 4M 格 → Int32Array 16MB）。
 * 超过即降级，避免几百 KB 的版本对比把内存打满。
 */
export const DIFF_MAX_CELLS = 4_000_000;

/** 降级模式下的分块行数 */
const FALLBACK_BLOCK = 200;

/**
 * 按行切分，行号与编辑器保持一致。
 *
 * 换行统一成 LF；末尾换行不额外算一行空行，否则每次对比都会多出一条假的删除行。
 */
export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (normalized === "") return [];
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return body.split("\n");
}

/** 内部表示：old/new 为所在侧的下标，-1 表示该侧没有这一行 */
type RawLine = { type: DiffLineType; text: string; old: number; new: number };

/**
 * 对比两段文本，输出逐行差异。
 *
 * 返回的顺序即"合并视图"的顺序：等同行按原文顺序穿插，删除行紧接其对应的新增行之前。
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  // 剪公共前缀
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  // 剪公共后缀（不能越过已剪的前缀）
  let endA = a.length;
  let endB = b.length;
  while (endA > head && endB > head && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(head, endA);
  const midB = b.slice(head, endB);
  const mid =
    (midA.length + 1) * (midB.length + 1) > DIFF_MAX_CELLS
      ? blockDiff(midA, midB)
      : lcsDiff(midA, midB);

  const out: DiffLine[] = [];
  for (let i = 0; i < head; i++) {
    out.push({ type: "equal", text: a[i]!, oldLine: i + 1, newLine: i + 1 });
  }
  for (const line of mid) {
    out.push({
      type: line.type,
      text: line.text,
      oldLine: line.old >= 0 ? head + line.old + 1 : undefined,
      newLine: line.new >= 0 ? head + line.new + 1 : undefined,
    });
  }
  for (let i = endA; i < a.length; i++) {
    const offset = i - endA;
    out.push({
      type: "equal",
      text: a[i]!,
      oldLine: i + 1,
      newLine: endB + offset + 1,
    });
  }
  return out;
}

/** 标准 LCS 回溯 */
function lcsDiff(a: string[], b: string[]): RawLine[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    const row = i * width;
    const next = row + width;
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] =
        a[i] === b[j]
          ? dp[next + j + 1]! + 1
          : Math.max(dp[next + j]!, dp[row + j + 1]!);
    }
  }

  const out: RawLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "equal", text: a[i]!, old: i, new: j });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!) {
      out.push({ type: "del", text: a[i]!, old: i, new: -1 });
      i++;
    } else {
      out.push({ type: "add", text: b[j]!, old: -1, new: j });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i]!, old: i, new: -1 });
    i++;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j]!, old: -1, new: j });
    j++;
  }
  return out;
}

/**
 * 降级模式：按固定窗口对位比较。
 *
 * 只要块内不完全一致就把整块标成"删 + 增"，比真实差异粗，但保证
 * 任意输入都能在有限时间与内存内给出结果——只在超长文档上触发。
 */
function blockDiff(a: string[], b: string[]): RawLine[] {
  const out: RawLine[] = [];
  const blocks = Math.max(
    Math.ceil(a.length / FALLBACK_BLOCK),
    Math.ceil(b.length / FALLBACK_BLOCK),
  );

  for (let k = 0; k < blocks; k++) {
    const start = k * FALLBACK_BLOCK;
    const aBlock = a.slice(start, start + FALLBACK_BLOCK);
    const bBlock = b.slice(start, start + FALLBACK_BLOCK);
    const same =
      aBlock.length === bBlock.length && aBlock.every((line, idx) => line === bBlock[idx]);

    if (same) {
      aBlock.forEach((line, idx) =>
        out.push({ type: "equal", text: line, old: start + idx, new: start + idx }),
      );
      continue;
    }
    aBlock.forEach((line, idx) => out.push({ type: "del", text: line, old: start + idx, new: -1 }));
    bBlock.forEach((line, idx) => out.push({ type: "add", text: line, old: -1, new: start + idx }));
  }
  return out;
}

/** 统计增删行数，供差异视图顶部摘要与超大文档降级展示使用 */
export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of lines) {
    if (line.type === "add") added++;
    else if (line.type === "del") removed++;
    else unchanged++;
  }
  return { added, removed, unchanged };
}