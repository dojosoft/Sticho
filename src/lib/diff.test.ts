import { describe, expect, it } from "vitest";

import { diffLines, diffStats, splitLines } from "./diff";

describe("splitLines", () => {
  it("空文本没有行", () => {
    expect(splitLines("")).toEqual([]);
  });

  it("末尾换行不额外产生空行", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });

  it("CRLF 与 CR 都按 LF 切分", () => {
    expect(splitLines("a\r\nb\rc")).toEqual(["a", "b", "c"]);
  });

  it("只有换行时是一行空行", () => {
    expect(splitLines("\n")).toEqual([""]);
  });
});

describe("diffLines", () => {
  it("完全相同：全部 equal 且行号一一对应", () => {
    const lines = diffLines("a\nb", "a\nb");
    expect(lines.map((l) => l.type)).toEqual(["equal", "equal"]);
    expect(lines[1]).toMatchObject({ oldLine: 2, newLine: 2, text: "b" });
    expect(diffStats(lines)).toEqual({ added: 0, removed: 0, unchanged: 2 });
  });

  it("删除中间一行：只标出该行，两侧仍为 equal", () => {
    const lines = diffLines("a\nb\nc", "a\nc");
    expect(lines.map((l) => l.type)).toEqual(["equal", "del", "equal"]);
    expect(lines[1]).toMatchObject({ text: "b", oldLine: 2, newLine: undefined });
    expect(lines[2]).toMatchObject({ text: "c", oldLine: 3, newLine: 2 });
  });

  it("中间插入一行", () => {
    const lines = diffLines("a\nc", "a\nb\nc");
    expect(lines.map((l) => l.type)).toEqual(["equal", "add", "equal"]);
    expect(lines[1]).toMatchObject({ text: "b", oldLine: undefined, newLine: 2 });
  });

  it("替换一行：删除行紧接新增行之前", () => {
    const lines = diffLines("a\nb\nc", "a\nB\nc");
    expect(lines.map((l) => l.type)).toEqual(["equal", "del", "add", "equal"]);
    expect(diffStats(lines)).toEqual({ added: 1, removed: 1, unchanged: 2 });
  });

  it("换行符差异不算改动", () => {
    expect(diffStats(diffLines("a\r\nb\r\n", "a\nb\n"))).toEqual({
      added: 0,
      removed: 0,
      unchanged: 2,
    });
  });

  it("空文本与有内容文本对比", () => {
    expect(diffStats(diffLines("", "a\nb"))).toEqual({ added: 2, removed: 0, unchanged: 0 });
    expect(diffStats(diffLines("a\nb", ""))).toEqual({ added: 0, removed: 2, unchanged: 0 });
  });

  it("长文档只改一行时仍精确到行（公共前后缀被剪掉）", () => {
    const oldText = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n");
    const newText = oldText.replace("line 2500", "line 2500 changed");
    const stats = diffStats(diffLines(oldText, newText));
    expect(stats).toEqual({ added: 1, removed: 1, unchanged: 4999 });
  });

  it("超出预算的超长文档走分块降级，结果仍完整", () => {
    const oldText = Array.from({ length: 2200 }, (_, i) => `old ${i}`).join("\n");
    const newText = Array.from({ length: 2200 }, (_, i) => `new ${i}`).join("\n");
    const lines = diffLines(oldText, newText);
    expect(diffStats(lines)).toEqual({ added: 2200, removed: 2200, unchanged: 0 });
    expect(lines).toHaveLength(4400);
  });
});