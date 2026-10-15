import { describe, expect, it } from "vitest";

import { ZH, makeT } from "./i18n";

describe("makeT", () => {
  it("中文下查 ZH 词表，未收录时回落英文原文", () => {
    const t = makeT("zh-CN");
    expect(t("File")).toBe("文件");
    expect(t("This string is not in the table")).toBe("This string is not in the table");
  });

  it("英文下原样返回英文原文（英文原文即键）", () => {
    const t = makeT("en-US");
    expect(t("File")).toBe("File");
    expect(t("This string is not in the table")).toBe("This string is not in the table");
  });

  it("占位符插值，缺失的变量原样保留", () => {
    const t = makeT("zh-CN");
    expect(t("{n} document(s) have unsaved changes. Save before restarting?", { n: 3 })).toBe(
      "有 3 个文档尚未保存，是否保存后再重启？",
    );
    expect(t("Version {n}", {})).toBe("版本 {n}");
  });

  it("英文词表同样支持插值", () => {
    const t = makeT("en-US");
    expect(t("Version {n}", { n: 2 })).toBe("Version 2");
  });
});

describe("ZH 词表", () => {
  it("中文值都不为空串（缺失应回落英文原文，而不是变成空白）", () => {
    const blank = Object.entries(ZH).filter(([, value]) => value.trim() === "");
    expect(blank).toEqual([]);
  });

  it("中文值与键不是同一串（同串等于没翻译，会静默漏掉）", () => {
    const same = Object.entries(ZH).filter(([key, value]) => key === value);
    expect(same).toEqual([]);
  });
});