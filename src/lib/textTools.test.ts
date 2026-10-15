import { describe, expect, it } from "vitest";
import {
  cjkLatinAddSpace,
  cjkLatinRemoveSpace,
  collapseInnerSpaces,
  removeBlankLines,
  removeTrailingSpaces,
} from "./textTools";

describe("textTools", () => {
  describe("removeBlankLines", () => {
    it("删掉空行与只含空白的行", () => {
      expect(removeBlankLines("a\n\n \t \nb\nc")).toBe("a\nb\nc");
    });

    it("保留 CRLF 与末尾换行", () => {
      expect(removeBlankLines("a\r\n\r\nb\r\n")).toBe("a\r\nb\r\n");
    });
  });

  describe("removeTrailingSpaces", () => {
    it("去掉行尾空格与制表符，行首缩进不动", () => {
      expect(removeTrailingSpaces("  a  \n\tb\t\n")).toBe("  a\n\tb\n");
    });
  });

  describe("collapseInnerSpaces", () => {
    it("压掉行内多余空白", () => {
      expect(collapseInnerSpaces("a   b\t\tc")).toBe("a b c");
    });

    it("保留行首缩进", () => {
      expect(collapseInnerSpaces("    a   b")).toBe("    a b");
    });
  });

  describe("cjkLatinAddSpace", () => {
    it("汉字与字母 / 数字相邻时补空格", () => {
      expect(cjkLatinAddSpace("中文ABC123测试")).toBe("中文 ABC123 测试");
    });

    it("已有空格的边界不重复补，标点不受影响", () => {
      expect(cjkLatinAddSpace("中文 ABC，标点")).toBe("中文 ABC，标点");
    });
  });

  describe("cjkLatinRemoveSpace", () => {
    it("删掉汉字与字母 / 数字之间的空格", () => {
      expect(cjkLatinRemoveSpace("中文 ABC 测试")).toBe("中文ABC测试");
    });

    it("字母数字之间的空格保留（不在中英边界上）", () => {
      expect(cjkLatinRemoveSpace("ABC 123")).toBe("ABC 123");
    });

    it("汉字之间的空格保留（可能是刻意的排版）", () => {
      expect(cjkLatinRemoveSpace("中 文")).toBe("中 文");
    });

    it("不跨行合并", () => {
      expect(cjkLatinRemoveSpace("中文\nABC")).toBe("中文\nABC");
    });
  });
});
