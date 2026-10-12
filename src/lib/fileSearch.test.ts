import { describe, expect, it } from "vitest";

import { groupSearchHits, highlightSegments, highlightRegexSegments, literalAnchor, type SearchHit } from "./fileSearch";

const hit = (path: string, line: number): SearchHit => ({
  path,
  line,
  column: 0,
  text: `第 ${line} 行`,
});

describe("groupSearchHits", () => {
  it("按文件分组且保留首次出现顺序", () => {
    const groups = groupSearchHits([
      hit("b.md", 1),
      hit("a.md", 2),
      hit("b.md", 5),
    ]);
    expect(groups.map((g) => g.path)).toEqual(["b.md", "a.md"]);
    expect(groups[0]!.hits.map((h) => h.line)).toEqual([1, 5]);
    expect(groups[0]!.truncated).toBe(false);
  });

  it("超过每文件上限时截断并标记", () => {
    const groups = groupSearchHits(
      [hit("a.md", 1), hit("a.md", 2), hit("a.md", 3), hit("b.md", 9)],
      2,
    );
    expect(groups[0]!.hits).toHaveLength(2);
    expect(groups[0]!.truncated).toBe(true);
    expect(groups[1]!.hits).toHaveLength(1);
    expect(groups[1]!.truncated).toBe(false);
  });

  it("无命中返回空数组", () => {
    expect(groupSearchHits([])).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("空查询返回原样一段", () => {
    expect(highlightSegments("导出 Word", "")).toEqual([{ text: "导出 Word", hit: false }]);
  });

  it("无命中返回原样一段", () => {
    expect(highlightSegments("导出 Word", "pdf")).toEqual([{ text: "导出 Word", hit: false }]);
  });

  it("大小写不敏感地切出高亮片段", () => {
    expect(highlightSegments("导出 word 与 Word", "word")).toEqual([
      { text: "导出 ", hit: false },
      { text: "word", hit: true },
      { text: " 与 ", hit: false },
      { text: "Word", hit: true },
    ]);
  });

  it("区分大小写时只命中完全一致的部分", () => {
    expect(highlightSegments("Word word", "Word", true)).toEqual([
      { text: "Word", hit: true },
      { text: " word", hit: false },
    ]);
  });

  it("同一行多次命中且相邻命中不产生空片段", () => {
    expect(highlightSegments("aaaa", "aa")).toEqual([
      { text: "aa", hit: true },
      { text: "aa", hit: true },
    ]);
  });
});

describe("literalAnchor", () => {
  it("取最长的一段字面量", () => {
    expect(literalAnchor("foo\\d+")).toBe("foo");
    expect(literalAnchor("https?://")).toBe("https");
    expect(literalAnchor("[a-z]+@example\\.com")).toBe("@example.com");
  });

  it("转义的元字符算字面量，转义的字母不算", () => {
    expect(literalAnchor("a\\.b")).toBe("a.b");
    expect(literalAnchor("\\w+")).toBe("");
  });

  it("字符类内部不作锚点（择一，取不到必然出现的字面量）", () => {
    expect(literalAnchor("[abc]+")).toBe("");
    expect(literalAnchor("x[0-9]y")).toBe("x");
  });

  it("抽不出字面量时返回空串", () => {
    expect(literalAnchor("^\\s*$")).toBe("");
    expect(literalAnchor("\\d{4}")).toBe("4");
  });
});

describe("highlightRegexSegments", () => {
  it("按正则切出高亮片段", () => {
    expect(highlightRegexSegments("编号 2026-10 与 2027-01", "\\d{4}-\\d{2}")).toEqual([
      { text: "编号 ", hit: false },
      { text: "2026-10", hit: true },
      { text: " 与 ", hit: false },
      { text: "2027-01", hit: true },
    ]);
  });

  it("语法有误时整行不高亮", () => {
    expect(highlightRegexSegments("abc", "(")).toEqual([{ text: "abc", hit: false }]);
  });

  it("空匹配不会死循环", () => {
    expect(highlightRegexSegments("ab", "x*")).toEqual([{ text: "ab", hit: false }]);
  });

  it("区分大小写开关生效", () => {
    expect(highlightRegexSegments("Word word", "word", true)).toEqual([
      { text: "Word ", hit: false },
      { text: "word", hit: true },
    ]);
  });
});