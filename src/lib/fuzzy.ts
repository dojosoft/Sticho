/**
 * 命令面板的模糊匹配
 *
 * 只做"子序列命中 + 位置加权"，不引入 fzf 类库：面板候选只有几十到几百条，
 * 打分规则自己写反而更好调，也省掉一个依赖。
 */

/** 匹配结果：score 越高越靠前；positions 为命中字符下标（供高亮） */
export type FuzzyMatch = {
  score: number;
  positions: number[];
};

/** 视为"词首"的分隔符（命中这些字符之后的字符额外加分） */
const WORD_SEPARATORS = new Set([" ", "-", "_", "/", "\\", ".", ":", "(", ")", "[", "]"]);

/** 当前字符是否位于词首：开头、分隔符之后、或 camelCase 边界 */
function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1]!;
  const cur = text[index]!;
  if (WORD_SEPARATORS.has(prev)) return true;
  return /[a-z0-9]/.test(prev) && /[A-Z]/.test(cur);
}

/**
 * 模糊匹配 query 是否为目标文本的子序列，并给出分数。
 *
 * 空查询返回 0 分（面板空查询时即"全部候选，保持原序"）。
 * 查询里的空格只当分词处理，不参与匹配，便于输入 "导出 word" 这类多词命令名。
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (query === "") return { score: 0, positions: [] };

  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let cursor = 0;
  let prev = -2;

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    if (ch === " ") continue;

    let found = -1;
    for (let k = cursor; k < t.length; k++) {
      if (t[k] === ch) {
        found = k;
        break;
      }
    }
    if (found === -1) return null;

    let add = 1;
    if (found === prev + 1) add += 4; // 连续命中，视为整体词
    if (isWordStart(target, found)) add += 6; // 命中词首，更接近用户意图
    score += add;
    score -= Math.min(4, (found - cursor) * 0.1); // 跳跃惩罚，设上限避免长文本被过度惩罚

    positions.push(found);
    prev = found;
    cursor = found + 1;
  }

  score -= Math.min(6, positions[0]! * 0.5); // 命中位置越靠后越差
  return { score, positions };
}

/**
 * 对候选做模糊筛选与排序。
 *
 * 同分时保持传入顺序（原顺序即菜单顺序），保证面板在空查询时就是一份稳定的目录。
 */
export function fuzzyRank<T>(query: string, items: T[], text: (item: T) => string): T[] {
  const scored: { item: T; index: number; score: number }[] = [];
  items.forEach((item, index) => {
    const match = fuzzyMatch(query, text(item));
    if (match) scored.push({ item, index, score: match.score });
  });
  scored.sort((x, y) => y.score - x.score || x.index - y.index);
  return scored.map((entry) => entry.item);
}