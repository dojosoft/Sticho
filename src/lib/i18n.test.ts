import { describe, expect, it } from "vitest";

import { makeT } from "./i18n";

describe("makeT", () => {
  it("中文下原样返回键（中文原文即键）", () => {
    const t = makeT("zh-CN");
    expect(t("文件")).toBe("文件");
    expect(t("这个词没收录")).toBe("这个词没收录");
  });

  it("英文下查词表，未收录时回落中文而不是空白", () => {
    const t = makeT("en-US");
    expect(t("文件")).toBe("File");
    expect(t("这个词没收录")).toBe("这个词没收录");
  });

  it("占位符插值，缺失的变量原样保留", () => {
    const t = makeT("zh-CN");
    expect(t("共 {n} 个", { n: 3 })).toBe("共 3 个");
    expect(t("值 {a} 与 {b}", { a: "x" })).toBe("值 x 与 {b}");
  });

  it("英文词表同样支持插值", () => {
    const t = makeT("en-US");
    expect(t("版本 {n}", { n: 2 })).toBe("Version 2");
  });
});