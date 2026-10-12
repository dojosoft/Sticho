import { describe, expect, it } from "vitest";

import { classifyImageSrc, decodeDataUri, resolveLocalImagePath } from "./imageSrc";

describe("classifyImageSrc", () => {
  it("识别 data URI", () => {
    expect(classifyImageSrc("data:image/png;base64,aGVsbG8=")).toBe("data");
    expect(classifyImageSrc("DATA:image/svg+xml,%3Csvg%2F%3E")).toBe("data");
  });

  it("识别远端地址（含协议相对）", () => {
    expect(classifyImageSrc("https://example.com/a.png")).toBe("remote");
    expect(classifyImageSrc("http://example.com/a.png")).toBe("remote");
    expect(classifyImageSrc("//cdn.example.com/a.png")).toBe("remote");
  });

  it("识别本地绝对路径", () => {
    expect(classifyImageSrc("C:\\docs\\a.png")).toBe("absolute");
    expect(classifyImageSrc("C:/docs/a.png")).toBe("absolute");
    expect(classifyImageSrc("\\\\srv\\share\\a.png")).toBe("absolute");
    expect(classifyImageSrc("file:///C:/docs/a.png")).toBe("absolute");
  });

  it("其余非空值一律当作相对路径", () => {
    expect(classifyImageSrc("a.png")).toBe("relative");
    expect(classifyImageSrc("./assets/a.png")).toBe("relative");
    expect(classifyImageSrc("../assets/a.png")).toBe("relative");
    expect(classifyImageSrc("/images/a.png")).toBe("relative");
  });

  it("空值与空白视为无效", () => {
    expect(classifyImageSrc("")).toBe("invalid");
    expect(classifyImageSrc("   ")).toBe("invalid");
    expect(classifyImageSrc(null)).toBe("invalid");
    expect(classifyImageSrc(undefined)).toBe("invalid");
  });
});

describe("resolveLocalImagePath", () => {
  it("相对路径挂到文档目录下", () => {
    expect(resolveLocalImagePath("assets/a.png", "C:\\docs")).toBe("C:\\docs\\assets\\a.png");
    expect(resolveLocalImagePath("./a.png", "C:\\docs\\")).toBe("C:\\docs\\a.png");
  });

  it("前导斜杠按相对当前文档目录处理", () => {
    expect(resolveLocalImagePath("/images/a.png", "C:\\docs")).toBe(
      "C:\\docs\\images\\a.png",
    );
  });

  it("绝对路径原样归一化，不依赖文档目录", () => {
    expect(resolveLocalImagePath("C:/docs/a.png", null)).toBe("C:\\docs\\a.png");
    expect(resolveLocalImagePath("file:///C:/docs/a.png", null)).toBe("C:\\docs\\a.png");
    expect(resolveLocalImagePath("\\\\srv\\share\\a.png", null)).toBe("\\\\srv\\share\\a.png");
  });

  it("没有文档目录时相对路径无法解析", () => {
    expect(resolveLocalImagePath("assets/a.png", null)).toBeNull();
  });

  it("data URI 与远端地址不产生本地路径", () => {
    expect(resolveLocalImagePath("data:image/png;base64,aGVsbG8=", "C:\\docs")).toBeNull();
    expect(resolveLocalImagePath("https://example.com/a.png", "C:\\docs")).toBeNull();
  });
});

describe("decodeDataUri", () => {
  it("解码 base64 负载", () => {
    const decoded = decodeDataUri("data:image/png;base64,aGVsbG8=");
    expect(decoded?.mime).toBe("image/png");
    expect(new TextDecoder().decode(decoded!.bytes)).toBe("hello");
  });

  it("解码 URL 编码负载（SVG 常见写法）", () => {
    const decoded = decodeDataUri("data:image/svg+xml,%3Csvg%2F%3E");
    expect(decoded?.mime).toBe("image/svg+xml");
    expect(new TextDecoder().decode(decoded!.bytes)).toBe("<svg/>");
  });

  it("base64 负载里的换行可被容忍", () => {
    expect(new TextDecoder().decode(decodeDataUri("data:image/png;base64,aGVs\nbG8=")!.bytes)).toBe(
      "hello",
    );
  });

  it("非 data URI 或非法 base64 返回 null", () => {
    expect(decodeDataUri("https://example.com/a.png")).toBeNull();
    expect(decodeDataUri("data:image/png;base64,@@@")).toBeNull();
  });
});