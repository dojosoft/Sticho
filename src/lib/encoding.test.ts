import { describe, expect, it } from "vitest";

import { ENCODINGS, encodingLabel } from "./encoding";

describe("encodingLabel", () => {
  it("已知 id 返回界面显示名", () => {
    expect(encodingLabel("utf-8")).toBe("UTF-8");
    expect(encodingLabel("gb18030")).toContain("GB18030");
  });

  it("表外 id 原样返回（显示 encoding_rs 规范名，便于用户判断）", () => {
    expect(encodingLabel("windows-1251")).toBe("windows-1251");
    expect(encodingLabel("no-such-encoding")).toBe("no-such-encoding");
  });

  it("编码 id 不重复（菜单里不会出现两项指向同一编码）", () => {
    const ids = ENCODINGS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});