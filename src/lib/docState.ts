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
  /** 保存时按此编码写回 */
  encoding: string;
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
  /** 上次落草稿时的内容指纹（长度 + 前 64 字符）：内容没变就不重复写盘 */
  draftHash: string;
};

/** 会话里记录的单个标签（只有元信息，正文在各自的恢复草稿里） */
export type SessionTab = {
  kind: DocKind;
  path: string | null;
  encoding: string;
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
    encoding: "utf-8",
    dirty: false,
    content,
    loaded: true,
    htmlView: "preview",
    previewMutated: false,
    draftHash: "",
  };
}

/** 生成会话快照（不含正文：正文分别落在恢复草稿里） */
export function sessionOf(tabs: DocTab[], active: number): SessionState {
  return {
    tabs: tabs.map((tab) => ({
      kind: tab.kind,
      path: tab.path,
      encoding: tab.encoding,
      dirty: tab.dirty,
      htmlView: tab.htmlView,
      draftId: tab.draftId,
    })),
    active: Math.max(0, Math.min(active, tabs.length - 1)),
  };
}