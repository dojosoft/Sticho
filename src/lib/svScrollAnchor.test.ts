import { describe, expect, it } from "vitest";
import { interpolateAnchors, type SvAnchor } from "./svScrollAnchor";

const anchors: SvAnchor[] = [
  { sv: 0, pv: 0 },
  { sv: 100, pv: 250 },
  { sv: 200, pv: 300 },
];

describe("interpolateAnchors", () => {
  it("两锚点之间按线性插值", () => {
    // sv 50 落在 (0,0)-(100,250) 的中点
    expect(interpolateAnchors(anchors, "sv", 50, 1000)).toBe(125);
    // 正好落在锚点上时取该锚点的目标值
    expect(interpolateAnchors(anchors, "sv", 100, 1000)).toBe(250);
  });

  it("反向映射（以右栏为自变量）同样成立", () => {
    // pv 250 落在 (0,0)-(250,100) 的终点
    expect(interpolateAnchors(anchors, "preview", 250, 1000)).toBe(100);
    expect(interpolateAnchors(anchors, "preview", 125, 1000)).toBe(50);
  });

  it("落在首末锚点之外时按首末段外推，并 clamp 到 [0, max]", () => {
    // 300 超出末锚点 200，按 (100,250)-(200,300) 的斜率外推得 350
    expect(interpolateAnchors(anchors, "sv", 300, 1000)).toBe(350);
    expect(interpolateAnchors(anchors, "sv", 300, 320)).toBe(320);
    // 反向也是一样：低于首锚点会外推到负数，被 clamp 到 0
    expect(interpolateAnchors(anchors, "sv", -50, 1000)).toBe(0);
  });

  it("锚点不足两个时返回 NaN（调用方回退比例换算）", () => {
    expect(Number.isNaN(interpolateAnchors([], "sv", 10, 100))).toBe(true);
    expect(Number.isNaN(interpolateAnchors([{ sv: 0, pv: 0 }], "sv", 10, 100))).toBe(true);
  });

  it("自变量非严格递增时返回 NaN", () => {
    const repeated: SvAnchor[] = [
      { sv: 0, pv: 0 },
      { sv: 0, pv: 10 },
    ];
    const reversed: SvAnchor[] = [
      { sv: 100, pv: 0 },
      { sv: 0, pv: 10 },
    ];
    expect(Number.isNaN(interpolateAnchors(repeated, "sv", 0, 100))).toBe(true);
    expect(Number.isNaN(interpolateAnchors(reversed, "sv", 50, 100))).toBe(true);
  });
});