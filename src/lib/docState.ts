/**
 * 多标签页的纯状态定义（批次六）
 *
 * 设计取舍——「快照 + 投影」：
 * 顶层那些 $state（currentPath / dirty / docKind / htmlSource / encoding …）仍是 UI 的唯一真源，
 * 编辑器也只保留一个 Vditor 实例。标签数组只在「切换 / 关闭 / 落草稿」这几个时机被搬运：
 *   captureActiveTab() 把活跃标签的内容与状态从全局写回快照；
 *   activateTab()      把某个标签的快照投影回全局。
 * 于是标签栏要显示的名字与未保存圆点在活跃项上直接读全局、其余读快照，
 * 省掉了维护两套状态并随时同步的成本（代价是切换标签要序列化一次正文）。
 */

/** 文档内核：markdown = Vditor；html = 沙箱 iframe / textarea；code = CodeMirror */
export type DocKind = "markdown" | "html" | "code";
export type HtmlView = "preview" | "source";

/** 行尾风格：`\r\n` = Windows CRLF，`\n` = LF */
export type Eol = "\r\n" | "\n";

/**
 * 从正文探测行尾风格：出现 CRLF 即按 CRLF 处理（Windows 惯例），否则 LF。
 *
 * 为什么必须记住它：Markdown 走 Vditor，取值由 DOM 反推、行尾恒为 LF，
 * 若不还原，打开一份 CRLF 的 .md 一保存就会把整份文件的行尾悄悄改成 LF。
 */
export function detectEol(text: string): Eol {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** 把正文里的行尾统一成指定风格（幂等：已是该风格时原样返回） */
export function applyEol(text: string, eol: Eol): string {
  return text.replace(/\r\n|\r|\n/g, eol);
}

/** 一个标签页的快照 */
export type DocTab = {
  /** 运行时唯一 id：标签栏的 key，也是草稿 id 的来源 */
  id: number;
  /** 恢复草稿 id（`d-<id>`）。一个标签一份草稿，与文件路径无关：
   *  同一文件在两个标签里各改各的时，两份草稿不会互相覆盖 */
  draftId: string;
  kind: DocKind;
  /** 已保存到的路径；null = 尚未落盘的新文档 */
  path: string | null;
  /** 绑定的云端（WebDAV）远端路径；非 null 时保存会就地回写云端而非本地文件 */
  remote: string | null;
  /** 保存时按此编码写回 */
  encoding: string;
  /** 文档原有的行尾风格（保存时按它还原，避免 Markdown 被 Vditor 规整成 LF） */
  eol: Eol;
  dirty: boolean;
  /** Markdown 文档：正文快照；HTML 文档：HTML 源码快照 */
  content: string;
  /** content 是否有效。会话恢复出来的标签只带元信息，正文在第一次被激活时才读盘 */
  loaded: boolean;
  /** HTML 文档：预览 / 源码视图，切回来要还原。
   *  预览是否可编辑不在这里——它由全局的「阅读 / 编辑模式」派生（见 App.svelte 的 previewEditable） */
  htmlView: HtmlView;
  /** HTML 文档：预览 DOM 是否已被改动（尚未落回 content） */
  previewMutated: boolean;
  /** 上次落草稿时的内容指纹（全量 FNV-1a 32 位 + 长度，见 autoSave.ts 的 recoveryFingerprint）：
   *  内容没变就不重复写盘 */
  draftHash: string;
  /** 本标签的书签快照（不写入文档、不持久化到会话）：代码/纯文本按行首字符偏移；
   *  Markdown 按块锚点（text + 同文本序号 occ + 源码偏移 offset） */
  bookmarks: {
    /** 代码 / 纯文本：书签所在行的行首字符偏移 */
    code: number[];
    /** Markdown：块锚点（见 editor.ts 的 MdBookmarkAnchor） */
    md: { text: string; occ: number; offset: number }[];
  };
};

/** 会话里记录的单个标签（只有元信息，正文在各自的恢复草稿里） */
export type SessionTab = {
  kind: DocKind;
  path: string | null;
  /** 云端文档的远端路径；恢复后按它重新下载正文 */
  remote?: string | null;
  encoding: string;
  /** 行尾风格（可选，老会话文件里没有该字段时按 LF 处理） */
  eol?: Eol;
  dirty: boolean;
  htmlView: HtmlView;
  draftId: string;
};

/** 上次退出时的标签集（存于 plugin-store 的 "session" 键） */
export type SessionState = { tabs: SessionTab[]; active: number };

/** 新建一个空白标签（默认 Markdown 未命名文档） */
export function newDocTab(id: number, content: string): DocTab {
  return {
    id,
    draftId: `d-${id}`,
    kind: "markdown",
    path: null,
    remote: null,
    encoding: "utf-8",
    eol: "\n",
    dirty: false,
    content,
    loaded: true,
    htmlView: "preview",
    previewMutated: false,
    draftHash: "",
    bookmarks: { code: [], md: [] },
  };
}

/**
 * 会话恢复出来的标签是否应当补回欢迎正文。
 *
 * 「欢迎文档」不是独立文件，而是**新建标签的初始正文**（见 App.svelte 的 createTab →
 * `newDocTab(…, welcomeText())`）：它没有路径、不会被保存，只要用户没动过就不会变 dirty，
 * 因此恢复草稿里从来没有它。而会话恢复只带元信息、正文一律从草稿取——不把这份正文补回去，
 * 恢复出来的标签就是空正文，用户看到「打开后文档是空白」。
 *
 * 只认「干净 + 没有路径 + 没有云端绑定」：dirty 标签的正文在草稿里，草稿万一读失败
 * 宁可留空，也不能用欢迎文案把「未知内容」顶掉。
 */
export function restoredTabNeedsWelcome(item: SessionTab, remote: string | null): boolean {
  return !item.dirty && item.path === null && remote === null;
}

/** 生成会话快照（不含正文：正文分别落在恢复草稿里） */
export function sessionOf(tabs: DocTab[], active: number): SessionState {
  return {
    tabs: tabs.map((tab) => ({
      kind: tab.kind,
      path: tab.path,
      remote: tab.remote,
      encoding: tab.encoding,
      eol: tab.eol,
      dirty: tab.dirty,
      htmlView: tab.htmlView,
      draftId: tab.draftId,
    })),
    active: Math.max(0, Math.min(active, tabs.length - 1)),
  };
}