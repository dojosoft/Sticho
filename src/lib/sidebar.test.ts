import { describe, expect, it } from "vitest";

import { htmlPlainText, parseFrontMatter, parseOutline } from "./sidebar";

describe("htmlPlainText", () => {
  it("剔除 script/style、还原实体并压缩空白", () => {
    const html =
      "<style>p{color:red}</style><p>Hello &amp; <b>world</b></p><script>x()</script>";
    expect(htmlPlainText(html)).toBe("Hello & world");
  });

  it("空输入返回空串", () => {
    expect(htmlPlainText("")).toBe("");
  });
});

describe("parseFrontMatter", () => {
  it("没有 front matter 时返回空数组", () => {
    expect(parseFrontMatter("# 标题\n\n正文")).toEqual([]);
  });

  it("解析扁平字段与流式数组", () => {
    const md = "---\ntitle: Hello\ntags: [a, b]\n---\n\n正文";
    expect(parseFrontMatter(md)).toEqual([
      ["title", "Hello"],
      ["tags", "a, b"],
    ]);
  });

  it("支持写在下一行的列表（tags 常见写法）", () => {
    const md = "---\ntags:\n  - a\n  - b\n---\n";
    expect(parseFrontMatter(md)).toEqual([["tags", "a, b"]]);
  });
});

describe("parseOutline", () => {
  it("识别 ATX 标题，并跳过围栏代码块里的井号", () => {
    const md = "# 一\n\n```\n# 代码里的井号\n```\n\n## 二\n";
    expect(parseOutline(md).map((i) => i.text)).toEqual(["一", "二"]);
  });

  it("跳过 front matter，不把 title 误判成标题", () => {
    const md = "---\ntitle: x\n---\n\n# 正文标题\n";
    expect(parseOutline(md).map((i) => i.text)).toEqual(["正文标题"]);
  });
});