import { describe, expect, it } from "vitest";

import { fuzzyMatch, fuzzyRank } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("空查询返回 0 分且不产生命中位置", () => {
    expect(fuzzyMatch("", "导出 Word")).toEqual({ score: 0, positions: [] });
  });

  it("非子序列返回 null", () => {
    expect(fuzzyMatch("xyz", "导出 Word")).toBeNull();
    expect(fuzzyMatch("abc", "acb")).toBeNull();
  });

  it("大小写不敏感", () => {
    expect(fuzzyMatch("EXCEL", "导出 Excel")?.positions).toEqual([3, 4, 5, 6, 7]);
    expect(fuzzyMatch("excel", "导出 Excel")?.positions).toEqual([3, 4, 5, 6, 7]);
  });

  it("连续命中优于分散命中", () => {
    const consecutive = fuzzyMatch("abc", "abc")!;
    const scattered = fuzzyMatch("abc", "a?b?c")!;
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it("词首命中优于词中命中", () => {
    const wordStart = fuzzyMatch("b", "a-bc")!;
    const middle = fuzzyMatch("b", "abc")!;
    expect(wordStart.score).toBeGreaterThan(middle.score);
  });

  it("命中位置越靠后得分越低", () => {
    const early = fuzzyMatch("w", "word")!;
    const late = fuzzyMatch("w", "longword")!;
    expect(early.score).toBeGreaterThan(late.score);
  });

  it("查询中的空格按分词忽略", () => {
    expect(fuzzyMatch("导出 word", "导出 Word")?.positions).toEqual([0, 1, 3, 4, 5, 6]);
  });

  it("中文按字符子序列匹配", () => {
    expect(fuzzyMatch("导出", "导出 Word")?.positions).toEqual([0, 1]);
    expect(fuzzyMatch("出w", "导出 Word")).not.toBeNull();
  });
});

describe("fuzzyRank", () => {
  const items = ["导出 Word", "导出 PDF", "导入 Word", "导出 HTML"];

  it("空查询返回全部且保持原序", () => {
    expect(fuzzyRank("", items, (s) => s)).toEqual(items);
  });

  it("过滤掉不含查询子序列的项", () => {
    expect(fuzzyRank("导出 pdf", items, (s) => s)).toEqual(["导出 PDF"]);
    expect(fuzzyRank("导出", items, (s) => s)).toEqual(["导出 Word", "导出 PDF", "导出 HTML"]);
  });

  it("命中位置越靠前排名越前", () => {
    const list = ["从文档导出 Word", "导出 Word"];
    expect(fuzzyRank("导出", list, (s) => s)).toEqual(["导出 Word", "从文档导出 Word"]);
  });

  it("同分时保持传入顺序", () => {
    const same = ["a1", "a2", "a3"];
    expect(fuzzyRank("a", same, (s) => s)).toEqual(same);
  });

  it("支持按对象字段取文本", () => {
    const entries = [{ label: "加粗" }, { label: "斜体" }];
    expect(fuzzyRank("加", entries, (e) => e.label)).toEqual([{ label: "加粗" }]);
  });
});