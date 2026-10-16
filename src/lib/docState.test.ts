import { describe, expect, it } from "vitest";

import { restoredTabNeedsWelcome, type SessionTab } from "./docState";

/** 会话里的一条标签元信息（正文不在这里，正文只存在于恢复草稿） */
const tab = (patch: Partial<SessionTab> = {}): SessionTab => ({
  kind: "markdown",
  path: null,
  remote: null,
  encoding: "utf-8",
  eol: "\n",
  dirty: false,
  htmlView: "preview",
  draftId: "d-1",
  ...patch,
});

describe("restoredTabNeedsWelcome", () => {
  it("干净、未命名、无云端绑定的标签要补回欢迎正文", () => {
    // 「欢迎文档」就是这种标签：没有路径可以读盘、也没有草稿可以回放，
    // 不补回欢迎正文的话，恢复出来就是空正文（实测：关掉再打开，文档是空白）
    expect(restoredTabNeedsWelcome(tab({ welcome: true }), null)).toBe(true);
  });

  it("老会话没有 welcome 字段时沿用旧判据（否则升级后第一次恢复会少一份正文）", () => {
    expect(restoredTabNeedsWelcome(tab(), null)).toBe(true);
  });

  it("用户新建的空白标签不要补（否则空白文档会凭空长出欢迎正文）", () => {
    // 文件 → 新建标签 → 新建纯文本 / 新建 Markdown 造出来的标签同样「干净 + 未命名 + 无云端绑定」，
    // 只凭那三条判定就会把用户刚新建的空白文档恢复成一份欢迎正文
    expect(restoredTabNeedsWelcome(tab({ welcome: false }), null)).toBe(false);
  });

  it("有未保存改动的标签不要补（正文在草稿里，草稿读失败也宁可留空）", () => {
    // 用欢迎文案顶掉「读失败的未知内容」是更糟的结果：用户会以为自己的改动没了、又被塞了别的内容
    expect(restoredTabNeedsWelcome(tab({ dirty: true }), null)).toBe(false);
  });

  it("有本地路径或云端绑定的标签不要补（正文从磁盘 / 云端取回）", () => {
    expect(restoredTabNeedsWelcome(tab({ path: "D:\\notes\\a.md" }), null)).toBe(false);
    expect(restoredTabNeedsWelcome(tab(), "/dav/a.md")).toBe(false);
  });
});
