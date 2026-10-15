/**
 * SV 分屏预览的锚点插值。
 *
 * 左栏是源码 `pre.vditor-sv`、右栏是渲染结果 `.vditor-preview`，两栏各自独立滚动。源码一行
 * 22px，同一段内容渲染后可能是表格、图片、代码块，高度差好几倍——按整篇高度比例换算只能
 * 保证顶端、底端对齐，中段必然漂移。故 editor.ts 先建一组锚点（同一段内容在两栏滚动内容里
 * 各自的 y 偏移），滚动时按锚点分段线性映射，这里只放纯计算，便于单测
 * （editor.ts 顶层依赖 Tauri 与 Vditor，在 vitest 的 node 环境里不可直接 import）。
 */

/** 一个锚点：sv / pv 为同一段内容在左栏、右栏各自滚动内容中的 y 偏移（px） */
export type SvAnchor = { sv: number; pv: number };

/**
 * 把一栏的滚动位置映射到另一栏。
 *
 * @param anchors 锚点表（按 sv 递增；调用方已做单调守卫）
 * @param from 当前值取自哪一栏
 * @param value 当前栏的滚动内容偏移
 * @param max 目标栏的最大滚动距离，结果会 clamp 到 [0, max]
 * @returns 目标栏的滚动位置；锚点不足或输入退化时返回 NaN，由调用方回退比例换算
 */
export function interpolateAnchors(
  anchors: SvAnchor[],
  from: "sv" | "preview",
  value: number,
  max: number,
): number {
  if (anchors.length < 2) return NaN;
  const xs = anchors.map((anchor) => (from === "sv" ? anchor.sv : anchor.pv));
  const ys = anchors.map((anchor) => (from === "sv" ? anchor.pv : anchor.sv));
  // 自变量必须严格递增才谈得上分段插值（重复 x 会让斜率无意义）
  for (let i = 1; i < xs.length; i++) {
    if (!(xs[i] > xs[i - 1])) return NaN;
  }

  const last = xs.length - 1;
  let mapped: number;
  if (value <= xs[0]) {
    mapped = atLine(xs[0], ys[0], xs[1], ys[1], value);
  } else if (value >= xs[last]) {
    mapped = atLine(xs[last - 1], ys[last - 1], xs[last], ys[last], value);
  } else {
    let i = 1;
    while (i < last && xs[i] < value) i++;
    mapped = atLine(xs[i - 1], ys[i - 1], xs[i], ys[i], value);
  }
  if (!Number.isFinite(mapped)) return NaN;
  return Math.min(max, Math.max(0, mapped));
}

/** 过 (x0, y0)、(x1, y1) 两点的直线在 x 处的值 */
function atLine(x0: number, y0: number, x1: number, y1: number, x: number): number {
  const dx = x1 - x0;
  if (dx === 0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / dx;
}