<script lang="ts">
  import { onMount, tick } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { open as openDialog, save as saveDialog, confirm as confirmDialog, message as messageDialog } from "@tauri-apps/plugin-dialog";
  import { readText as readClipboardText, writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
  import {
    initEditor,
    getEditorValue,
    setEditorValue,
    onEditorChange,
    setEditorTheme,
    getEditorContentElement,
    getEditorSelection,
    deleteEditorSelection,
    replaceEditorSelection,
    insertEditorText,
    getEditorMode,
    setEditorMode,
    onEditorModeChange,
    applyFormat,
    applyHeading,
    clearHeading,
    insertLocalImage,
    insertMathBlock,
    insertMermaidBlock,
    alignTableColumn,
    undoEditor,
    redoEditor,
    toggleEditorFullscreen,
    isEditorFullscreen,
    setEditorToolbarVisible,
    setLineNumbersVisible,
    setTypewriterMode,
    setParagraphFocusVisible,
    setEditorLocale,
    setDocumentPath,
    setEditorReadonly,
    setReaderStyle,
    isLargeDocMode,
    leaveLargeMode,
    onLargeModeChange,
    onLargeRenderChange,
    getLargeSourceText,
    getLargeMountedSections,
    revealLargeSourceOffset,
    scrollLargeRangeIntoView,
    scrollToHeading,
    whenEditorReady,
    type ReaderStyle,
  } from "./lib/editor";
  import {
    readTextFile,
    writeTextFile,
    getStartupFile,
    getFileAssociation,
    setFileAssociation,
    fileAssocInfo,
    getContextMenu,
    setContextMenu,
    openDefaultAppsSettings,
    writeRecovery,
    listRecovery,
    readRecovery,
    deleteRecovery,
    exportPandoc,
    loadThemes,
    openThemeDir,
    webdavTest,
    webdavUpload,
    saveDavPassword,
    loadDavPassword,
    getDataLocation,
    getDataRoot,
    checkDataLocation,
    setDataLocation,
    restartApp,
    openUrl,
    listHistory,
    readHistory,
    restoreHistory,
    searchFiles,
    logEvent,
    exportDiagnostics,
    type DataLocationMode,
    type DavConfig,
    type ThemeFile,
    type AssocExt,
    type HistoryEntry,
  } from "./lib/tauri-api";
  import {
    mountCodeEditor,
    unmountCodeEditor,
    setCodeValue,
    getCodeValue,
    setCodeReadonly,
    setCodeTheme,
    setCodeLineNumbers,
    setCodeTypewriter,
    setCodeParagraphFocus,
    setCodeReaderStyle,
    focusCodeEditor,
    setCodeFind,
    getCodeMatches,
    gotoCodeMatch,
    replaceCodeMatches,
    clearCodeFind,
    getCodeSelection,
    replaceCodeSelection,
    type CodeFindOptions,
    type CodeReaderStyle,
  } from "./lib/codeEditor";
  import {
    CODE_EXTS_SORTED,
    CODE_LARGE_BYTES,
    LANG_LIST,
    PLAIN_TEXT_NAME,
    codeLangIdForExt,
    codeLangNameById,
    extOf,
    isCodePath,
  } from "./lib/codeLang";
  import {
    minifyCss,
    minifyJs,
    minifyJson,
    prettyCss,
    prettyJs,
    prettyJson,
    type ToolResult,
  } from "./lib/codeTools";
  import { ENCODINGS, encodingLabel } from "./lib/encoding";
  import { newDocTab, sessionOf, type DocTab, type SessionState } from "./lib/docState";
  import { parseOutline, parseOutlineFromHtml, parseFrontMatter, htmlPlainText, type OutlineItem, type SidebarView } from "./lib/sidebar";
  import Sidebar from "./components/Sidebar.svelte";
  import CodeTools from "./components/CodeTools.svelte";
  import CloudBrowser from "./components/CloudBrowser.svelte";
  import DiffView from "./components/DiffView.svelte";
  import RecoveryCenter from "./components/RecoveryCenter.svelte";
  import FindBar from "./components/FindBar.svelte";
  import StatusBar from "./components/StatusBar.svelte";
  import SettingsModal from "./components/SettingsModal.svelte";
  import CommandPalette, { type PaletteCommand } from "./components/CommandPalette.svelte";
  import WelcomeDialog from "./components/WelcomeDialog.svelte";
  import { groupSearchHits, literalAnchor, type SearchGroup, type SearchHit } from "./lib/fileSearch";
  // 导出 / 导入实现（export-pdf、export-html、export-txt、import-html、export-docx、
  // import-pdf）统一走调用点动态加载：它们拖着 markdown-it / turndown / docx /
  // pdfjs-dist 这类大依赖，却只在对应菜单动作时才用得上。
  import { loadSetting, loadAllSettings, saveSetting, deleteSetting } from "./lib/settings";
  import { diffLines, type DiffLine } from "./lib/diff";
  import { makeT, vditorLang, type Locale } from "./lib/i18n";
  import { invoke } from "@tauri-apps/api/core";

  /** 版本号：与 src-tauri/tauri.conf.json 的 version 保持一致 */
  const APP_VERSION = "0.1.0";

  // ---- 应用状态（Svelte 5 runes）----
  let currentPath = $state<string | null>(null); // null = 尚未保存过的新文档
  let dirty = $state(false);
  let busy = $state(false); // 文件操作进行中，防重复触发
  // 当前文档的本地历史版本（文件菜单展开时刷新，供「文件历史」动态子菜单消费）
  let historyEntries = $state<HistoryEntry[]>([]);
  // 版本差异视图（批次三）：null = 未打开
  let diffView = $state<{ title: string; leftLabel: string; rightLabel: string; lines: DiffLine[] } | null>(null);
  // 命令面板（批次四）：Ctrl+P 打开；commands 在每次打开时按当前菜单求值（动态子菜单要新鲜数据）
  let paletteOpen = $state(false);
  let paletteCommands = $state<PaletteCommand[]>([]);
  // 入门指南（批次四）：首次启动弹一次，帮助菜单可随时重开；welcomeShown 落设置
  let welcomeOpen = $state(false);
  // 跨文件搜索（批次四）：结果由应用层持有，侧边栏只负责输入与渲染
  let searchGroups = $state<SearchGroup[]>([]);
  let searchBusy = $state(false);
  let searchError = $state("");
  let searchFileCount = $state(0);
  let searchTruncated = $state(false);
  let searchQuery = $state(""); // 最近一次搜索的查询词与大小写设置，供「点击命中定位」复用
  let searchCaseSensitive = $state(false);
  let searchRegex = $state(false); // 最近一次搜索是否按正则解释（供定位时复用同一套匹配语义）
  let searchSeq = 0; // 搜索序号：丢弃过期请求的结果，避免快速输入时结果乱序
  let theme = $state<"light" | "dark">("light");
  let userThemeSet = $state(false); // 用户是否显式选过主题（否则跟随系统）
  let recentFiles = $state<string[]>([]);
  let wordCount = $state(0);
  let charCount = $state(0); // 状态栏实时统计：字符数（批次七）
  let lineCount = $state(0); // 状态栏实时统计：行数（批次七）
  let dragOver = $state(false); // 拖拽悬停高亮
  let showToolbar = $state(true); // 是否显示编辑器自带排版工具栏
  // 当前 Vditor 渲染模式（状态栏图标 / 视图菜单复选共用）。仅 Markdown 模式有意义，
  // 由 onEditorModeChange 持续同步（含工具栏下拉与菜单两条切换路径）。
  let editorMode = $state<"ir" | "wysiwyg" | "sv">("ir");
  let shortcutsOpen = $state(false); // 「快捷键一览」模态（帮助菜单）
  let tabsEl = $state<HTMLElement | null>(null); // 标签栏滚动容器（切标签时把活跃项滚进可视区）
  let showLineNumbers = $state(true); // 是否显示正文行号（默认显示）
  let typewriterOn = $state(false); // 打字机模式：光标行始终停在视口垂直中线
  let paragraphFocus = $state(false); // 段落聚焦：只亮当前编辑块，其余内容压暗
  // 大文档（Markdown）分节阅读通路是否激活：那套正文由整篇源码分节拼出，等同纯源码视图，
  // 仍给行号（见 lineNumbersSupported）。
  let largeReading = $state(false);

  // ---- 阅读排版（字体 / 字号 / 行距 / 文字色 / 护眼底色）----
  // 只作用于 Markdown / 纯文本这类「不含自带样式」的文档；HTML 文档走沙箱 iframe
  // 渲染与纯文本源码框，压根不经过编辑器正文，故天然不受影响。
  let readerStyle = $state<ReaderStyle>({});

  // ---- 自动保存与崩溃恢复（批次四）----
  let autoSaveEnabled = $state(true); // 持久化键 "autoSave"，默认开

  /**
   * 默认打开模式（本轮新增）：打开 / 新建 / 导入文档后先进阅读模式还是直接进编辑模式。
   * 只在「新文档落点」生效（见 resetToBrowseMode），不影响标签间切换时各自已有的模式。
   */
  let defaultOpenMode = $state<"read" | "edit">("read");

  // ---- WebDAV 云同步与多版本（批次九）----
  // 配置持久化在 settings.json（含明文密码）；davVerified 刻意不持久化：
  // 每次启动都要重新「测试连接」，避免配置早已失效却还在后台上传。
  let davUrl = $state("");
  let davUser = $state("");
  let davPass = $state("");
  let davRoot = $state("/Sticho");
  let davEnabled = $state(false); // 每次保存后自动上传
  let davVersioning = $state(false); // 保留历史版本
  let davKeep = $state(3); // 最多保留版本数 1–10
  let historyKeep = $state(20); // 本地版本历史保留份数（每份文档各自保持这么多）
  let davVerified = $state(false); // 本会话内「测试连接」已通过
  // 冲突处理策略：copy = 另存冲突副本（默认，绝不丢数据）/ overwrite = 直接覆盖
  let davConflictPolicy = $state<"copy" | "overwrite">("copy");
  // 同步索引：本地路径 → 上次上传后记录的远端状态，供「远端是否被别的设备改过」判定
  let davSyncIndex = $state<Record<string, { remote: string; size: number; modified: number }>>({});
  let davTesting = $state(false); // 测试连接进行中
  let davTip = $state(""); // 设置面板里那行结论 / 错误提示
  let davSyncState = $state<"idle" | "busy" | "error">("idle"); // 状态栏同步指示
  let davSyncTip = $state(""); // 状态栏指示的 tooltip（失败详情）
  let cloudOpen = $state(false); // 云端文件浏览模态
  // 恢复中心（文件菜单 →「恢复中心…」）：统一浏览恢复草稿与本地版本历史
  let recoveryOpen = $state(false);

  /** 配置齐了且本会话验证过，才允许开启同步 / 浏览云端 */
  const davReady = $derived(davUrl.trim() !== "" && davVerified);
  /** 传给 Rust 的连接参数 */
  const davConfig = $derived<DavConfig>({
    url: davUrl.trim(),
    user: davUser,
    password: davPass,
    root: davRoot.trim() || "/Sticho",
  });

  // ---- 配置文件保存位置（批次十）----
  // 「系统目录」= %APPDATA%\Sticho（默认）；「当前程序目录」= exe 同目录下的 Sticho\（绿色版）；
  // 「指定目录」= 用户自选目录下的 Sticho\。位置本身由 Rust 侧引导文件决定，这里只做展示与切换；
  // 切换后需重启才完全生效。
  let dataLocation = $state<DataLocationMode>("user");
  let dataRootPath = $state(""); // 当前数据根目录绝对路径（只读展示）
  let locationBusy = $state(false); // 切换 / 重启进行中
  let locationTip = $state(""); // 切换结果提示（成功为绿色，失败为错误文案）
  let locationTipOk = $state(false);

  // ---- 外部变更监测（批次七）----
  // 当前文档上一次与磁盘「对齐」时的修改时间。打开 / 保存 / 重载后刷新，
  // 5 秒轮询 get_file_info 比对，不一致即说明别的程序改了这份文件。
  let diskMtime: number | null = null;
  let externalChecking = false; // 轮询重入保护（文件较大时一次 invoke 可能超过 5s）

  // ---- HTML 文档模式（打开 .html 时进入）----
  // 打开 .html 不再转成 Markdown，而是保留原始源码：预览用沙箱 iframe 原样渲染，
  // 可在渲染结果上直接编辑（contentEditable），也可切到源码视图改 HTML，均写回原文件。
  let docKind = $state<"markdown" | "html" | "code">("markdown");
  let htmlSource = $state(""); // 权威源码：保存 / 导出 / 统计都以它为准
  let htmlView = $state<"preview" | "source">("preview");
  // 送给 iframe 的 srcdoc。刻意与 htmlSource 解耦：编辑期间 htmlSource 会被反复
  // 序列化刷新，若直接绑 srcdoc 会导致 iframe 重载、光标丢失。只在「需要重新渲染」时同步。
  let previewDoc = $state("");
  /**
   * 阅读模式（只读）。打开 / 新建 / 导入文档后一律回到阅读模式，正文与 HTML 源码都不可改；
   * 用户点状态栏按钮（或视图菜单 / Ctrl+E）切到编辑模式才放行。
   * 刻意不随标签切换重置：在已打开的多个文档之间来回看时，不该反复丢掉编辑态。
   */
  let browseMode = $state(true);
  /**
   * 预览是否执行文档内的 JavaScript。默认关闭。
   *
   * 沙箱在两种模式下是**互斥**的，这是安全底线：
   * - 关：`allow-same-origin` —— 脚本不跑，父窗口能读 contentDocument，直接编辑 / 查找替换 / 大纲定位可用
   * - 开：`allow-scripts`     —— 脚本会跑，但 iframe 降级为独立源（opaque origin），父窗口读不到文档，
   *                              上面的 DOM 类功能随之不可用
   * 两者绝不叠加：allow-scripts + allow-same-origin 等于沙箱失效，文档脚本将能反过来操作本应用窗口。
   */
  let htmlScripts = $state(false);
  // 预览 DOM 是否已被改动（直接编辑或预览内替换）。决定要不要序列化回 htmlSource：
  // 没改过就不序列化，避免「只是切个视图」把源码整体重排一遍。
  let previewMutated = false;
  // iframe 的重建键：重新打开同一份文件时，srcdoc 可能恰好等于旧值而被 Svelte 跳过更新，
  // 导致预览停留在上一次（可能未保存）的 DOM 上。换 key 强制重建，保证与文件一致。
  let previewKey = $state(0);
  let previewFrame: HTMLIFrameElement | null = $state(null);
  let sourceArea: HTMLTextAreaElement | null = $state(null);

  /**
   * 预览视图当前是否可「直接编辑」（iframe body 上的 contenteditable）。
   *
   * 由「阅读 / 编辑模式」派生，不再单独设开关：状态栏原先那个与模式切换并列的
   * 「直接编辑」按钮已移除，全局只剩一个编辑态开关（用户要求统一 UI）。
   * 源码视图不需要它——那里的 textarea 直接绑 browseMode 的 readonly。
   */
  const previewEditable = $derived(
    docKind === "html" && htmlView === "preview" && !browseMode && !htmlScripts,
  );

  // ---- HTML 源码视图的行号（批次 E）----
  // 源码视图用原生 textarea，行号由一层透明的「镜像叠层」绘制：叠层与 textarea 同字体、
  // 同宽度并逐行隐藏原文，软换行位置便完全一致，行号才能落在「逻辑行」上（压缩型 HTML
  // 的超长行会折成多行，按固定行高堆行号必然错位）。
  let htmlSourceWrap = $state<HTMLDivElement | null>(null);
  let htmlGutterEl = $state<HTMLDivElement | null>(null);

  /**
   * 「显示行号」在当前视图是否可用（批次 E）。
   *
   * 只在「正文本身就是源码行」的视图里给行号：纯文本（含语法高亮）、Markdown 分屏预览
   * （SV）、大文档分节阅读态、HTML 源码视图。Markdown 的实时渲染（IR）与所见即所得
   * （WYSIWYG）带隐藏排版字段，行号与源码行对不上、也没有实际意义；HTML 预览是沙箱
   * iframe，父窗口量不到里面的内容，同样给不了。
   */
  const lineNumbersSupported = $derived(
    docKind === "code" ||
      (docKind === "markdown" && (editorMode === "sv" || largeReading)) ||
      (docKind === "html" && htmlView === "source"),
  );

  /** HTML 源码视图的行号叠层是否应当出现（跟随总开关与当前视图） */
  const htmlGutterOn = $derived(
    docKind === "html" && htmlView === "source" && showLineNumbers && lineNumbersSupported,
  );

  /** 叠层逐行渲染用的源码行（仅在叠层可见时才拆分，避免编辑时白白 split 大文本） */
  const htmlSourceLines = $derived(htmlGutterOn ? htmlSource.split(/\r\n|\r|\n/) : []);

  /**
   * 量出 textarea 的正文内容宽度喂给叠层。
   *
   * 叠层要按同一宽度排版才能与 textarea 同步换行；宽度随窗口、侧栏开合、分栏而变化，
   * 故交给 ResizeObserver 跟住（见下方的 $effect）。textarea 的 clientWidth 已排除
   * 滚动条，减掉左右内边距即内容宽。
   */
  function syncHtmlGutterMetrics(): void {
    const ta = sourceArea;
    const wrap = htmlSourceWrap;
    if (!ta || !wrap) return;
    const cs = getComputedStyle(ta);
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padRight = parseFloat(cs.paddingRight) || 0;
    wrap.style.setProperty("--html-ln-pad", `${padLeft}px`);
    wrap.style.setProperty("--html-ln-w", `${Math.max(0, ta.clientWidth - padLeft - padRight)}px`);
  }

  /** textarea 滚动时把叠层拖到同一位置（行号只随纵向滚动走） */
  function onHtmlSourceScroll(): void {
    if (htmlGutterEl && sourceArea) htmlGutterEl.scrollTop = sourceArea.scrollTop;
  }

  // ---- 代码文件模式（打开 .py / .bat 等）：CodeMirror 覆盖层（见 lib/codeEditor.ts）----
  // 与 HTML 覆盖层同一范式：覆盖而不隐藏 Vditor，避免其布局失效。
  let codeHost = $state<HTMLDivElement | null>(null); // CM 的挂载容器，仅在 docKind === "code" 时存在
  let codeExt = $state(""); // 当前代码文件的扩展名（决定语言与缩进）
  let codeLangLabel = $state(PLAIN_TEXT_NAME); // 状态栏显示的语言名
  /**
   * 「视图 → 语法高亮语言」的手动覆盖，按文档路径记（切换标签回来时仍在）。
   *
   * 值语义：键不存在 = 跟随扩展名自动判定；`null` = 纯文本；字符串 = 指定语言 id。
   * 只服务代码文件——Markdown / HTML 文档模式的高亮跟文档格式绑定，不在这里管。
   */
  let codeLangOverrides = $state<Record<string, string | null>>({});
  let codeCursor = $state({ line: 1, column: 1 }); // 状态栏「行 / 列」
  let codeMatch = $state(0); // 选中词在全文中的出现次数（0 = 不显示）
  let codeToolsOpen = $state(false); // 代码小工具面板（格式 → 代码工具 → 小工具）
  /**
   * 超大代码文件（≥ CODE_LARGE_BYTES）的原文；非 null 即表示当前这份代码没挂 CodeMirror，
   * 而是走「只读分节纯文本」（复用大文档通路）。此时 `.code-view` 覆盖层不渲染，
   * 取正文、快照、保存一律读这个字段——CM 未挂载时 `getCodeValue()` 是空串。
   */
  let codeLargeText = $state<string | null>(null);

  // ---- 编码（阶段 11）：打开时自动检测，可在状态栏或「文件 → 编码」手动切换 ----
  let encoding = $state("utf-8"); // 当前文档编码 id，保存时按此写回
  let encodingOpen = $state(false); // 状态栏编码下拉是否展开
  let codeLangOpen = $state(false); // 状态栏「语法高亮方案」下拉是否展开

  // ---- 侧边栏（阶段 11）----
  let sidebarVisible = $state(true);
  let sidebarView = $state<SidebarView>("outline");
  /**
   * 侧边栏四个面板各自的开关（视图 → 侧边栏 里的勾选项，默认全开）。
   * 面板开关只决定「该面板是否作为可切换的视图存在」；同一时刻仍只显示一个面板
   * （sidebarView）。四个全关时侧边栏没有任何内容可显示，会自动收起。
   */
  let sidebarPanels = $state<Record<SidebarView, boolean>>({
    tree: true,
    outline: true,
    props: true,
    search: true,
  });
  let treeRoot = $state<string | null>(null); // 目录树根目录（跟随当前文档）
  let outlineMd = $state(""); // 用于生成大纲的 Markdown 快照（防抖更新）
  let outlineHtml = $state(""); // 用于生成大纲的 HTML 源码快照（防抖更新）
  const outline: OutlineItem[] = $derived(
    docKind === "html"
      ? parseOutlineFromHtml(outlineHtml)
      : docKind === "code"
        ? [] // 代码文件没有 Markdown 标题层级，侧栏显示「无大纲」提示
        : parseOutline(outlineMd),
  );
  let outlineTimer: number | undefined;
  let fileProps = $state<[string, string][]>([]);

  // ---- 文件关联状态（阶段 11：设置 → 文件关联）----
  // 以扩展名为键；扩展名清单由 Rust 侧提供（file_assoc_info），前后端不重复维护白名单。
  let assoc = $state<Record<string, boolean>>({});
  let assocExts = $state<AssocExt[]>([]); // 可关联的扩展名（按 group 分组展示）
  let notepadExts = $state<string[]>([]); // 「替代系统记事本」覆盖的扩展名
  let contextMenu = $state(false); // 是否已注册「用本软件打开」右键菜单项
  let assocBusy = $state(false); // 批量关联操作进行中（防止连点）

  /** 某分组的扩展名清单 */
  function assocOfGroup(group: string): AssocExt[] {
    return assocExts.filter((e) => e.group === group);
  }

  /**
   * 一组扩展名的关联统计：`all` / `some` 供全选框的勾选与半选态，`on` / `total` 供计数展示。
   * 在模板里调用（读取 `assoc`），因此会随关联状态自动刷新。
   */
  function assocStats(list: AssocExt[]): {
    all: boolean;
    some: boolean;
    on: number;
    total: number;
  } {
    const on = list.filter((e) => assoc[e.ext] === true).length;
    return {
      all: list.length > 0 && on === list.length,
      some: on > 0 && on < list.length,
      on,
      total: list.length,
    };
  }

  /** 顶部「全选所有」的状态 */
  const allAssoc = $derived(assocStats(assocExts));

  /** 「替代系统记事本」是否已生效（覆盖的扩展名全部关联到本程序） */
  const notepadAll = $derived(
    notepadExts.length > 0 && notepadExts.every((ext) => assoc[ext] === true),
  );

  // ---- 菜单栏状态 ----
  let menuOpen = $state<string | null>(null); // 展开的一级菜单 id
  let subOpen = $state<string | null>(null); // 展开的二级菜单标签

  // ---- 左上角图标按钮（阶段 12）：软件设置 / 皮肤设置 ----
  let settingsOpen = $state(false); // 软件设置面板
  // 当前标签：具体标签清单与文案由 SettingsModal 组件自带，这里只保留受控状态
  let settingsTab = $state<"general" | "assoc" | "cloud" | "storage">("general");
  let skinOpen = $state(false); // 皮肤设置面板
  let themeFiles = $state<ThemeFile[]>([]); // 自定义主题目录里的 .css（批次八）
  let userTheme = $state<string | null>(null); // 当前选用的自定义主题文件名

  // ---- 界面语言（批次八）----
  let locale = $state<Locale>("zh-CN");
  /** 翻译函数：以中文原文为键；locale 变化时重建，界面文案随之刷新 */
  const t = $derived(makeT(locale));

  // ---- 查找 / 替换状态 ----
  let findOpen = $state(false);
  let findText = $state("");
  let replaceText = $state("");
  let findStatus = $state("");
  let findIdx = -1; // 当前命中的序号（-1 = 尚未定位）
  // 三个匹配开关（批次五）：持久化键 findCase / findWord / findRegex，默认全关
  let findCase = $state(false);
  let findWord = $state(false);
  let findRegex = $state(false);

  const WELCOME = `# 欢迎使用 Sticho

开始输入，或从 **文件 → 打开** 载入 \`.md\` / \`.html\` 文件。

支持拖拽 md / html / docx / pdf 文件到窗口直接打开。
`;

  // ---- 多标签页（批次六）----
  // 顶层 $state 仍是活跃标签的唯一真源；tabs 只在切换 / 关闭 / 落草稿时被搬运（见 lib/docState.ts）。
  let tabSeq = 0;
  function createTab(): DocTab {
    tabSeq += 1;
    return newDocTab(tabSeq, WELCOME);
  }

  let tabs = $state<DocTab[]>([createTab()]);
  let activeIndex = $state(0);
  /** 编辑器就绪前不要去读 getEditorValue（会抛错），标签搬运整体延后到 whenEditorReady 之后 */
  let tabsReady = false;
  /** 上次写入的会话 JSON：内容没变就不重复写 settings.json */
  let lastSessionJson = "";
  /** 标签栏右键菜单：屏幕坐标 + 被右键的标签下标（null = 未打开） */
  let tabMenu = $state<{ x: number; y: number; index: number } | null>(null);

  /** 活跃标签 */
  function activeTab(): DocTab | undefined {
    return tabs[activeIndex];
  }

  /** 标签栏显示名 / 未保存圆点：活跃项读全局（未及时搬运时也始终是最新的），其余读快照 */
  function tabTitle(index: number): string {
    const path = index === activeIndex ? currentPath : tabs[index]?.path ?? null;
    return path ? fileName(path) : t("未命名");
  }

  function tabDirty(index: number): boolean {
    return index === activeIndex ? dirty : tabs[index]?.dirty ?? false;
  }

  function anyTabDirty(): boolean {
    return tabs.some((_tab, i) => tabDirty(i));
  }

  /**
   * 把活跃标签的内容与状态写回它的快照。
   *
   * 只在切换 / 关闭 / 落草稿前调用：平时全局状态就是权威，没必要每次按键都序列化一份。
   */
  function captureActiveTab(): void {
    const tab = tabs[activeIndex];
    if (!tab || !tabsReady) return;
    tab.kind = docKind;
    tab.path = currentPath;
    tab.encoding = encoding;
    tab.dirty = dirty;
    tab.htmlView = htmlView;
    tab.previewMutated = previewMutated;
    if (docKind === "html") {
      syncHtmlFromPreview(); // 预览里直接改过的内容先落回源码，再进快照
      tab.content = htmlSource;
    } else if (docKind === "code") {
      tab.content = codeText();
    } else {
      tab.content = getEditorValue();
    }
    tab.loaded = true;
  }

  /** 把某个标签的快照投影回全局状态，并让编辑器显示它的正文 */
  async function activateTab(index: number): Promise<void> {
    const tab = tabs[index];
    if (!tab) return;
    if (!tab.loaded) await loadTabContent(tab); // 会话恢复出来的标签：正文此刻才读盘
    activeIndex = index;
    diskMtime = null; // 先清掉基准：读盘 / 重建 iframe 期间不能让轮询拿着旧时间误报「外部变更」

    docKind = tab.kind;
    currentPath = tab.path;
    encoding = tab.encoding;
    dirty = tab.dirty;
    htmlView = tab.htmlView;
    htmlScripts = false;
    previewMutated = tab.previewMutated;
    if (tab.path) treeRoot = parentDir(tab.path);
    setDocumentPath(tab.path); // 图片落盘目录 / 相对路径换算都跟随各自文档

    if (tab.kind === "html") {
      htmlSource = tab.content;
      previewDoc = tab.content;
      previewKey += 1; // 强制重建 iframe：两个标签的 srcdoc 可能恰好相同
    } else if (tab.kind === "code") {
      htmlSource = "";
      previewDoc = "";
      await showCodeDoc(tab.content, tab.path);
    } else {
      htmlSource = "";
      previewDoc = "";
      setEditorValue(tab.content);
    }

    await updateTitle();
    refreshSideNow();
    if (tab.path) await syncDiskMtime(tab.path); // 外部变更轮询以各自标签的磁盘时间为基准
  }

  /** 切换标签：先把当前标签搬回快照，再投影目标标签 */
  async function switchTab(index: number): Promise<void> {
    if (busy || index === activeIndex || !tabs[index]) return;
    captureActiveTab();
    await activateTab(index);
  }

  /** 循环切换（Ctrl+Tab / Ctrl+Shift+Tab） */
  async function cycleTab(step: number): Promise<void> {
    if (tabs.length < 2) return;
    await switchTab((activeIndex + step + tabs.length) % tabs.length);
  }

  /** 新建标签（Ctrl+N）：当前文档留在原标签里，不丢不改 */
  async function newTab(): Promise<void> {
    if (busy) return;
    captureActiveTab();
    tabs.push(createTab());
    await activateTab(tabs.length - 1);
    resetToBrowseMode(); // 新建的空文档同样从阅读模式起步
  }

  /**
   * 状态栏 / 视图菜单 / Ctrl+E 共用：切换阅读（只读）与编辑模式。
   *
   * 大文档阅读通路下的正文是虚拟化的分节、没有可编辑 DOM，切到编辑模式必须把整篇
   * 交给 Vditor 重新渲染（几 MB 会明显卡顿，正是这条通路要避开的那份代价），
   * 所以先跟用户确认再切。
   */
  async function setBrowseMode(on: boolean): Promise<void> {
    // 超大代码文件是只读分节纯文本：没有可编辑的正文，切「编辑模式」只会把几 MB 源码
    // 塞回 Vditor 重新渲染（就是这条通路要避开的那份代价），所以直接挡下。
    if (!on && codeLargeText !== null) {
      await messageDialog(t("超大代码文件以只读分节方式打开，无法切换到编辑模式。"), {
        title: "Sticho",
        kind: "info",
      });
      return;
    }
    if (!on && isLargeDocMode()) {
      const ok = await confirmDialog(
        t(
          "这是大文档，正在以分节渲染方式打开（阅读流畅，但正文不可直接编辑）。\n切到编辑模式需要把整篇交给编辑器重新渲染，可能明显卡顿。\n继续切换吗？",
        ),
        { title: "Sticho", kind: "info", okLabel: t("切换到编辑模式"), cancelLabel: t("取消") },
      );
      if (!ok) return;
    }
    if (browseMode === on) return;
    browseMode = on;
    setEditorReadonly(on);
    setCodeReadonly(on); // 代码视图有自己的一套只读开关（未挂载时是 no-op）
    // HTML 预览的可编辑性由 previewEditable 派生（不再有独立的「直接编辑」开关），
    // 这里只补一件副作用：退回阅读模式前把预览里的改动落回源码，否则会丢改动。
    if (on && docKind === "html" && htmlView === "preview") {
      syncHtmlFromPreview();
      void refreshFileProps();
    }
    if (!on && docKind === "code") focusCodeEditor(); // 切到编辑模式后光标直接落在代码里
  }

  /**
   * 打开 / 新建 / 导入文档后的起始模式。
   *
   * 遵循「默认打开模式」设置；但大文档与超大代码文件走的是只读分节通路（没有可编辑
   * DOM），无论如何都强制阅读模式，否则界面会谎报「可编辑」。
   */
  function resetToBrowseMode(): void {
    const read = defaultOpenMode === "read" || isLargeDocMode() || codeLargeText !== null;
    browseMode = read;
    setEditorReadonly(read);
    setCodeReadonly(read);
    syncHtmlFromPreview(); // 预览若有未落回的改动，先写回源码
  }

  /**
   * 切换当前文档的模式（「视图 → 纯文本模式 / Markdown 模式 / HTML 模式」，三选一）。
   *
   * 模式就是 `docKind`，三者的差别：
   * - 纯文本模式：CodeMirror 代码视图——**有**语法高亮与「语法高亮语言」，「无」排版工具栏；
   * - Markdown 模式：Vditor——**有**排版工具栏，**无**语法高亮（高亮语言菜单在该模式下置灰）；
   * - HTML 模式：预览 / 源码——两者都没有（与打开 .html 时一致）。
   *
   * 只换渲染内核：正文按当前模式的权威正文原样交给新内核，**不改后缀、不做格式转换**，
   * 保存仍写回原路径（所以 .md 手动切到纯文本模式下保存的仍是 Markdown 源码本身）。
   * 后缀决定的是「默认模式」，手动切换只影响当前标签（随标签快照一起记着）。
   */
  async function setDocMode(mode: "code" | "markdown" | "html"): Promise<void> {
    if (busy || docKind === mode) return;
    busy = true;
    try {
      const text = currentText();
      if (mode === "code") {
        if (docKind === "html") syncHtmlFromPreview();
        await showCodeDoc(text, currentPath);
      } else if (mode === "markdown") {
        if (docKind === "html") syncHtmlFromPreview();
        htmlSource = "";
        previewDoc = "";
        previewMutated = false;
        docKind = "markdown";
        setEditorValue(text);
      } else {
        docKind = "html";
        htmlSource = text;
        previewDoc = text;
        previewKey += 1; // 强制重建 iframe：切模式时 srcdoc 可能恰好相同
        previewMutated = false;
        htmlView = "preview";
        htmlScripts = false; // 脚本执行按文档逐个开启，不跨模式沿用
      }
      const tab = tabs[activeIndex];
      if (tab) tab.kind = mode; // 立刻写回快照，免得切标签时被 captureActiveTab 用旧值盖回去
      await updateTitle();
      if (!browseMode && mode === "code") focusCodeEditor();
      refreshSideNow();
    } finally {
      busy = false;
    }
  }

  /**
   * 打开 / 导入文档的落点：当前标签是「全新未命名的空文档」时直接接管它
   * （否则启动即打开文件会白留一个「未命名」标签），其余情况新开一个标签。
   */
  async function loadIntoFreshTab(run: () => Promise<void> | void): Promise<void> {
    // 判据取自全局状态（= 活跃标签的真实状态），刻意不读快照里的 path：
    // 刚由本函数新建出来的标签还没被 captureActiveTab 搬过，快照里 path 仍是 null，
    // 按快照判断会把这个「刚打开文件」的标签又当成空白标签复用，下一个 Ctrl+O 就把它覆盖掉。
    const pristine = currentPath === null && docKind === "markdown" && !dirty;
    if (!pristine) {
      captureActiveTab();
      tabs.push(createTab());
      activeIndex = tabs.length - 1;
      await updateTitle();
    }
    await run();
    resetToBrowseMode();
  }

  /**
   * 关闭标签（Ctrl+W / 标签上的 ×）。脏标签走三选确认：保存 / 不保存 / 取消。
   *
   * 「保存」分支若最终没能落盘（用户取消了另存为对话框、或写盘报错），
   * 就保持标签不动——关掉它等于静默丢内容。
   */
  async function closeTab(index: number): Promise<void> {
    if (busy) return;
    const tab = tabs[index];
    if (!tab) return;
    if (index === activeIndex) captureActiveTab();

    if (tabDirty(index)) {
      const choice = await askChoice(
        t("「{name}」有未保存的修改。", { name: tabTitle(index) }),
        [
          { label: t("保存"), value: "save", primary: true },
          { label: t("不保存"), value: "discard" },
          { label: t("取消"), value: "cancel" },
        ],
        t("关闭标签"),
      );
      if (choice === null || choice === "cancel") return;
      if (choice === "save") {
        if (index !== activeIndex) await activateTab(index);
        await saveFile();
        if (dirty) return; // 没保存成功：不关
      }
    }

    void deleteRecovery(tab.draftId).catch(() => {}); // 标签没了，它的草稿也该清掉
    const wasActive = index === activeIndex;
    const nextIndex = Math.min(index, tabs.length - 2);
    tabs.splice(index, 1);

    if (tabs.length === 0) {
      tabs.push(createTab());
      await activateTab(0);
    } else if (wasActive) {
      await activateTab(Math.max(0, nextIndex));
    } else if (index < activeIndex) {
      activeIndex -= 1;
    }
    void saveSession();
  }

  /**
   * 关闭除 `keepIndex` 以外的全部标签（标签栏右键「关闭其他标签页」/ 文件菜单「关闭其他标签」）。
   *
   * 与 closeTab 一样守两条底线：
   * 1. 被关掉的标签若还有未保存修改，先问一次（全部保存 / 不保存 / 取消）；
   * 2. 「全部保存」中途失败（用户取消了另存为、或写盘报错）就整体放弃，一个标签都不关。
   *
   * 默认保留当前标签；从标签右键进来时保留被右键的那个，并把它切为活跃
   * （与浏览器/VS Code 的右键语义一致）。
   */
  async function closeOtherTabs(keepIndex: number = activeIndex): Promise<void> {
    if (busy || tabs.length < 2 || !tabs[keepIndex]) return;
    busy = true;
    try {
      if (keepIndex !== activeIndex) {
        captureActiveTab();
        await activateTab(keepIndex);
      }
      captureActiveTab();

      const dirtyOthers = tabs.filter((_tab, i) => i !== keepIndex && tabDirty(i)).length;
      if (dirtyOthers > 0) {
        const choice = await askChoice(
          t("另有 {n} 个标签有未保存的修改，关闭其他标签将丢弃这些修改。", { n: dirtyOthers }),
          [
            { label: t("全部保存"), value: "save", primary: true },
            { label: t("不保存"), value: "discard" },
            { label: t("取消"), value: "cancel" },
          ],
          t("关闭其他标签"),
        );
        if (choice === null || choice === "cancel") return;
        if (choice === "save") {
          // 逐个切过去保存：下标在保存期间不变（此时还没删标签）
          for (let i = 0; i < tabs.length; i++) {
            if (i === keepIndex || !tabDirty(i)) continue;
            await activateTab(i);
            await saveFile();
            if (dirty) return; // 没保存成功：不关
          }
        }
      }

      // 从后往前删，跳过保留项，避免下标漂移
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (i === keepIndex) continue;
        const tab = tabs[i]!;
        void deleteRecovery(tab.draftId).catch(() => {}); // 标签没了，它的草稿也该清掉
        tabs.splice(i, 1);
      }
      // 保留下来的标签此时一定在下标 0 上
      activeIndex = 0;
      await activateTab(0);
      void saveSession();
    } finally {
      busy = false;
    }
  }

  /** 标签右键：记录屏幕坐标与被右键的标签（浮层用固定定位，不受标签栏滚动影响） */
  function openTabMenu(e: MouseEvent, index: number): void {
    e.preventDefault();
    // 贴边时往回缩，免得菜单被窗口边缘截掉
    tabMenu = {
      x: Math.min(e.clientX, window.innerWidth - 190),
      y: Math.min(e.clientY, window.innerHeight - 100),
      index,
    };
  }

  /** 标签右键菜单的动作：先收浮层再执行，免得确认对话框被浮层压住 */
  function runTabMenu(close: boolean): void {
    const menu = tabMenu;
    tabMenu = null;
    if (!menu) return;
    if (close) void closeTab(menu.index);
    else void closeOtherTabs(menu.index);
  }

  /** 标签栏滚轮：竖向滚动转成横向（标签超出宽度时才接管） */
  function onTabsWheel(e: WheelEvent): void {
    const el = e.currentTarget as HTMLElement;
    if (el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }

  /** 把当前标签集写进会话（正文各自在恢复草稿里，这里只有元信息） */
  async function saveSession(): Promise<void> {
    if (!tabsReady) return;
    const json = JSON.stringify(sessionOf(tabs, activeIndex));
    if (json === lastSessionJson) return;
    lastSessionJson = json;
    await saveSetting("session", JSON.parse(json)).catch(() => {});
  }

  // ---- 小工具 ----
  function fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  /** 取所在文件夹（目录树根）：打开/另存文档时跟随文档移动 */
  function parentDir(path: string): string {
    const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    if (i <= 0) return path;
    const dir = path.slice(0, i);
    // 盘符根（D:）补上分隔符，否则 Rust 侧会被当成「当前目录」而非盘根
    return /^[a-zA-Z]:$/.test(dir) ? `${dir}\\` : dir;
  }

  /** 字数统计：汉字逐字计数 + 连续字母数字串按词计数（接近 Word 的「字数」口径） */
  function countWords(text: string): number {
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
    const latin = (text.match(/[a-zA-Z0-9]+/g) ?? []).length;
    return cjk + latin;
  }

  /**
   * 刷新状态栏实时统计（批次七）：字数 / 字符数 / 行数。
   *
   * 字数与字符数/行数的口径可能不同：HTML 文档模式的字数算的是「渲染后可见文字」，
   * 而字符数、行数按源码算（属性面板也是这个口径），故 text 与 source 分开传。
   */
  function updateStats(text: string, source: string = text): void {
    wordCount = countWords(text);
    charCount = source.length;
    lineCount = source.split(/\r\n|\r|\n/).length;
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function formatTime(ms: number | null): string {
    return ms === null ? t("未知") : new Date(ms).toLocaleString("zh-CN", { hour12: false });
  }

  // ---- 侧边栏数据：大纲 + 文件属性 ----
  /**
   * 当前文档的权威正文。
   *
   * docKind 在整个 App.svelte 里有几十处判断，如果不收口，「保存 / 另存 / 应用编码」
   * 这类「取正文」的地方每加一种内核就要改一遍，漏一处就会把文件写空。
   */
  function currentText(): string {
    if (docKind === "code") return codeText();
    if (docKind === "html") return htmlSource;
    return getEditorValue();
  }

  /**
   * 代码文件的权威正文：普通通路取 CodeMirror，超大通路取进来时留着的那份原文。
   *
   * 超大文件的原文必须自己留着——CM 没有挂载，`getCodeValue()` 返回空串，
   * 直接用它会把文件写空。留原文还有个好处：保存时逐字节原样写回，CRLF 不会被动。
   */
  function codeText(): string {
    return codeLargeText ?? getCodeValue();
  }

  /** 文件属性行（侧边栏「属性」视图与「文件 → 文件属性」对话框共用） */
  async function refreshFileProps(): Promise<void> {
    const isHtml = docKind === "html";
    const value = currentText();
    // 字数按可见文字算（HTML 要去标签），字符数 / 行数按源码算
    const text = isHtml ? htmlPlainText(htmlSource) : value;
    // 状态栏统计在这里一并刷新（本节是「当前内容」的唯一入口）：
    // 属性面板与状态栏同源同刻取值，两处数字不会互相打架
    updateStats(text, value);
    const rows: [string, string][] = [
      [t("文件名"), currentPath ? fileName(currentPath) : t("未命名")],
      [t("位置"), currentPath ?? t("尚未保存到磁盘")],
    ];

    if (currentPath) {
      try {
        const info = await invoke<{ size: number; created: number | null; modified: number | null }>("get_file_info", { path: currentPath });
        rows.push([t("大小"), t("{size}（{bytes} 字节）", { size: formatSize(info.size), bytes: info.size.toLocaleString() })]);
        rows.push([t("创建时间"), formatTime(info.created)]);
        rows.push([t("修改时间"), formatTime(info.modified)]);
      } catch (e) {
        rows.push([t("磁盘信息"), e instanceof Error ? e.message : String(e)]);
      }
    }

    const format = isHtml ? "HTML" : docKind === "code" ? codeLangLabel : "Markdown";
    // front matter（批次七）：Lute 会把头部区块渲染成 data-type="yaml-front-matter" 的块，
    // 编辑区无需改动，这里额外把 title / date / tags 等扁平字段解析出来给人看
    // 只对 Markdown 解析头部区块：HTML / 代码文件的正文没有 front matter 这回事
    if (docKind === "markdown") {
      // 注意：循环变量不要与上面的 value 同名——同名遮蔽虽在源码层合法，
      // 但压缩后会被重命名成同一个标识符，for-of 的迭代表达式会踩到 TDZ 直接抛错
      for (const [field, text] of parseFrontMatter(value)) {
        rows.push([t("头部字段 {field}", { field }), text || t("（空）")]);
      }
    }
    rows.push(
      [t("字数"), wordCount.toLocaleString()],
      [t("字符数"), charCount.toLocaleString()],
      [t("行数"), lineCount.toLocaleString()],
      [t("编码"), encodingLabel(encoding)],
      [t("格式"), `${format}${dirty ? t("（有未保存的修改）") : ""}`],
    );
    fileProps = rows;
  }

  /** 立即刷新侧边栏数据（打开/另存/切换视图后调用） */
  function refreshSideNow(): void {
    if (outlineTimer !== undefined) {
      clearTimeout(outlineTimer);
      outlineTimer = undefined;
    }
    if (docKind === "html") outlineHtml = htmlSource; // HTML 大纲直接由源码派生
    else if (docKind !== "code") outlineMd = getEditorValue(); // 代码文件无大纲，不必解析全文
    void refreshFileProps();
  }

  /** 延迟刷新侧边栏数据：编辑时避免每次按键都解析全文 / 读磁盘属性 */
  function scheduleSideRefresh(): void {
    if (outlineTimer !== undefined) clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(() => {
      outlineTimer = undefined;
      if (docKind === "html") {
        // 预览里的改动（直接编辑 / 替换）先落回 htmlSource，大纲 / 字数才是最新的
        syncHtmlFromPreview();
        outlineHtml = htmlSource;
      } else if (docKind !== "code") outlineMd = getEditorValue();
      void refreshFileProps();
    }, 400);
  }

  /** 编辑器内容变化后同步 dirty 与字数（Vditor 的 input 回调 + 菜单改动共用） */
  function syncFromEditor(): void {
    if (!dirty) {
      dirty = true;
      void updateTitle();
    }
    updateStats(getEditorValue());
    scheduleSideRefresh();
  }

  /** HTML 源码输入：先落 htmlSource 再统计（不依赖事件监听顺序） */
  function onHtmlInput(value: string): void {
    htmlSource = value;
    if (!dirty) {
      dirty = true;
      void updateTitle();
    }
    updateStats(htmlPlainText(value), value);
    scheduleSideRefresh();
  }

  /** HTML 源码被程序改写（替换全部）后同步 dirty 与字数 */
  function syncFromHtmlSource(): void {
    if (!dirty) {
      dirty = true;
      void updateTitle();
    }
    updateStats(htmlPlainText(htmlSource), htmlSource);
    scheduleSideRefresh();
  }

  // ---- 预览「直接编辑」（contentEditable）----
  /**
   * 把预览 DOM 序列化回 HTML 源码。
   *
   * iframe 带 allow-same-origin，可同源读取 contentDocument；用克隆节点序列化，
   * 避免为了去掉我们自己加的 contenteditable 而改动实时 DOM（会打断光标）。
   */
  function serializePreview(): string {
    const doc = previewFrame?.contentDocument;
    if (!doc?.documentElement) return htmlSource;
    const clone = doc.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelector("body")?.removeAttribute("contenteditable");
    const dt = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : "";
    return dt + clone.outerHTML;
  }

  /**
   * 预览 DOM 有改动时，把变更同步回 htmlSource。
   *
   * 只更新 htmlSource（保存 / 统计 / 导出用），不动 previewDoc，因此 iframe 不会重载。
   * 未改动过时直接返回，避免「只是切个视图」就把源码重新序列化一遍。
   */
  function syncHtmlFromPreview(): void {
    if (docKind !== "html" || htmlView !== "preview" || !previewMutated) return;
    htmlSource = serializePreview();
  }

  /** 开关预览区的可编辑状态（body 上的 contenteditable 会被序列化剔除） */
  function applyEditMode(on: boolean): void {
    const body = previewFrame?.contentDocument?.body;
    if (!body) return;
    if (on) body.setAttribute("contenteditable", "true");
    else body.removeAttribute("contenteditable");
  }

  /** 预览 DOM 是否可访问：开启脚本执行后 iframe 降级为独立源，父窗口读不到 contentDocument */
  function previewReachable(): boolean {
    return !!previewFrame?.contentDocument?.body;
  }

  /** iframe 每次加载完成：挂事件、按需恢复可编辑（srcdoc / sandbox 变更后编辑态会丢失） */
  function onPreviewLoad(): void {
    previewMutated = false; // DOM 刚由 previewDoc 重建，与源码一致
    const doc = previewFrame?.contentDocument;
    if (!doc) return; // 执行脚本模式下是独立源，拿不到文档，也就无需挂事件
    doc.addEventListener("input", onPreviewInput);
    // iframe 内的按键不会冒泡到主窗口，Ctrl+S 等快捷键需要在这里转发
    doc.addEventListener("keydown", onPreviewKeydown);
    if (previewEditable) applyEditMode(true);
  }

  /**
   * 把「预览是否可编辑」落到 iframe 的 body 上，并在进入编辑态时把焦点送进去。
   *
   * 阅读 / 编辑模式切换时 iframe 不会重建，得主动改 contenteditable；iframe 重建
   * （换 srcdoc / 换沙箱）的那一刻文档还没加载完，这里会落空，由 onPreviewLoad 补一次。
   */
  $effect(() => {
    applyEditMode(previewEditable);
    if (previewEditable) previewFrame?.contentWindow?.focus();
  });

  /** 预览内直接编辑：只置 dirty，字数 / 大纲交给 400ms 防抖统一算（避免每次按键解析全文） */
  function onPreviewInput(): void {
    if (!previewEditable) return;
    previewMutated = true;
    if (!dirty) {
      dirty = true;
      void updateTitle();
    }
    scheduleSideRefresh();
  }

  function onPreviewKeydown(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      if (e.shiftKey) void saveFileAs();
      else void saveFile();
    } else if (k === "f" || k === "h") {
      // WebView2 没有内置查找栏，转发到应用自己的查找/替换栏
      e.preventDefault();
      void openFind();
    }
  }

  /**
   * 状态栏 / 视图菜单共用：切换预览是否执行文档内 JavaScript。
   *
   * 两种沙箱模式互斥，切换必须重建 iframe（sandbox 属性变更不会对已加载的文档生效），
   * 因此先把预览里的改动落回源码，避免丢改动。
   */
  function toggleHtmlScripts(): void {
    if (docKind !== "html") return;
    syncHtmlFromPreview(); // 换沙箱会销毁当前 DOM，先保住改动
    htmlScripts = !htmlScripts;
    // 执行脚本时父窗口读不到文档，预览也就无法可编辑——previewEditable 里已含这一条
    previewMutated = false;
    previewKey += 1;
    void refreshFileProps();
  }

  // ---- 窗口标题 ----
  async function updateTitle(): Promise<void> {
    const name = currentPath ? fileName(currentPath) : t("未命名");
    const mark = dirty ? " ●" : "";
    await getCurrentWindow().setTitle(`${name}${mark} - Sticho`);
  }

  // ---- 确认与错误 ----
  async function showError(prefix: string, e: unknown): Promise<void> {
    const detail = e instanceof Error ? e.message : String(e);
    // 同步落一份日志：错误弹窗转瞬即逝，事后排查需要可回溯的记录（失败不影响提示）
    void logEvent("ERROR", `${prefix}${detail}`).catch(() => {});
    await messageDialog(`${prefix}${detail}`, { title: "Sticho", kind: "error" });
  }

  // ---- 本地版本历史（文件菜单 →「文件历史」）----

  /** 刷新当前文档的历史版本列表（无路径 / 代码模式下清空） */
  async function refreshHistory(): Promise<void> {
    if (!currentPath || docKind === "code") {
      historyEntries = [];
      return;
    }
    try {
      historyEntries = await listHistory(currentPath);
    } catch {
      historyEntries = []; // 读不到历史不影响编辑，静默清空
    }
  }

  /** Unix 秒 → 本地可读时间（历史菜单项标题用） */
  function formatStamp(secs: number): string {
    return formatTime(secs * 1000);
  }

  /** 用历史版本覆盖当前编辑内容（当前磁盘版本由 Rust 侧先留档，可再回滚） */
  async function restoreHistoryVersion(file: string): Promise<void> {
    if (!currentPath) return;
    const ok = await confirmDialog(
      t("用该历史版本覆盖当前编辑内容？当前磁盘上的版本会先留一份档，可再回滚。"),
      { title: "Sticho", kind: "warning", okLabel: t("恢复"), cancelLabel: t("取消") },
    );
    if (!ok) return;
    try {
      const content = await restoreHistory(currentPath, file);
      if (docKind === "html") {
        htmlSource = content;
        previewDoc = content;
        previewKey += 1;
        previewMutated = false;
      } else {
        setEditorValue(content);
      }
      dirty = true; // 恢复结果需要保存才写回磁盘，避免误覆盖
      await refreshHistory();
      await updateTitle();
    } catch (e) {
      await showError(t("恢复历史版本失败："), e);
    }
  }

  /**
   * 点某个历史版本后的二级选择：「查看差异」或「恢复此版本」。
   *
   * 菜单渲染只支持两级，历史版本项本身已是「文件历史」的子项，无法再挂二级子菜单，
   * 因此这里用一个二选一对话框承接（复用 askChoice），不改动菜单渲染逻辑。
   */
  async function historyVersionMenu(file: string): Promise<void> {
    const pick = await askChoice(t("对该历史版本的操作"), [
      { label: t("查看与当前内容的差异"), value: "diff", primary: true },
      { label: t("用该版本覆盖当前编辑内容"), value: "restore" },
    ], t("文件历史"));
    if (pick === "diff") await openHistoryDiff(file);
    else if (pick === "restore") await restoreHistoryVersion(file);
  }

  /** 打开某历史版本与当前内容的差异视图（旧 = 历史版本，新 = 当前内容） */
  async function openHistoryDiff(file: string): Promise<void> {
    if (!currentPath) return;
    try {
      const oldText = await readHistory(currentPath, file);
      const newText = currentText();
      diffView = {
        title: t("版本差异"),
        leftLabel: t("历史版本"),
        rightLabel: t("当前内容"),
        lines: diffLines(oldText, newText),
      };
    } catch (e) {
      await showError(t("读取历史版本失败："), e);
    }
  }

  /**
   * 恢复中心 →「恢复」：把草稿 / 历史版本的内容在编辑器里打开成未保存文档。
   *
   * 刻意不直接写盘：与「文件历史 → 恢复」一致，恢复结果只标记为未保存，由用户确认后再
   * 保存，避免误点就把磁盘上较新的版本盖掉。path 有值时保留原路径（保存即写回原文件）。
   */
  async function restoreFromRecoveryCenter(payload: {
    content: string;
    kind: string;
    path: string | null;
    encoding?: string;
  }): Promise<void> {
    const { content, kind, path } = payload;
    await loadIntoFreshTab(async () => {
      docKind = kind === "html" ? "html" : kind === "code" ? "code" : "markdown";
      currentPath = path;
      setDocumentPath(path);
      dirty = true; // 恢复出来的是历史内容，必须手动保存才写回磁盘
      encoding = payload.encoding || "utf-8";
      diskMtime = null;
      if (docKind === "html") {
        htmlSource = content;
        previewDoc = content;
        previewKey += 1;
        previewMutated = false;
        htmlView = "preview";
        htmlScripts = false;
      } else if (docKind === "code") {
        await showCodeDoc(content, path);
      } else {
        setEditorValue(content);
      }
      if (path) treeRoot = parentDir(path);
      await updateTitle();
      refreshSideNow();
    });
  }

  /** 帮助菜单 →「导出诊断信息…」：生成报告并让用户选择保存位置 */
  async function exportDiagnosticsReport(): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const path = await saveDialog({
      title: t("导出诊断信息"),
      defaultPath: `Sticho-诊断-${stamp}.txt`,
      filters: [{ name: t("文本文件"), extensions: ["txt"] }],
    });
    if (!path) return;
    try {
      await exportDiagnostics(path);
      await messageDialog(t("诊断信息已导出：\n{path}", { path }), { title: "Sticho", kind: "info" });
    } catch (e) {
      await showError(t("导出诊断信息失败："), e);
    }
  }

  // ---- 多选一对话框（批次七）----
  /**
   * 选项式对话框。系统级 confirmDialog 只有「确定 / 取消」两个按钮，
   * 而「外部变更」要三选（重新加载 / 保留我的 / 另存为），故自建一个模态。
   * 返回值：所选 value；用户点了遮罩关闭则为 null。
   */
  type ChoiceOption = { label: string; value: string; primary?: boolean };
  let choiceState = $state<{ title: string; message: string; options: ChoiceOption[] } | null>(null);
  let choiceResolve: ((value: string | null) => void) | null = null;

  function askChoice(message: string, options: ChoiceOption[], title = "Sticho"): Promise<string | null> {
    return new Promise((resolve) => {
      choiceResolve = resolve;
      choiceState = { title, message, options };
    });
  }

  /** 结束当前选项对话框（value 为 null 表示取消） */
  function resolveChoice(value: string | null): void {
    const resolve = choiceResolve;
    choiceResolve = null;
    choiceState = null;
    resolve?.(value);
  }

  // ---- 最近文件（阶段 7）----
  async function pushRecentFile(path: string): Promise<void> {
    recentFiles = [path, ...recentFiles.filter((p) => p !== path)].slice(0, 10);
    await saveSetting("recentFiles", recentFiles);
  }

  async function clearRecentFiles(): Promise<void> {
    recentFiles = [];
    await saveSetting("recentFiles", recentFiles);
  }

  async function openRecent(path: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      // 最近列表里可能有代码 / HTML 文件，必须按扩展名分派，不能一律当 Markdown 打开
      await loadIntoFreshTab(async () => {
        const ext = extOf(path);
        if (ext === "html" || ext === "htm") await openHtmlPath(path);
        else if (isCodePath(path)) await openCodePath(path);
        else await openPath(path);
      });
    } catch (e) {
      // 失效条目（文件已被移动/删除）：从列表移除并告知
      recentFiles = recentFiles.filter((p) => p !== path);
      await saveSetting("recentFiles", recentFiles);
      await showError(t("打开失败（已从最近列表移除）："), e);
    } finally {
      busy = false;
    }
  }

  // ---- 代码文件模式（内核：CodeMirror，见 lib/codeEditor.ts）----
  /** 手动覆盖用的键：未保存的新文档没有路径，统一挂在空串上 */
  function codeLangKey(path: string | null): string {
    return path ?? "";
  }

  /**
   * 当前代码文档最终生效的语言 id（`null` = 纯文本）。
   *
   * 手动覆盖优先于扩展名：这才是「视图 → 语法高亮语言」的语义——.txt 想按 Python 看就选 Python。
   */
  function effectiveCodeLangId(ext: string, path: string | null): string | null {
    const override = codeLangOverrides[codeLangKey(path)];
    return override === undefined ? codeLangIdForExt(ext) : override;
  }

  /** 按上面那份「最终生效」的语言刷新状态栏文案（语言与覆盖都按传入的文档路径求值） */
  function refreshCodeLangLabel(path: string | null): void {
    const ext = path ? extOf(path) : "";
    codeLangLabel = codeLangNameById(effectiveCodeLangId(ext, path));
  }

  /**
   * 「视图 → 语法高亮语言」的选中项：`auto` 表示跟随扩展名。
   *
   * 菜单项读它来决定圆点打在「自动」「纯文本」还是某个语言上。
   */
  function codeLangChoice(): string | null | undefined {
    return codeLangOverrides[codeLangKey(currentPath)];
  }

  /**
   * 手动指定当前文档的语法高亮语言（`undefined` = 恢复自动）。
   *
   * 语言扩展只在挂载时设置，所以改完要重建一次视图——光标会回到开头，属预期代价。
   * 超大代码文件走的是无高亮的分节纯文本，此时菜单项本身是灰的，走不到这里。
   */
  async function setCodeLang(input: string | null | undefined): Promise<void> {
    if (docKind !== "code" || codeLargeText !== null) return;
    const key = codeLangKey(currentPath);
    if (input === undefined) delete codeLangOverrides[key];
    else codeLangOverrides[key] = input;
    refreshCodeLangLabel(currentPath);
    await showCodeEditor(currentText(), currentPath);
  }

  /** 代码视图的挂载参数：打开文件与切换标签共用一份，避免两处参数漂移 */
  function codeOptions(value: string): Parameters<typeof mountCodeEditor>[1] {
    return {
      value,
      ext: codeExt,
      langId: codeLangChoice(),
      typewriter: typewriterOn,
      paragraphFocus: paragraphFocus,
      dark: theme === "dark",
      lineNumbers: showLineNumbers,
      readonly: browseMode,
      onChange: syncFromCode,
      onCursor: (line, column) => {
        codeCursor = { line, column };
      },
      onMatchCount: (count) => {
        codeMatch = count;
      },
    };
  }

  /** 阅读排版的字号 / 行距同样服务代码视图（与 Markdown 共用同一份设置） */
  function applyCodeReaderStyle(): void {
    const style: CodeReaderStyle = {};
    if (readerStyle.fontSize) style.fontSize = readerStyle.fontSize;
    if (readerStyle.lineHeight) style.lineHeight = readerStyle.lineHeight;
    setCodeReaderStyle(style);
  }

  /**
   * 代码文件的总入口：按体积分流（见计划第五节）。
   *
   * - `< CODE_LARGE_BYTES`：交给 CodeMirror，高亮 / 折叠 / 补全 / 书签 / 工具全都在；
   * - `≥ CODE_LARGE_BYTES`：只读分节纯文本，滚动虚拟化 + 行号 + 查找，但没有语法高亮。
   *
   * 体积拿已经读进来的正文量即可（读盘是显示的前提，没必要再为「预检」多跑一次 IPC）。
   */
  async function showCodeDoc(value: string, path: string | null): Promise<void> {
    if (value.length >= CODE_LARGE_BYTES) await showCodePlain(value, path);
    else await showCodeEditor(value, path);
  }

  /**
   * 把一份正文投影到代码视图（打开代码文件、切到代码标签都走这里）。
   *
   * `.code-view` 覆盖层是条件渲染的，必须先把 docKind 落下并等一帧，容器才有真实尺寸——
   * 在 0 高度容器里挂 CM 会渲染出 0 行（见 lib/codeEditor.ts 文件头第 2 条）。
   */
  async function showCodeEditor(value: string, path: string | null): Promise<void> {
    codeLargeText = null;
    leaveLargeMode(); // 上一个标签若是超大代码文件，分节阅读器要收掉（Vditor 在覆盖层下面）
    docKind = "code";
    codeExt = path ? extOf(path) : "";
    refreshCodeLangLabel(path);
    codeMatch = 0; // 换文件先清掉上一份的计数，等 CM 上报
    await tick();
    if (!codeHost) return;
    await mountCodeEditor(codeHost, codeOptions(value));
    applyCodeReaderStyle();
    setCodeReadonly(browseMode);
    if (!browseMode) focusCodeEditor(); // 编辑模式下直接可敲键盘；阅读模式不抢焦点
    // 查找栏还开着时补一次：CM 是全新实例，身上没有上一份查询，不补就会「有计数没高亮」
    if (findOpen && findText) refreshFindCount();
  }

  /**
   * 超大代码文件：转只读分节纯文本（复用大文档通路，无语法高亮）。
   *
   * 为什么不交给 CodeMirror：高亮 / 折叠 / 补全都要在整篇上建索引，几 MB 的源码挂载即卡。
   * 正文交给 editor.ts 的分节阅读器（`setEditorValue(value, true)` → plain 模式，不过 Lute），
   * 于是滚动虚拟化、行号、查找全都白拿——查找走的正是上一轮的大文档通路，能命中还没渲染的分节。
   *
   * 这条通路天然只读（分节 DOM 里没有可编辑的正文），界面切回阅读模式由
   * `onLargeModeChange` 统一完成——与超大 Markdown 文档走的是同一条回调。
   * 编辑模式对它没有意义，`setBrowseMode` 也据此挡下 Ctrl+E（见那里的守卫）。
   */
  async function showCodePlain(value: string, path: string | null): Promise<void> {
    docKind = "code";
    codeExt = path ? extOf(path) : "";
    refreshCodeLangLabel(path);
    codeMatch = 0;
    codeLargeText = value;
    unmountCodeEditor(); // 从普通代码标签切过来时 CM 还挂着，先收掉（覆盖层已不再渲染）
    setEditorValue(value, true);
    if (findOpen && findText) refreshFindCount();
  }

  /** 代码视图正文变化：dirty 立即置位，统计 / 侧栏走既有 400ms 防抖（不在 updateListener 里做 DOM 操作） */
  function syncFromCode(): void {
    if (!dirty) {
      dirty = true;
      void updateTitle();
    }
    scheduleSideRefresh();
  }

  /**
   * 执行一个代码工具（JSON / CSS / JS 的美化与压缩）。
   *
   * 作用范围「选区优先」：有选中就只动选中，没选中才整篇——与 notepad4 的习惯一致。
   * 两者都走 CM 事务（`replaceCodeSelection` / `setCodeValue`），撤销栈里各留一步；
   * 失败（例如 JSON 语法错）弹对话框说明原因，正文保持不变。
   */
  function applyCodeTool(fn: (src: string) => ToolResult): void {
    const selected = getCodeSelection();
    const src = selected !== "" ? selected : getCodeValue();
    if (src.trim() === "") return;
    const res = fn(src);
    if (!res.ok) {
      void messageDialog(res.error, { title: t("代码工具执行失败"), kind: "error" });
      return;
    }
    if (selected !== "") replaceCodeSelection(res.text);
    else setCodeValue(res.text);
    syncFromCode();
  }

  // ---- 核心文件操作（「路径内核」，菜单对话框 / 拖拽 / 最近列表三方复用）----
  /**
   * 打开代码文件（.py / .bat / .json …）：正文交给 CodeMirror，带语法高亮。
   *
   * 与 openHtmlPath 同构——保留原路径，保存写回原文件；也不经过 Vditor，
   * 因此 `#` / `*` / 反引号不会被当成 Markdown 语法毁形。
   */
  async function openCodePath(path: string): Promise<void> {
    const file = await readTextFile(path);
    currentPath = path;
    dirty = false;
    encoding = file.encoding;
    htmlSource = "";
    previewDoc = "";
    previewMutated = false;
    setDocumentPath(path);
    treeRoot = parentDir(path);
    await showCodeDoc(file.content, path);
    await updateTitle();
    await pushRecentFile(path);
    await syncDiskMtime(path); // 记下磁盘修改时间，外部变更轮询以此为基准
    refreshSideNow();
  }

  async function openPath(path: string): Promise<void> {
    // 编码由 Rust 侧自动检测（BOM → UTF-16 启发式 → chardetng 嗅探）
    const file = await readTextFile(path);
    docKind = "markdown"; // 打开 Markdown 文档：退出 HTML 文档模式
    currentPath = path;
    setDocumentPath(path); // 正文里的相对路径图片要按文档所在目录换算成 asset URL
    dirty = false;
    encoding = file.encoding;
    setEditorValue(file.content);
    treeRoot = parentDir(path);
    await updateTitle();
    await pushRecentFile(path);
    await syncDiskMtime(path); // 记下磁盘修改时间，外部变更轮询以此为基准
    refreshSideNow();
  }

  /**
   * 打开 .html → 进入 HTML 文档模式（保留原路径，保存写回原文件）。
   *
   * 不再转成 Markdown：原始源码交给沙箱 iframe 原样渲染，保真度接近浏览器；
   * 需要 Markdown 时走「转为 Markdown 编辑」或「导入 HTML 并转为 Markdown…」。
   */
  async function openHtmlPath(path: string): Promise<void> {
    const file = await readTextFile(path);
    docKind = "html";
    htmlSource = file.content;
    previewDoc = file.content;
    previewKey += 1; // 强制重建 iframe：重新打开同一文件时 srcdoc 可能没变
    previewMutated = false;
    htmlView = "preview";
    htmlScripts = false; // 执行脚本按文档逐个开启，不跨文档沿用
    currentPath = path;
    dirty = false;
    encoding = file.encoding;
    treeRoot = parentDir(path);
    await updateTitle();
    await pushRecentFile(path);
    await syncDiskMtime(path); // 同上
    refreshSideNow();
  }

  /** 把当前 HTML 文档转为 Markdown 新文档（导入语义：不写回原 .html） */
  async function convertToMarkdown(): Promise<void> {
    if (docKind !== "html") return;
    // 这条路径有损：CSS 布局、SVG 图表、表格样式都无法用 Markdown 表达
    const ok = await confirmDialog(
      t("转为 Markdown 后，文档的样式、布局、图表等 HTML 排版信息会丢失，且无法再恢复成原来的渲染效果。\n\n原 .html 文件不会被改动，转换结果是一个未保存的新文档。是否继续？"),
      { title: "Sticho", kind: "warning", okLabel: t("转为 Markdown"), cancelLabel: t("取消") },
    );
    if (!ok) return;

    syncHtmlFromPreview(); // 若预览里刚改过，先落回源码再转换
    const md = await import("./lib/import-html").then((m) => m.htmlToMarkdown(htmlSource));
    // 转换结果放到新标签：原 HTML 文档仍留在自己的标签里，可继续对照
    await loadIntoFreshTab(() => {
      docKind = "markdown";
      currentPath = null;
      setDocumentPath(null);
      dirty = true;
      encoding = "utf-8"; // 转换结果是新生成的文本，按 UTF-8 保存
      setEditorValue(md);
      diskMtime = null; // 新文档尚未落盘
      void updateTitle();
      refreshSideNow();
    });
  }

  /** 导入 HTML（文件 → 导入）：选 .html 转 Markdown 新文档，不进入 HTML 文档模式 */
  async function importHtml(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const picked = await openDialog({
        multiple: false,
        title: t("导入 HTML 文档"),
        filters: [{ name: t("HTML 文档"), extensions: ["html", "htm"] }],
      });
      if (typeof picked !== "string") return; // 用户取消
      const file = await readTextFile(picked);
      const md = await import("./lib/import-html").then((m) => m.htmlToMarkdown(file.content));
      await loadIntoFreshTab(async () => {
        docKind = "markdown";
        currentPath = null;
        setDocumentPath(null);
        dirty = true;
        encoding = "utf-8";
        setEditorValue(md);
        await updateTitle();
        await pushRecentFile(picked);
        refreshSideNow();
      });
    } catch (e) {
      await showError(t("导入 HTML 失败："), e);
    } finally {
      busy = false;
    }
  }

  /** Pandoc 官方安装页（自动下载不可用时的兜底出口） */
  const PANDOC_PAGE = "https://pandoc.org/installing.html";

  /**
   * 下载安装 Pandoc；失败时询问是否转跳官网。
   *
   * 集中一处：「启动自检」与「菜单按需引导」都走这条路径，保证
   * 「自动安装失败 → 官网兜底」的行为一致。返回是否安装成功。
   *
   * busy 只在原本空闲时才接管并原样还原——调用方（如导入 Word）可能已经在
   * busy 状态里，直接置 false 会让遮罩提前消失。
   */
  async function installPandoc(): Promise<boolean> {
    const wasBusy = busy;
    busy = true;
    try {
      await invoke<string>("download_pandoc"); // 阻塞至完成（busy 状态覆盖）
      return true;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const go = await confirmDialog(
        t("自动安装失败：\n{detail}\n\n是否打开官网下载页面手动安装？", { detail }),
        { title: "Sticho", kind: "warning", okLabel: t("前往官网"), cancelLabel: t("取消") },
      );
      if (go) await openUrl(PANDOC_PAGE);
      return false;
    } finally {
      busy = wasBusy;
    }
  }

  /**
   * 启动时的环境自检：pandoc 缺失则提示一次。
   *
   * pandoc 只服务「导入 Word / 导出 LaTeX·Epub」两项低频功能，因此不阻断启动，
   * 也不强制安装；选「以后再说」会持久化标记，之后启动不再重复提示
   * （菜单里的按需引导 ensurePandoc 始终可用）。
   */
  async function checkPandocOnStartup(): Promise<void> {
    if (await loadSetting<boolean>("pandocPromptDismissed")) return;
    let version: string | null = null;
    try {
      version = await invoke<string | null>("check_pandoc");
    } catch {
      return; // 检测本身失败就静默放过，不为环境问题打扰用户
    }
    if (version) return; // 已安装（含系统 PATH 里自装的 pandoc）

    const choice = await askChoice(
      t("未检测到 Pandoc 转换引擎。\n\n它用于「导入 Word」与「导出 LaTeX / Epub」，约 35MB，只需安装一次；不安装不影响其它功能。"),
      [
        { label: t("自动下载安装"), value: "install", primary: true },
        { label: t("前往官网"), value: "page" },
        { label: t("以后再说"), value: "later" },
      ],
      t("环境检测"),
    );

    if (choice === "install") {
      if (await installPandoc()) {
        await messageDialog(t("Pandoc 安装完成，现在可以使用「导入 Word」与「导出 LaTeX / Epub」了。"), {
          title: "Sticho",
          kind: "info",
        });
      }
    } else if (choice === "page") {
      await openUrl(PANDOC_PAGE);
    } else if (choice === "later") {
      await saveSetting("pandocPromptDismissed", true); // 不再重复打扰
    }
  }

  /** Pandoc 引导（批次八抽公共）：未安装时询问是否下载（一次性，存到用户数据目录）。返回是否可用 */
  async function ensurePandoc(reason: string): Promise<boolean> {
    const version = await invoke<string | null>("check_pandoc");
    if (version) return true;
    const ok = await confirmDialog(
      t("「{reason}」需要 Pandoc 转换引擎（约 35MB，从官方渠道下载到本机，只需一次）。\n现在下载吗？", { reason }),
      { title: "Sticho", kind: "info", okLabel: t("下载"), cancelLabel: t("取消") },
    );
    if (!ok) return false;
    return installPandoc(); // 失败时自动给出官网兜底
  }

  async function importWordPath(path: string): Promise<void> {
    if (!(await ensurePandoc(t("导入 Word")))) return;
    const md = await invoke<string>("import_docx", { path });
    await loadIntoFreshTab(async () => {
      docKind = "markdown";
      currentPath = null;
      setDocumentPath(null);
      dirty = true;
      encoding = "utf-8";
      setEditorValue(md);
      await updateTitle();
      refreshSideNow();
    });
  }

  async function importPdfPath(path: string): Promise<void> {
    // pdfjs-dist 体积大且只有导入 PDF 用得上：调用点动态加载，主包不背它
    const { markdown, pageCount } = await import("./lib/import-pdf").then((m) => m.importPdf(path));
    await loadIntoFreshTab(async () => {
      docKind = "markdown";
      currentPath = null;
      setDocumentPath(null);
      dirty = true;
      encoding = "utf-8";
      setEditorValue(markdown);
      await updateTitle();
      refreshSideNow();
    });
    await messageDialog(t("已导入 {n} 页。转换结果为尽力还原，建议检查标题层级与段落划分是否需要校正。", { n: pageCount }), {
      title: "Sticho",
      kind: "info",
    });
  }

  // ---- 文件操作（菜单外壳）----
  async function openFile(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const picked = await openDialog({
        multiple: false,
        title: t("打开文档"),
        filters: [
          // 默认筛选器要能看见所有能打开的文件，代码扩展名统一读 codeLang 的白名单，
          // 免得出现「能拖进来但在这个对话框里选不到」
          // .txt 已归入代码白名单、按代码视图打开，所以这里不再单列
          { name: t("所有支持的文档"), extensions: ["md", "markdown", "html", "htm", ...CODE_EXTS_SORTED] },
          { name: "Markdown", extensions: ["md", "markdown"] },
          { name: "HTML", extensions: ["html", "htm"] },
          { name: t("代码文件"), extensions: [...CODE_EXTS_SORTED] },
        ],
      });
      if (typeof picked !== "string") return; // 用户取消
      const ext = extOf(picked);
      await loadIntoFreshTab(async () => {
        if (ext === "html" || ext === "htm") await openHtmlPath(picked);
        else if (isCodePath(picked)) await openCodePath(picked);
        else await openPath(picked);
      });
    } catch (e) {
      await showError(t("打开失败："), e);
    } finally {
      busy = false;
    }
  }

  async function saveFile(): Promise<void> {
    if (busy) return;
    if (currentPath === null) return saveFileAs();
    busy = true;
    try {
      syncHtmlFromPreview(); // 预览里直接编辑的改动先落回源码
      // 正文统一走 currentText()：markdown / html / code 三种内核都能写对
      await writeTextFile(currentPath, currentText(), encoding);
      dirty = false;
      await updateTitle();
      refreshSideNow();
      await syncDiskMtime(currentPath); // 自己刚写的文件，别让轮询误判成「外部变更」
      clearRecoveryDraft(); // 磁盘已是最新，兜底草稿没意义了
      if (davEnabled && davVerified) syncToCloud(currentPath); // 云同步：不 await，不拖慢本地保存
    } catch (e) {
      await showError(t("保存失败："), e);
    } finally {
      busy = false;
    }
  }

  async function saveFileAs(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const isHtml = docKind === "html";
      const isCode = docKind === "code";
      syncHtmlFromPreview(); // 同上：另存也要带上预览里的改动
      const picked = await saveDialog({
        title: isHtml ? t("保存 HTML 文件") : isCode ? t("保存代码文件") : t("保存 Markdown 文件"),
        defaultPath: currentPath
          ? fileName(currentPath)
          : isHtml
            ? `${t("未命名")}.html`
            : isCode
              ? `${t("未命名")}.${codeExt || "txt"}`
              : `${t("未命名")}.md`,
        filters: isHtml
          ? [{ name: "HTML", extensions: ["html", "htm"] }]
          : isCode
            ? [{ name: t("代码文件"), extensions: codeExt ? [codeExt] : [...CODE_EXTS_SORTED] }]
            : [{ name: "Markdown", extensions: ["md"] }],
      });
      if (typeof picked !== "string") return; // 用户取消
      // 另存可能换扩展名（.txt → .py），而语言覆盖是按路径查的，
      // 所以「变更前」的生效语言必须在改写 currentPath 之前先取出来
      const langBefore = isCode ? effectiveCodeLangId(codeExt, currentPath) : null;
      await writeTextFile(picked, currentText(), encoding);
      currentPath = picked;
      setDocumentPath(picked); // 另存后图片落盘目录随之改变
      dirty = false;
      treeRoot = parentDir(picked);
      // 代码文件另存成别的扩展名时语言要跟着换：高亮由语言扩展决定，
      // 只在挂载时设置，所以语言真的变了才重建一次视图（会重置光标，故加了变化判断）
      if (isCode) {
        const nextExt = extOf(picked);
        codeExt = nextExt;
        refreshCodeLangLabel(picked);
        if (effectiveCodeLangId(nextExt, picked) !== langBefore) {
          await showCodeDoc(currentText(), picked);
        }
      }
      await updateTitle();
      await pushRecentFile(picked);
      refreshSideNow();
      await syncDiskMtime(picked); // 同上：新路径 + 新的磁盘修改时间
      clearRecoveryDraft();
      if (davEnabled && davVerified) syncToCloud(picked); // 云同步同 saveFile
    } catch (e) {
      await showError(t("保存失败："), e);
    } finally {
      busy = false;
    }
  }

  // ---- 外部变更监测（批次七）----
  /** 读取文件的磁盘修改时间（文件不存在 / 读不到时返回 null） */
  async function readDiskMtime(path: string): Promise<number | null> {
    try {
      const info = await invoke<{ modified: number | null }>("get_file_info", { path });
      return info.modified;
    } catch {
      return null;
    }
  }

  /** 记录磁盘修改时间基准（打开 / 保存 / 重载之后调用） */
  async function syncDiskMtime(path: string): Promise<void> {
    diskMtime = await readDiskMtime(path);
  }

  /** 按当前文档类型从磁盘重读（静默重载与「重新加载」共用） */
  async function reloadFromDisk(path: string): Promise<void> {
    if (docKind === "html") await openHtmlPath(path);
    else if (docKind === "code") await openCodePath(path);
    else await openPath(path);
  }

  /**
   * 外部变更轮询（每 5 秒一轮，仅针对已保存到磁盘的文档）。
   *
   * 用 get_file_info 的修改时间比对，不做文件系统监听——轮询的粒度足够覆盖
   * 「别的编辑器 / 脚本改了同一份文件」，且没有 watcher 常驻句柄的代价。
   * 自己保存后会把基准时间刷新（syncDiskMtime），所以不会误报。
   * 文件被删除时读不到时间，直接跳过（不打扰用户）。
   */
  async function checkExternalChange(): Promise<void> {
    if (busy || externalChecking || currentPath === null || diskMtime === null) return;
    // 窗口不可见（最小化 / 切到后台）时跳过：既省掉无谓的 IPC + 文件 stat，
    // 也避免在用户看不到窗口时弹出「文件已被外部修改」的模态框。
    if (document.visibilityState !== "visible") return;
    const path = currentPath;
    externalChecking = true;
    try {
      const mtime = await readDiskMtime(path);
      if (mtime === null || mtime === diskMtime || currentPath !== path) return;
      diskMtime = mtime; // 先更新基准：用户还在选的时候，下一轮不该再弹一次
      if (!dirty) {
        await reloadFromDisk(path); // 本地没有改动：静默跟上磁盘版本
        return;
      }
      const choice = await askChoice(
        t("文件已在外部被修改，而当前文档有未保存的改动。重新加载会丢弃这些改动。"),
        [
          { label: t("重新加载"), value: "reload", primary: true },
          { label: t("保留我的"), value: "keep" },
          { label: t("另存为…"), value: "saveas" },
        ],
        t("文件已在外部更改"),
      );
      if (choice === "reload") await reloadFromDisk(path);
      else if (choice === "saveas") await saveFileAs();
      // "keep"：什么都不做。本次改动仍留在编辑器里，等用户自己决定何时保存
    } catch {
      // 轮询失败（权限变化等）：不打扰用户，交给下一轮
    } finally {
      externalChecking = false;
    }
  }

  // ---- 编码（阶段 11）----
  /**
   * 切换 / 重新检测编码。
   *
   * id 为 null 表示重新自动检测。文档已保存到磁盘时按新编码重新读取文件内容
   * （这才是「换一种编码打开」的语义）；尚未保存的新文档只决定保存时用哪种编码。
   */
  async function applyEncoding(id: string | null): Promise<void> {
    encodingOpen = false;
    if (busy) return;
    if (id !== null && id === encoding) return;

    if (currentPath === null) {
      if (id !== null) encoding = id;
      void refreshFileProps();
      return;
    }

    if (dirty) {
      const ok = await confirmDialog(t("按新编码重新读取磁盘文件会丢弃当前未保存的修改。是否继续？"), {
        title: "Sticho",
        kind: "warning",
        okLabel: t("继续"),
        cancelLabel: t("取消"),
      });
      if (!ok) return;
    }

    busy = true;
    try {
      const file = await readTextFile(currentPath, id ?? undefined);
      encoding = file.encoding;
      dirty = false;
      if (docKind === "html") {
        htmlSource = file.content;
        previewDoc = file.content; // 重新渲染预览
        previewKey += 1; // 编码可能没变，srcdoc 值可能相同，需强制重建
        previewMutated = false;
        htmlScripts = false;
      } else if (docKind === "code") {
        await showCodeDoc(file.content, currentPath);
      } else {
        setEditorValue(file.content);
      }
      await updateTitle();
      refreshSideNow();
      await syncDiskMtime(currentPath); // 编码重读后磁盘时间基准同步刷新

      // 解码时出现替换符：多半选错了编码，提示用户换一种或交给自动检测
      if (file.content.includes("\uFFFD")) {
        await messageDialog(
          t("按「{enc}」解码时遇到无法识别的字节（已显示为 �），该编码可能不是文件的真实编码，建议改用自动检测或换一种编码。", { enc: encodingLabel(encoding) }),
          { title: "Sticho", kind: "warning" },
        );
      }
    } catch (e) {
      await showError(t("按该编码重新读取失败："), e);
    } finally {
      busy = false;
    }
  }

  // ---- 侧边栏（阶段 11）----
  async function setSidebarVisible(visible: boolean): Promise<void> {
    sidebarVisible = visible;
    if (visible) refreshSideNow();
    await saveSetting("sidebarVisible", visible);
  }

  const toggleSidebar = () => {
    // 没有任何面板开启时，展开只会得到一个空侧边栏——此时「显示侧边栏」不可用
    if (!sidebarVisible && enabledSidebarViews.length === 0) return;
    return setSidebarVisible(!sidebarVisible);
  };

  async function setSidebarView(view: SidebarView): Promise<void> {
    sidebarView = view;
    sidebarVisible = true;
    refreshSideNow();
    await saveSetting("sidebarView", view);
    await saveSetting("sidebarVisible", true);
  }

  /** 面板的固定排列顺序：文件树 → 大纲 → 属性 → 搜索 */
  const SIDEBAR_ORDER: SidebarView[] = ["tree", "outline", "props", "search"];
  /** 当前开启的面板（供菜单勾选态与「是否还有内容可显示」判断） */
  const enabledSidebarViews = $derived(SIDEBAR_ORDER.filter((v) => sidebarPanels[v]));

  /** 确保某面板处于开启状态并切到它，同时把侧边栏显示出来 */
  async function showSidebarView(view: SidebarView): Promise<void> {
    if (!sidebarPanels[view]) {
      const next = { ...sidebarPanels, [view]: true };
      sidebarPanels = next;
      await saveSetting("sidebarPanels", next);
    }
    await setSidebarView(view);
  }

  /**
   * 侧边栏面板开关（视图 → 侧边栏 的四项）。
   * - 侧边栏收起、或该项尚未勾选：显示侧边栏并切到该面板；
   * - 取消一项后若还有别的面板开启，且当前正显示它，则切到剩下的第一个；
   * - 四个全取消则侧边栏自动收起。
   */
  async function toggleSidebarPanel(view: SidebarView): Promise<void> {
    // 侧边栏收起时，这一项只负责「把它显示出来并切到该面板」：若仍按勾选逻辑走，
    // 点一个已勾选的项会变成取消勾选，与「收起状态下选择即显示」的预期正好相反。
    if (!sidebarVisible || !sidebarPanels[view]) {
      await showSidebarView(view);
      return;
    }
    const next = { ...sidebarPanels, [view]: false };
    sidebarPanels = next;
    await saveSetting("sidebarPanels", next);
    const rest = SIDEBAR_ORDER.filter((v) => next[v]);
    if (rest.length === 0) await setSidebarVisible(false);
    else if (sidebarView === view) await setSidebarView(rest[0]!);
  }

  /** 目录树点击文件 → 复用打开管道（按扩展名分派） */
  async function openFromTree(path: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const ext = extOf(path);
      if (ext === "html" || ext === "htm") await loadIntoFreshTab(() => openHtmlPath(path));
      else if (ext === "md" || ext === "markdown") await loadIntoFreshTab(() => openPath(path));
      else if (isCodePath(path)) await loadIntoFreshTab(() => openCodePath(path));
      else
        await messageDialog(t("目录树中仅支持打开 Markdown / HTML / 纯文本 / 代码文件（.{ext} 需要先转换）。", { ext }), {
          title: "Sticho",
          kind: "info",
        });
    } catch (e) {
      await showError(t("打开失败："), e);
    } finally {
      busy = false;
    }
  }

  /** 手动指定目录树根目录（未打开文档时也能浏览） */
  async function pickTreeRoot(): Promise<void> {
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: t("选择文件夹作为目录树根") });
      if (typeof picked === "string") treeRoot = picked;
    } catch (e) {
      await showError(t("选择文件夹失败："), e);
    }
  }

  function gotoHeading(index: number): void {
    if (docKind === "html") {
      if (htmlView === "preview") {
        // 沙箱 iframe 带 allow-same-origin（不含 allow-scripts），可同源访问文档做定位
        const headings = previewFrame?.contentDocument?.querySelectorAll("h1,h2,h3,h4,h5,h6");
        headings?.[index]?.scrollIntoView({ block: "start" });
      } else {
        scrollSourceToHeading(outline[index]);
      }
      return;
    }
    scrollToHeading(index, outline[index]?.text ?? "");
  }

  /** HTML 文档模式：预览 / 源码视图切换 */
  function setHtmlView(view: "preview" | "source"): void {
    if (docKind !== "html" || view === htmlView) return;
    if (view === "source") {
      syncHtmlFromPreview(); // 先把预览里的改动落回源码，textarea 才显示最新内容
      htmlView = "source";
    } else {
      htmlView = "preview";
      // 源码可能被改过：重新喂给 srcdoc 渲染（内容没变时 Svelte 不会动 iframe）
      previewDoc = htmlSource;
    }
  }

  /** 源码视图里可以一次选中的最大字符跨度。压缩型 HTML 的正文可能整篇挤在一行
   *  （实测有 44 万字符一行），跨度太大时不选中，只把光标落过去。 */
  const MAX_SELECT_SPAN = 500;

  /**
   * 源码视图：把 textarea 定位到大纲条目对应的源码位置。
   *
   * HTML 大纲带字符偏移，直接精确选中那一个标题标签——压缩型 HTML 里几十个标题
   * 同处一行，按行号定位只能落到行首、区分不出是哪一个。
   * 偏移量由 parseOutlineFromHtml 按 LF 换行算出，与 textarea 的 value 同一坐标系。
   */
  function scrollSourceToHeading(item: OutlineItem | undefined): void {
    const el = sourceArea;
    if (!el || !item) return;
    el.focus();
    const { start, end } = item;
    if (start === undefined || end === undefined) return;
    el.setSelectionRange(start, end - start > MAX_SELECT_SPAN ? start : end);
  }

  // ---- 文件关联（阶段 11）----
  async function toggleAssoc(ext: string): Promise<void> {
    const next = !assoc[ext];
    try {
      await setFileAssociation(ext, next);
      assoc = { ...assoc, [ext]: next };
    } catch (e) {
      await showError(t("设置文件关联失败："), e);
    }
  }

  /**
   * 批量设置一组扩展名的关联状态（分组全选 / 全选所有 / 替代记事本共用）。
   * 逐项写注册表，共用一次 busy 状态；任一步失败即回读真实状态，避免界面与注册表不一致。
   */
  async function setAssocBatch(exts: string[], enable: boolean): Promise<void> {
    if (assocBusy || exts.length === 0) return;
    assocBusy = true;
    try {
      for (const ext of exts) {
        await setFileAssociation(ext, enable);
      }
      const next = { ...assoc };
      for (const ext of exts) next[ext] = enable;
      assoc = next;
    } catch (e) {
      await showError(t("设置文件关联失败："), e);
      await loadAssocState(); // 失败后回读真实状态，避免界面与注册表不一致
    } finally {
      assocBusy = false;
    }
  }

  /** 加载扩展名清单 + 逐项查询关联状态（并发，避免几十项串行拖慢启动） */
  async function loadAssocState(): Promise<void> {
    let info: { exts: AssocExt[]; notepad_exts: string[] };
    try {
      info = await fileAssocInfo();
    } catch {
      return; // 拿不到清单就保持原状（不影响其他设置）
    }
    assocExts = info.exts;
    notepadExts = info.notepad_exts;

    const next: Record<string, boolean> = {};
    const results = await Promise.all(
      info.exts.map(async (e) => {
        try {
          return [e.ext, await getFileAssociation(e.ext)] as const;
        } catch {
          return [e.ext, false] as const; // 读注册表失败时按「未关联」显示
        }
      }),
    );
    for (const [ext, on] of results) next[ext] = on;
    assoc = next;

    try {
      contextMenu = await getContextMenu();
    } catch {
      contextMenu = false;
    }
  }

  /**
   * 「替代系统记事本」开关：勾选即把记事本常见的文本类扩展名批量关联到本程序。
   * 勾选态由 `assoc` 派生（notepadAll），所以逐项取消后这里也会自动变回未勾选。
   */
  async function toggleNotepad(): Promise<void> {
    await setAssocBatch(notepadExts, !notepadAll);
  }

  /** 打开 / 关闭「用本软件打开」右键菜单项（作用于所有文件） */
  async function toggleContextMenu(): Promise<void> {
    if (assocBusy) return;
    const next = !contextMenu;
    assocBusy = true;
    try {
      await setContextMenu(next);
      contextMenu = next;
    } catch (e) {
      await showError(t("设置右键菜单失败："), e);
    } finally {
      assocBusy = false;
    }
  }

  /** 打开系统「默认应用」设置页 */
  async function openDefaultApps(): Promise<void> {
    try {
      await openDefaultAppsSettings();
    } catch (e) {
      await showError(t("打开系统设置失败："), e);
    }
  }

  /** 当前文档主名（导出对话框的默认文件名） */
  function docBaseName(): string {
    if (!currentPath) return t("未命名");
    const name = fileName(currentPath);
    // 代码文件的扩展名五花八门（codeLang 里几十个），逐个列进正则不如直接砍最后一段扩展名
    if (docKind === "code") return name.replace(/\.[^.]+$/, "") || name;
    return name.replace(/\.(md|markdown|txt|html|htm)$/i, "");
  }

  /** 当前文档所在目录（Pandoc 导出时解析正文相对路径图片用）；未保存文档为 null */
  function docDirPath(): string | null {
    if (!currentPath) return null;
    const cut = currentPath.replace(/[\\/][^\\/]*$/, "");
    return cut === currentPath ? null : cut;
  }

  /**
   * 导出用源文本。
   *
   * HTML 文档导出 HTML 时原样输出（最忠实）；导出 Word / PDF / 纯文本
   * 需要 Markdown，先经 turndown 转换（复杂排版保真度会下降）。
   */
  function exportSource(ext: string): Promise<string> {
    if (docKind !== "html") return Promise.resolve(currentText()); // 代码文件导出即原文（无 Markdown 转换）
    syncHtmlFromPreview(); // 导出也要包含预览里的直接编辑结果
    if (ext === "html") return Promise.resolve(htmlSource);
    // markdown-it（turndown 依赖链）走动态加载，主包不背
    return import("./lib/import-html").then((m) => m.htmlToMarkdown(htmlSource));
  }

  /** 导出通用外壳：选路径 → 交给各格式的导出实现 */
  async function exportAs(
    title: string,
    ext: string,
    filterName: string,
    run: (path: string, source: string) => Promise<void>,
  ): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const picked = await saveDialog({
        title,
        defaultPath: `${docBaseName()}.${ext}`,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (typeof picked !== "string") return; // 用户取消
      await run(picked, await exportSource(ext));
    } catch (e) {
      await showError(t("{title}失败：", { title }), e);
    } finally {
      busy = false;
    }
  }

  // exportDocx / importPdf 走调用点动态加载：docx 与 pdfjs-dist 体积可观，
  // 却只有导出 Word / 导入 PDF 时才用得上，静态打进主包白白拖慢首帧
  const exportWord = () =>
    exportAs(t("导出为 Word 文档"), "docx", t("Word 文档"), async (path, source) => {
      const [{ exportDocx }, { renderMermaidToPng }] = await Promise.all([
        import("./lib/export-docx"),
        import("./lib/mermaidImage"),
      ]);
      const { embedded, skipped } = await exportDocx(path, source, {
        baseDir: docDirPath(),
        renderMermaid: renderMermaidToPng,
      });
      // 有图片没能嵌入时给一次汇总说明（远端图、不支持格式、相对路径解析失败等）
      if (skipped.length) {
        const list = skipped.slice(0, 8).join("\n");
        const more = skipped.length > 8 ? t("\n…另有 {n} 张", { n: skipped.length - 8 }) : "";
        await messageDialog(
          t("已嵌入 {n} 张图片。以下图片未能嵌入，已回落为占位文字：\n{list}{more}", {
            n: embedded,
            list,
            more,
          }),
          { title: t("导出为 Word 文档"), kind: "warning" },
        );
      }
    });
  const exportPdfFile = () =>
    exportAs(t("导出为 PDF 文档"), "pdf", t("PDF 文档"), (path, source) =>
      import("./lib/export-pdf").then((m) => m.exportPdf(path, source, docBaseName())),
    );
  // HTML 文档导出 HTML：源码原样写出（走 markdown-it 会把标签转义成文本）
  const exportHtmlFile = () =>
    docKind === "html"
      ? exportAs(t("导出为 HTML 文档"), "html", t("HTML 文档"), (path, source) => writeTextFile(path, source, encoding))
      : exportAs(t("导出为 HTML 文档"), "html", t("HTML 文档"), (path, source) =>
          import("./lib/export-html").then((m) => m.exportHtml(path, source)),
        );
  const exportTxtFile = () =>
    exportAs(t("导出为纯文本文件"), "txt", t("纯文本"), (path, source) =>
      import("./lib/export-txt").then((m) => m.exportTxt(path, source)),
    );

  /** 通过 Pandoc 导出（批次八）：LaTeX / Epub，未装 Pandoc 时先引导下载 */
  function exportViaPandoc(title: string, ext: string, filterName: string, kind: "latex" | "epub") {
    return exportAs(title, ext, filterName, async (path, source) => {
      if (!(await ensurePandoc(title.replace(/^导出为/, "导出")))) return;
      await exportPandoc(path, source, kind, docDirPath());
    });
  }

  const exportLatexFile = () => exportViaPandoc(t("导出为 LaTeX 文档"), "tex", t("LaTeX 文档"), "latex");
  const exportEpubFile = () => exportViaPandoc(t("导出为 Epub 电子书"), "epub", t("Epub 电子书"), "epub");

  /**
   * 打印：交给系统打印对话框（WebView2 自带打印预览，故本软件不再自建预览）。
   *
   * 打印样式与「导出 PDF」共用（export-pdf），故走动态加载；打印内容装进离屏 iframe
   * 再 print()，只打正文，不会带上工具栏与侧边栏。
   */
  async function printDoc(): Promise<void> {
    const m = await import("./lib/print");
    const html = m.buildPrintDocument({
      source: currentText(),
      kind: docKind,
      title: docBaseName(),
      dir: docDirPath(),
    });
    await m.printHtml(html);
  }

  /** 导入 Word（阶段 5）：docx → Pandoc → GFM Markdown，图片内联 data URI */
  async function importWord(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const picked = await openDialog({
        multiple: false,
        title: t("导入 Word 文档"),
        filters: [{ name: t("Word 文档"), extensions: ["docx"] }],
      });
      if (typeof picked !== "string") return; // 用户取消
      await importWordPath(picked);
    } catch (e) {
      await showError(t("导入 Word 失败："), e);
    } finally {
      busy = false;
    }
  }

  /** 导入 PDF（阶段 6）：pdfjs 抽取文本层 → Markdown，尽力转换 */
  async function importPdfFile(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const picked = await openDialog({
        multiple: false,
        title: t("导入 PDF 文档"),
        filters: [{ name: t("PDF 文档"), extensions: ["pdf"] }],
      });
      if (typeof picked !== "string") return; // 用户取消

      // 事前告知局限性（任务书阶段 6：明确说明扫描件不可用）
      const ok = await confirmDialog(
        t("PDF 导入为尽力转换：仅支持文字版 PDF，扫描件（图片型 PDF）无法提取文字；表格、多栏等复杂排版可能需要人工校正。\n继续吗？"),
        { title: "Sticho", kind: "info", okLabel: t("继续"), cancelLabel: t("取消") },
      );
      if (!ok) return;

      await importPdfPath(picked);
    } catch (e) {
      await showError(t("导入 PDF 失败："), e);
    } finally {
      busy = false;
    }
  }

  /** 文件属性（阶段 10；阶段 11 起与侧边栏「属性」视图共用同一份数据） */
  async function showFileInfo(): Promise<void> {
    await refreshFileProps();
    await messageDialog(fileProps.map(([label, value]) => `${label}：${value}`).join("\n"), {
      title: t("文件属性"),
      kind: "info",
    });
  }

  async function exitApp(): Promise<void> {
    if (busy) return;
    captureActiveTab();
    if (anyTabDirty()) {
      const count = tabs.filter((_t, i) => tabDirty(i)).length;
      const ok = await confirmDialog(
        count > 1
          ? t("有 {n} 个标签存在未保存的修改，退出将丢弃这些修改。确定退出吗？", { n: count })
          : t("当前文档有未保存的修改，退出将丢弃这些修改。确定退出吗？"),
        { title: "Sticho", kind: "warning", okLabel: t("退出"), cancelLabel: t("取消") },
      );
      if (!ok) return;
    }
    // 退出前落一份草稿与会话：定时器可能刚好还没轮到（tickAutoSave 已吞掉所有异常）
    await tickAutoSave();
    await getCurrentWindow().destroy();
  }

  // ---- 编辑菜单：剪贴板 ----
  async function cutSelection(): Promise<void> {
    const sel = getEditorSelection();
    if (!sel) return;
    try {
      await writeClipboardText(sel);
      deleteEditorSelection();
    } catch (e) {
      await showError(t("剪切失败："), e);
    }
  }

  async function copySelection(): Promise<void> {
    const sel = getEditorSelection();
    if (!sel) return;
    try {
      await writeClipboardText(sel);
    } catch (e) {
      await showError(t("复制失败："), e);
    }
  }

  async function pasteClipboard(): Promise<void> {
    try {
      insertEditorText(await readClipboardText());
    } catch (e) {
      await showError(t("粘贴失败："), e);
    }
  }

  // ---- 查找 / 替换（阶段 10；批次五增强为 大小写 / 全词 / 正则 + 计数 + 高亮）----
  /** 正则元字符转义（字面量模式下把用户输入当成纯文本） */
  function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 按当前三个开关编译查找正则。
   *
   * 统一走正则引擎的好处：大小写、全词、正则三种匹配共用同一套「找位置」逻辑，
   * 替换也能直接用 `String.replace` 的 `$1` 捕获组语义。
   * 返回 null 表示正则语法有误（前端提示，不抛异常）。
   */
  function buildFindRegex(): RegExp | null {
    if (!findText) return null;
    const source = findRegex ? findText : escapeRegExp(findText);
    // 全词匹配用自定义边界而不是 \b：\b 只认 ASCII 单词边界，中文词会被整段吞掉。
    // 两侧字符只要不是字母数字/下划线/汉字，就算词的边界。
    const body = findWord
      ? `(?<![\\w\\u4e00-\\u9fff])(?:${source})(?![\\w\\u4e00-\\u9fff])`
      : source;
    try {
      return new RegExp(body, findCase ? "g" : "gi");
    } catch {
      return null;
    }
  }

  /** 一个 DOM 内的命中：Range 用于定位/高亮/替换，text 与 groups 供替换时展开 `$1` */
  type DomHit = { range: Range; text: string; groups: string[] };

  /**
   * 在给定根节点内收集全部命中。
   *
   * 只遍历文本节点，所以「被标签切开的短语」不匹配（如 `**加粗**` 里的跨标记短语），
   * 与阶段 10 的既有取舍一致。返回 null 表示正则语法有误。
   */
  function domHits(root: Node | null, doc: Document): DomHit[] | null {
    const re = buildFindRegex();
    if (!re || !root) return re ? [] : null;

    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // script/style/noscript 里的文本不可见，不该被命中
        return (node as Text).parentElement?.closest("script,style,noscript")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });

    const hits: DomHit[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      const hay = textNode.data;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(hay)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++; // 零宽匹配（如 `a*`）不推进 lastIndex 会死循环
          continue;
        }
        const range = doc.createRange();
        range.setStart(textNode, m.index);
        range.setEnd(textNode, m.index + m[0].length);
        hits.push({ range, text: m[0], groups: m.slice(1).map((g) => g ?? "") });
      }
    }
    return hits;
  }

  /** 编辑器正文内的命中（Markdown 模式） */
  function editorHits(): DomHit[] | null {
    return domHits(getEditorContentElement(), document);
  }

  // ---- 命中高亮（CSS Custom Highlight API，零 DOM 侵入）----
  // 不用包裹 <mark>：那会改 DOM，Vditor 下一次 input 就会把包裹元素当正文回写进 Markdown。
  // Custom Highlight 只登记 Range，正文结构与回写结果都不受影响。
  type HighlightCtor = new (...ranges: Range[]) => unknown;
  type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };

  /** 运行时能力：WebView2 的 Chromium ≥105 才有（更早版本返回 undefined，高亮降级为无） */
  function highlightRegistry(): HighlightRegistry | null {
    return (CSS as unknown as { highlights?: HighlightRegistry }).highlights ?? null;
  }

  function highlightCtor(): HighlightCtor | null {
    return (window as unknown as { Highlight?: HighlightCtor }).Highlight ?? null;
  }

  /** 登记高亮：普通命中的那一组与「当前」那处分两个名字，各用各的颜色 */
  function setHighlightRanges(ranges: Range[], current: Range | null): void {
    const registry = highlightRegistry();
    const Ctor = highlightCtor();
    if (!registry || !Ctor) return;
    if (ranges.length > 0) registry.set("md-find", new Ctor(...ranges));
    else registry.delete("md-find");
    if (current) registry.set("md-find-current", new Ctor(current));
    else registry.delete("md-find-current");
  }

  /** 给全部命中上色，当前命中的那一处用另一种颜色区分 */
  function applyFindHighlights(hits: DomHit[], currentIdx: number): void {
    const others = hits.filter((_, i) => i !== currentIdx).map((h) => h.range);
    setHighlightRanges(others, currentIdx >= 0 ? (hits[currentIdx]?.range ?? null) : null);
  }

  /** 清掉高亮（关闭查找栏、切换文档、重新输入时都要清，否则会留下过期 Range） */
  function clearFindHighlights(): void {
    const registry = highlightRegistry();
    registry?.delete("md-find");
    registry?.delete("md-find-current");
  }

  /**
   * 按当前选项与文档形态刷新计数显示，并在能高亮的场合顺带上色。
   *
   * 计数格式统一为 `n / total`（未定位时为 `0 / total`）；无内容或语法错误时显示
   * `0 / 0` 与提示文案。
   */
  function refreshFindCount(): void {
    clearFindHighlights();

    // 代码视图：高亮由 CM 自己按查询铺 `.cm-searchMatch`，应用层只消费计数。
    // 超大代码文件是个例外——它没挂 CM（走下面的分节大文档通路），别在这儿拦截。
    if (docKind === "code" && codeLargeText === null) {
      if (!findOpen || !findText) {
        clearCodeFind();
        findStatus = "0 / 0";
        return;
      }
      const n = setCodeFind(codeFindOptions());
      findIdx = -1;
      findStatus = n === null ? t("正则表达式无效") : `0 / ${n}`;
      return;
    }

    if (!findOpen || !findText) {
      findStatus = "0 / 0";
      return;
    }

    if (docKind === "html") {
      if (htmlView === "source") {
        const hits = stringHits(htmlSource);
        findStatus = hits === null ? t("正则表达式无效") : `0 / ${hits.length}`;
        return;
      }
      // 预览视图沿用「选中 + 滚动」的方案（iframe 里没有应用样式，登记高亮也看不见）
      if (!previewReachable()) {
        findStatus = t("执行脚本时不支持预览查找");
        return;
      }
      const hits = previewHits();
      findStatus = hits === null ? t("正则表达式无效") : `0 / ${hits.length}`;
      return;
    }

    // 大文档分节通路：命中按整篇源码算，不受已渲染分节的限制
    if (isLargeDocMode()) {
      const largeHits = largeSourceHits();
      if (largeHits === null) {
        findStatus = t("正则表达式无效");
        return;
      }
      if (largeHits.length === 0) {
        findStatus = "0 / 0";
        return;
      }
      findIdx = -1;
      applyLargeFindHighlights(largeHits, -1);
      findStatus = `0 / ${largeHits.length}`;
      return;
    }

    const hits = editorHits();
    if (hits === null) {
      findStatus = t("正则表达式无效");
      return;
    }
    if (hits.length === 0) {
      findStatus = "0 / 0";
      return;
    }
    findIdx = -1;
    applyFindHighlights(hits, -1);
    findStatus = `0 / ${hits.length}`;
  }

  /** 字符串内的命中（HTML 源码视图的 textarea 走这条；textarea 没法登记 Range 高亮） */
  type StringHit = { index: number; text: string; groups: string[] };

  function stringHits(hay: string): StringHit[] | null {
    const re = buildFindRegex();
    if (!re) return null;

    const hits: StringHit[] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      hits.push({ index: m.index, text: m[0], groups: m.slice(1).map((g) => g ?? "") });
    }
    return hits;
  }

  // ---- 大文档（分节渲染）通路下的查找 ----
  // 那条通路的正文是虚拟化的：DOM 里只有视口附近的几节。所以命中在「整篇源码」上统计
  // 与定位（计数与上一个/下一个都能覆盖全文），只有上色受限于已挂载的分节——
  // 而跳过去之前会先把目标分节挂出来，于是「看到的那一处」总是被正确高亮的。

  /** 命中缓存所属的源码（换文档时失效） */
  let largeHitSource = "";
  /** 与缓存源码对应的命中（按偏移升序） */
  let largeHitList: StringHit[] = [];

  /** 大文档通路的命中：按整篇源码统计，不受「只渲染了视口附近分节」的限制 */
  function largeSourceHits(): StringHit[] | null {
    const source = getLargeSourceText();
    if (source === null) return null;
    if (source !== largeHitSource) {
      const hits = stringHits(source);
      if (hits === null) return null;
      largeHitSource = source;
      largeHitList = hits;
    }
    return largeHitList;
  }

  /** 命中列表里第一处「偏移不小于 offset」的下标（列表按偏移升序，故可二分） */
  function hitIndexFrom(hits: StringHit[], offset: number): number {
    let lo = 0;
    let hi = hits.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (hits[mid]!.index < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * 把整篇源码的命中映射到已挂载分节的 DOM 上并登记高亮，返回「当前命中」的 Range。
   *
   * 分节内按序号配对：第 k 处源码命中对应分节内第 k 处渲染层命中。源码里的 markdown
   * 标记（`**`、`#`）在渲染层不存在，两者偶尔差一处，但纯文字查询完全一致。
   */
  function applyLargeFindHighlights(sourceHits: StringHit[], currentIdx: number): Range | null {
    const ranges: Range[] = [];
    let current: Range | null = null;
    for (const sec of getLargeMountedSections()) {
      const dom = domHits(sec.el, document);
      if (!dom || dom.length === 0) continue;
      const from = hitIndexFrom(sourceHits, sec.start);
      const to = hitIndexFrom(sourceHits, sec.end);
      for (let j = from; j < to; j++) {
        const range = dom[j - from]?.range;
        if (!range) break;
        if (j === currentIdx) current = range;
        else ranges.push(range);
      }
    }
    setHighlightRanges(ranges, current);
    return current;
  }

  /** 分节挂载 / 卸载后旧 Range 会指向被清空的占位 div，延迟重画一次（滚动时合流成一拍） */
  let largeFindTimer: number | null = null;
  function scheduleLargeFindRepaint(): void {
    if (largeFindTimer !== null) return;
    largeFindTimer = window.setTimeout(() => {
      largeFindTimer = null;
      if (!findOpen || !findText || !isLargeDocMode()) return;
      const hits = largeSourceHits();
      if (hits === null || hits.length === 0) return;
      applyLargeFindHighlights(hits, findIdx);
    }, 120);
  }

  /** 大文档通路的「下一个 / 上一个」：先挂载并滚到目标分节，再在那一节里定位 Range */
  function findNextLarge(backwards: boolean): void {
    const hits = largeSourceHits();
    if (hits === null) {
      findIdx = -1;
      findStatus = t("正则表达式无效");
      return;
    }
    if (hits.length === 0) {
      findIdx = -1;
      findStatus = "0 / 0";
      return;
    }
    findIdx = backwards
      ? findIdx <= 0
        ? hits.length - 1
        : findIdx - 1
      : (findIdx + 1) % hits.length;

    // Range 只能建在已挂载的 DOM 上：先把目标分节挂出来（未渲染的分节也跳得过去）
    revealLargeSourceOffset(hits[findIdx]!.index, true);
    const current = applyLargeFindHighlights(hits, findIdx);
    if (current) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(current);
      // 分节可能高达几万像素，必须按命中自己的位置居中，不能对齐整个块
      scrollLargeRangeIntoView(current);
    }
    findStatus = `${findIdx + 1} / ${hits.length}`;
  }

  /** 替换文本里的 `$1` / `$&` / `$$` 展开；字面量模式不展开（与旧行为一致，输入什么就是什么） */
  function expandReplacement(template: string, full: string, groups: string[]): string {
    if (!findRegex) return template;
    return template.replace(/\$(\$|&|\d{1,2})/g, (_whole, token: string) => {
      if (token === "$") return "$";
      if (token === "&") return full;
      const index = Number(token);
      return index === 0 ? full : (groups[index - 1] ?? "");
    });
  }

  // ---- 代码视图（CodeMirror）通路的查找 ----
  // 与前三条通路的分工不同：CM 自己按查询铺 `.cm-searchMatch` 装饰，应用层不再登记
  // Range 高亮，只负责「把查询交给 CM + 显示 CM 数出来的命中数」。

  /** 顶栏三个开关 → CM 的搜索语义（与 Markdown 通路的 buildFindRegex 一一对应） */
  function codeFindOptions(): CodeFindOptions {
    return { search: findText, caseSensitive: findCase, wholeWord: findWord, regexp: findRegex };
  }

  /** 代码视图的「下一个 / 上一个」：交给 CM 选中并居中 */
  function findNextInCode(backwards: boolean): void {
    const matches = getCodeMatches();
    if (matches === null) {
      findIdx = -1;
      findStatus = t("正则表达式无效");
      return;
    }
    if (matches.length === 0) {
      findIdx = -1;
      findStatus = "0 / 0";
      return;
    }
    findIdx = backwards
      ? findIdx <= 0
        ? matches.length - 1
        : findIdx - 1
      : (findIdx + 1) % matches.length;

    gotoCodeMatch(findIdx);
    findStatus = `${findIdx + 1} / ${matches.length}`;
  }

  /** 代码视图的「替换当前」：替换已定位的命中，然后跳到下一处 */
  function replaceOneInCode(): void {
    const matches = getCodeMatches();
    if (matches === null) {
      findStatus = t("正则表达式无效");
      return;
    }
    const current = findIdx >= 0 ? matches[findIdx] : undefined;
    if (current) {
      const inserted = replaceCodeMatches([
        {
          from: current.from,
          to: current.to,
          insert: expandReplacement(replaceText, current.text, current.groups),
        },
      ]);
      if (inserted > 0) syncFromCode();
    }
    findNextInCode(false);
  }

  /** 代码视图的「全部替换」：合成一次事务提交，避免逐处 dispatch 触发多次重绘 */
  function replaceAllInCode(): void {
    const matches = getCodeMatches();
    if (matches === null) {
      findStatus = t("正则表达式无效");
      return;
    }
    if (matches.length === 0) {
      findIdx = -1;
      findStatus = "0 / 0";
      return;
    }
    const n = replaceCodeMatches(
      matches.map((m) => ({
        from: m.from,
        to: m.to,
        insert: expandReplacement(replaceText, m.text, m.groups),
      })),
    );
    findIdx = -1;
    findStatus = t("已替换 {n} 处", { n });
    if (n > 0) syncFromCode();
  }

  /** HTML 源码视图下的查找：直接在 textarea 文本中定位并选中（靠选中呈现，无高亮） */
  function findNextInSource(backwards: boolean): void {
    const el = sourceArea;
    if (!el) return;
    const hits = stringHits(htmlSource);
    if (hits === null) {
      findStatus = t("正则表达式无效");
      return;
    }
    if (hits.length === 0) {
      findStatus = "0 / 0";
      return;
    }

    const cursor = backwards ? el.selectionStart : el.selectionEnd;
    let next = -1;
    if (backwards) {
      // 从光标往前找最近的一处；都没有就回绕到最后一处
      for (let i = hits.length - 1; i >= 0; i--) {
        if (hits[i]!.index < cursor) {
          next = i;
          break;
        }
      }
      if (next < 0) next = hits.length - 1;
    } else {
      for (let i = 0; i < hits.length; i++) {
        if (hits[i]!.index >= cursor) {
          next = i;
          break;
        }
      }
      if (next < 0) next = 0; // 到头回绕到第一处
    }

    const hit = hits[next]!;
    el.focus();
    el.setSelectionRange(hit.index, hit.index + hit.text.length);
    findIdx = next;
    findStatus = `${next + 1} / ${hits.length}`;
  }

  /**
   * 预览 DOM 内的查找：遍历 iframe 正文文本节点收集 Range。
   *
   * Range 必须由 iframe 自己的 document 创建，否则不能用于该文档的选区。
   * 跳过 script/style/noscript 里的文本（不可见，不该被命中）。
   */
  function previewHits(): DomHit[] | null {
    const doc = previewFrame?.contentDocument;
    if (!doc) return [];
    return domHits(doc.body, doc);
  }

  /** 预览内的查找：用 iframe 的选区高亮命中项并滚动到可见位置 */
  function findNextInPreview(backwards: boolean): void {
    if (!previewReachable()) {
      findIdx = -1;
      findStatus = t("执行脚本时不支持预览查找");
      return;
    }
    const hits = previewHits();
    if (hits === null) {
      findIdx = -1;
      findStatus = t("正则表达式无效");
      return;
    }
    if (hits.length === 0) {
      findIdx = -1;
      findStatus = "0 / 0";
      return;
    }
    findIdx = backwards
      ? findIdx <= 0
        ? hits.length - 1
        : findIdx - 1
      : (findIdx + 1) % hits.length;

    const range = hits[findIdx]!.range;
    const selection = previewFrame?.contentWindow?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
    findStatus = `${findIdx + 1} / ${hits.length}`;
  }

  /**
   * 预览 DOM 内替换命中项。
   *
   * 倒序应用：同一文本节点里的多处命中，先改后面的才不会让前面的偏移失效。
   */
  function replaceInPreview(hits: DomHit[]): void {
    const doc = previewFrame?.contentDocument;
    if (!doc) return;
    for (let i = hits.length - 1; i >= 0; i--) {
      const { range, text, groups } = hits[i]!;
      range.deleteContents();
      range.insertNode(doc.createTextNode(expandReplacement(replaceText, text, groups)));
    }
    previewMutated = true;
    if (!dirty) {
      dirty = true;
      void updateTitle();
    }
    clearFindHighlights();
    scheduleSideRefresh();
  }

  /** 替换当前命中项；尚未定位过时先定位一次（与编辑器 / 源码视图的语义一致） */
  function replaceOneInPreview(): void {
    if (!previewReachable()) {
      findIdx = -1;
      findStatus = t("执行脚本时不支持预览替换");
      return;
    }
    const hits = previewHits();
    if (hits === null) {
      findIdx = -1;
      findStatus = t("正则表达式无效");
      return;
    }
    if (hits.length === 0) {
      findIdx = -1;
      findStatus = "0 / 0";
      return;
    }
    if (findIdx < 0 || findIdx >= hits.length) {
      findNextInPreview(false);
      return;
    }
    replaceInPreview([hits[findIdx]!]);
    // 替换后命中列表整体前移一位，回退索引再前进，正好落在原命中的下一处
    findIdx -= 1;
    findNextInPreview(false);
  }

  function replaceAllInPreview(): void {
    if (!previewReachable()) {
      findIdx = -1;
      findStatus = t("执行脚本时不支持预览替换");
      return;
    }
    const hits = previewHits();
    if (hits === null) {
      findIdx = -1;
      findStatus = t("正则表达式无效");
      return;
    }
    if (hits.length === 0) {
      findIdx = -1;
      findStatus = "0 / 0";
      return;
    }
    replaceInPreview(hits);
    findIdx = -1;
    findStatus = t("已替换 {n} 处", { n: hits.length });
  }

  /** 编辑器常规通路（Markdown / 纯文本）的「下一个 / 上一个」：在正文 Range 上定位并居中 */
  function findNextInEditor(backwards: boolean): void {
    const hits = editorHits();
    if (hits === null) {
      findIdx = -1;
      findStatus = t("正则表达式无效");
      return;
    }
    if (hits.length === 0) {
      findIdx = -1;
      findStatus = "0 / 0";
      return;
    }
    findIdx = backwards
      ? findIdx <= 0
        ? hits.length - 1
        : findIdx - 1
      : (findIdx + 1) % hits.length;

    const range = hits[findIdx]!.range;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
    applyFindHighlights(hits, findIdx);
    findStatus = `${findIdx + 1} / ${hits.length}`;
  }

  /**
   * 查找「下一个 / 上一个」的分派表：每条通路一项「判定 + 执行」，按序取第一条命中的。
   *
   * 五条通路（代码视图 / HTML 源码 / HTML 预览 / 大文档分节 / 编辑器常规）的优先级集中
   * 写在一处，新增视图时只加一行即可，不必在 if 链里层层找位置。顺序即优先级，与原实现一致：
   * 代码视图在前、编辑器常规兜底。判定用闭包延迟求值，读的是调用时的当前视图状态。
   */
  const FIND_ROUTES: { match: () => boolean; next: (backwards: boolean) => void }[] = [
    // 超大代码文件没有 CM（codeLargeText 非空），落到下面的编辑器常规通路
    { match: () => docKind === "code" && codeLargeText === null, next: findNextInCode },
    { match: () => docKind === "html" && htmlView === "source", next: findNextInSource },
    { match: () => docKind === "html", next: findNextInPreview },
    // 大文档分节通路的正文是虚拟化的，得先挂载目标分节才建得出 Range
    { match: () => isLargeDocMode(), next: findNextLarge },
    { match: () => true, next: findNextInEditor },
  ];

  function findNext(backwards = false): void {
    if (!findText) return;
    for (const route of FIND_ROUTES) {
      if (route.match()) {
        route.next(backwards);
        return;
      }
    }
  }

  function onFindInput(): void {
    findIdx = -1;
    largeHitSource = ""; // 查询条件变了，缓存的命中列表作废
    refreshFindCount(); // 输入即重算命中数并给全部命中上色
  }

  /** 切换三个匹配开关：写设置并立刻重算命中 */
  async function toggleFindFlag(flag: "case" | "word" | "regex"): Promise<void> {
    if (flag === "case") {
      findCase = !findCase;
      await saveSetting("findCase", findCase);
    } else if (flag === "word") {
      findWord = !findWord;
      await saveSetting("findWord", findWord);
    } else {
      findRegex = !findRegex;
      await saveSetting("findRegex", findRegex);
    }
    onFindInput();
  }

  /** 关闭查找栏：必须顺手清掉高亮，否则正文上会留下过期 Range 的色块 */
  function closeFind(): void {
    findOpen = false;
    findIdx = -1;
    clearFindHighlights();
    clearCodeFind(); // 代码视图的查询一并撤掉，否则 `.cm-searchMatch` 会留在正文上
  }

  function replaceOne(): void {
    if (browseMode) return; // 阅读模式只读
    if (!findText) return;
    if (docKind === "code") {
      replaceOneInCode();
      return;
    }
    if (docKind === "html") {
      if (htmlView === "preview") {
        replaceOneInPreview();
        return;
      }
      const el = sourceArea;
      const hits = stringHits(htmlSource);
      if (hits === null) {
        findStatus = t("正则表达式无效");
        return;
      }
      // 当前选中的内容与命中项文本一致才替换：否则先定位一次（与旧行为一致）
      const selected = el ? htmlSource.slice(el.selectionStart, el.selectionEnd) : "";
      const hit = selected ? hits.find((h) => h.index === el!.selectionStart && h.text === selected) : undefined;
      if (el && hit) {
        const text = expandReplacement(replaceText, hit.text, hit.groups);
        el.setRangeText(text, hit.index, hit.index + hit.text.length, "end");
        htmlSource = el.value;
        syncFromHtmlSource();
      }
      findNext(false);
      return;
    }
    const hits = editorHits();
    if (hits === null) {
      findStatus = t("正则表达式无效");
      return;
    }
    const current = findIdx >= 0 ? hits[findIdx] : undefined;
    // 用「选中内容 === 命中文本」判断是否还停在当前命中上：大小写不敏感与正则模式下
    // 不能用 findText 直接比对
    if (current && getEditorSelection() === current.text) {
      replaceEditorSelection(expandReplacement(replaceText, current.text, current.groups));
      syncFromEditor();
    }
    findNext(false);
  }

  function replaceAll(): void {
    if (browseMode) return; // 阅读模式只读
    if (!findText) return;
    if (docKind === "code") {
      replaceAllInCode();
      return;
    }
    if (docKind === "html") {
      if (htmlView === "preview") {
        replaceAllInPreview();
        return;
      }
      const hits = stringHits(htmlSource);
      if (hits === null) {
        findStatus = t("正则表达式无效");
        return;
      }
      if (hits.length === 0) {
        findStatus = "0 / 0";
        return;
      }
      htmlSource = findRegex
        ? htmlSource.replace(buildFindRegex()!, replaceText) // 正则模式用原生 replace：$1 / $& 展开由它负责
        : htmlSource.split(findText).join(replaceText);
      findStatus = t("已替换 {n} 处", { n: hits.length });
      syncFromHtmlSource();
      return;
    }

    const value = getEditorValue();
    const hits = stringHits(value);
    if (hits === null) {
      findStatus = t("正则表达式无效");
      return;
    }
    if (hits.length === 0) {
      findStatus = "0 / 0";
      return;
    }
    setEditorValue(
      findRegex ? value.replace(buildFindRegex()!, replaceText) : value.split(findText).join(replaceText),
    );
    findIdx = -1;
    findStatus = t("已替换 {n} 处", { n: hits.length });
    syncFromEditor();
  }

  /** 查找与替换共用同一条操作栏（替换栏额外提供替换输入与按钮） */
  async function openFind(): Promise<void> {
    findOpen = true;
    findIdx = -1;
    findStatus = "";
    await tick();
    document.querySelector<HTMLInputElement>(".findbar .f-input")?.focus();
    refreshFindCount(); // 打开时就把已有内容的命中数算出来
  }

  // ---- 主题（阶段 7）：用户显式选择优先并记忆，未设置时跟随系统 ----
  function applyAppTheme(dark: boolean): void {
    theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    setEditorTheme(dark); // 编辑器未初始化时为 no-op
    setCodeTheme(dark); // 代码视图未挂载时为 no-op
  }

  async function setThemeChoice(choice: "light" | "dark" | "system"): Promise<void> {
    if (choice === "system") {
      userThemeSet = false;
      applyAppTheme(window.matchMedia("(prefers-color-scheme: dark)").matches);
      await saveSetting("theme", null); // null → 下次启动回退「跟随系统」
      return;
    }
    userThemeSet = true;
    applyAppTheme(choice === "dark");
    await saveSetting("theme", choice);
  }

  // ---- 阅读排版（字体 / 字号 / 行距 / 文字色 / 护眼底色）----
  // 只服务 Markdown / 纯文本文档（见 onMount 里的加载与后面的 $effect）。

  /** 字体档位：value 为空串表示不覆盖，沿用 Vditor 自带字体栈 */
  const READER_FONTS: { id: string; label: string; value: string }[] = $derived([
    { id: "default", label: t("无衬线（默认）"), value: "" },
    { id: "yahei", label: t("微软雅黑"), value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
    { id: "song", label: t("宋体"), value: '"SimSun", "Songti SC", serif' },
    { id: "hei", label: t("黑体"), value: '"SimHei", "Heiti SC", sans-serif' },
    { id: "kai", label: t("楷体"), value: '"KaiTi", "Kaiti SC", serif' },
    { id: "mono", label: t("等宽"), value: '"Cascadia Mono", Consolas, "Courier New", monospace' },
  ]);

  const READER_SIZES = ["12px", "13px", "14px", "15px", "16px", "17px", "18px", "20px", "22px", "24px"];
  const READER_LINES = ["1.2", "1.4", "1.6", "1.8", "2", "2.4"];

  /** 文字颜色预设（护眼阅读常用：深灰而非纯黑，长时间看更柔和） */
  const READER_TEXT_COLORS = $derived([
    { label: t("深棕"), value: "#5b4636" },
    { label: t("黑色"), value: "#1a1a1a" },
    { label: t("夜间"), value: "#e8e8e8" },
  ]);

  /** 页面背景预设：米黄 / 护眼绿 / 淡蓝 / 淡灰 / 夜间 */
  const READER_BACKGROUNDS = $derived([
    { label: t("米黄"), value: "#f6efdc" },
    { label: t("护眼绿"), value: "#c9e7cb" },
    { label: t("淡蓝"), value: "#e3edf7" },
    { label: t("淡灰"), value: "#f0f0f0" },
    { label: t("夜间"), value: "#2b2b2b" },
  ]);

  /** 写入一项阅读排版设置；value 为空串 = 清除该项，回到默认样式 */
  async function setReaderOption(key: keyof ReaderStyle, value: string): Promise<void> {
    const next: ReaderStyle = { ...readerStyle };
    if (value) next[key] = value;
    else delete next[key];
    readerStyle = next;
    await saveSetting("readerStyle", next);
  }

  async function resetReaderStyle(): Promise<void> {
    readerStyle = {};
    await saveSetting("readerStyle", {});
  }

  // ---- 自定义 CSS 主题（批次八）----
  // 主题文件放在 %APPDATA% 的主题目录下，内容整体注入一个 style 节点，
  // 与明/暗档位是正交的两件事（自定义主题叠在明/暗之上）。

  /** 把自定义主题 CSS 写进 head 里的专用 style 节点（空串 = 不生效） */
  function applyUserThemeCss(css: string): void {
    let el = document.getElementById("md-studio-user-theme") as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = "md-studio-user-theme";
      document.head.appendChild(el);
    }
    el.textContent = css;
  }

  /** 读取主题目录；已选主题文件被删掉时自动回落默认并清掉设置 */
  async function refreshThemes(): Promise<void> {
    try {
      themeFiles = await loadThemes();
    } catch {
      themeFiles = [];
      return;
    }
    const hit = userTheme ? themeFiles.find((f) => f.name === userTheme) : undefined;
    applyUserThemeCss(hit?.css ?? "");
    if (userTheme && !hit) {
      userTheme = null;
      await saveSetting("userTheme", null);
    }
  }

  async function selectUserTheme(name: string | null): Promise<void> {
    userTheme = name;
    applyUserThemeCss(name ? themeFiles.find((f) => f.name === name)?.css ?? "" : "");
    await saveSetting("userTheme", name);
  }

  /** 打开主题目录（顺带刷新列表：用户常先打开文件夹放文件，再回来选） */
  async function openThemesFolder(): Promise<void> {
    try {
      await openThemeDir();
      await refreshThemes();
    } catch (e) {
      await showError(t("打开主题文件夹失败："), e);
    }
  }

  function toggleSkin(): void {
    skinOpen = !skinOpen;
    if (skinOpen) void refreshThemes();
  }

  // ---- 界面语言（批次八）----

  /** 切换界面语言：立即改 App 文案，并同步 Vditor 的 lang 选项 */
  async function selectLocale(next: Locale): Promise<void> {
    locale = next;
    setEditorLocale(vditorLang(next));
    document.documentElement.lang = next;
    await saveSetting("locale", next);
  }

  function switchEditorMode(mode: "ir" | "wysiwyg" | "sv"): void {
    if (getEditorMode() === mode) return;
    setEditorMode(mode);
    // 立即同步状态栏图标与菜单复选：靠编辑器的模式回调要等一拍，且回调只为兜住
    // 「工具栏下拉」那条路径，这里直接落值，反馈更跟手（回调稍后会再确认一次）。
    editorMode = mode;
  }

  function toggleEditorToolbar(): void {
    showToolbar = !showToolbar;
    setEditorToolbarVisible(showToolbar);
  }

  /** 表格整列对齐（批次七）。光标不在单元格内时 Vditor 无从判断列，给出提示 */
  async function alignTable(type: "left" | "center" | "right"): Promise<void> {
    if (alignTableColumn(type)) return;
    await messageDialog(t("请先把光标放到表格单元格内，再设置整列对齐。"), {
      title: "Sticho",
      kind: "info",
    });
  }

  async function toggleLineNumbers(): Promise<void> {
    showLineNumbers = !showLineNumbers;
    setLineNumbersVisible(showLineNumbers);
    await saveSetting("lineNumbers", showLineNumbers);
  }

  async function toggleTypewriter(): Promise<void> {
    typewriterOn = !typewriterOn;
    setTypewriterMode(typewriterOn);
    await saveSetting("typewriterMode", typewriterOn);
  }

  async function toggleParagraphFocus(): Promise<void> {
    paragraphFocus = !paragraphFocus;
    setParagraphFocusVisible(paragraphFocus);
    await saveSetting("paragraphFocus", paragraphFocus);
  }

  // ---- 自动保存与崩溃恢复（批次四；批次六起按标签逐个落 -）---
  /**
   * 落恢复草稿并记录会话（每 30 秒由定时器触发，退出前也会显式调一次）。
   *
   * 批次六起按标签逐个落：每个脏标签一份草稿（id = `d-<tab.id>`，与路径无关，
   * 同一文件在两个标签里各改各的也不会互相覆盖），正文取自各自的快照；
   * 同时把标签集写进会话，启动时据此整体恢复（见 tryRestoreSession）。
   *
   * **绝不改 `dirty`**：草稿只是磁盘外的兜底副本，标题的 `●` 与关窗拦截仍按
   * 「未保存」处理，否则用户会以为已经保存过了。
   */
  async function tickAutoSave(): Promise<void> {
    if (!autoSaveEnabled || busy || !tabsReady) return;
    captureActiveTab(); // 活跃标签的最新内容先回到快照，下面统一按快照落盘
    try {
      for (const tab of tabs) {
        if (!tab.dirty) continue;
        const payload = tab.content;
        if (!payload.trim()) continue; // 空文档没什么可恢复的
        const hash = `${payload.length}:${payload.slice(0, 64)}`;
        if (hash === tab.draftHash) continue; // 内容没变，省一次写盘
        await writeRecovery({
          id: tab.draftId,
          path: tab.path,
          title: tab.path ? fileName(tab.path) : t("未命名文档"),
          kind: tab.kind,
          encoding: tab.encoding,
          content: payload,
        });
        tab.draftHash = hash;
      }
    } catch {
      // 静默：恢复草稿属兜底机制，失败不能打断编辑。
      // （write_text_file 的「编码不可表示」这类错误也必须吞掉，否则每 30 秒弹一次框）
    }
    await saveSession();
  }

  async function toggleAutoSave(): Promise<void> {
    autoSaveEnabled = !autoSaveEnabled;
    await saveSetting("autoSave", autoSaveEnabled);
  }

  // ---- WebDAV 云同步（批次九）----

  /**
   * 连接参数被编辑：立刻作废本会话的验证结果。
   * 已开启的同步也一并停掉——宁可停掉，也不要用一份还没验证过的配置去上传。
   */
  function onDavInput(): void {
    davVerified = false;
    davTip = "";
    if (davEnabled) {
      davEnabled = false;
      void saveSetting("davEnabled", false);
    }
  }

  /** 落盘当前连接参数（输入框失焦、或测试连接成功后调用） */
  async function persistDavConfig(): Promise<void> {
    await Promise.all([
      saveSetting("davUrl", davUrl.trim()),
      saveSetting("davUser", davUser),
      // 密码不写 settings.json：改走 DPAPI 加密的 secrets.json（换用户/换机器无法解密）
      saveDavPassword(davPass),
      saveSetting("davRoot", davRoot.trim() || "/Sticho"),
    ]);
  }

  /**
   * 启动时读取 WebDAV 密码。
   *
   * 先读加密存储；为空再回落读旧版明文 davPass，读到了就立刻迁移（加密落盘 + 从
   * settings.json 删除明文），避免凭据长期留在可被备份/同步带走的设置文件里。
   */
  async function restoreDavPassword(): Promise<void> {
    const saved = await loadDavPassword().catch(() => null);
    if (saved) {
      davPass = saved;
      return;
    }
    const legacy = await loadSetting<string>("davPass");
    if (!legacy) return;
    davPass = legacy;
    await saveDavPassword(legacy);
    await deleteSetting("davPass");
  }

  /** 测试连接。成功才置 davVerified，从而放开同步开关 */
  async function testDav(): Promise<void> {
    if (davTesting) return;
    const cfg = davConfig;
    if (cfg.url === "") {
      davTip = t("请先填写服务器地址");
      return;
    }
    davTesting = true;
    davTip = t("测试中…");
    try {
      davTip = t(await webdavTest(cfg)); // Rust 侧给的是中文结论，这里按当前语言再翻一层
      davVerified = true;
      await persistDavConfig();
    } catch (e) {
      davVerified = false;
      davTip = t(e instanceof Error ? e.message : String(e));
    } finally {
      davTesting = false;
    }
  }

  async function toggleDavEnabled(): Promise<void> {
    if (!davReady) return;
    davEnabled = !davEnabled;
    davSyncState = "idle";
    davSyncTip = "";
    await saveSetting("davEnabled", davEnabled);
  }

  async function toggleDavVersioning(): Promise<void> {
    davVersioning = !davVersioning;
    await saveSetting("davVersioning", davVersioning);
  }

  async function setDavKeep(n: number): Promise<void> {
    davKeep = Math.min(10, Math.max(1, Math.round(n)));
    await saveSetting("davKeep", davKeep);
  }

  /** 切换云同步的冲突处理策略（copy = 另存副本，overwrite = 直接覆盖） */
  async function setDavConflictPolicy(p: "copy" | "overwrite"): Promise<void> {
    davConflictPolicy = p;
    await saveSetting("davConflictPolicy", p);
  }

  async function setHistoryKeep(n: number): Promise<void> {
    historyKeep = Math.min(200, Math.max(1, Math.round(n)));
    await saveSetting("historyKeep", historyKeep);
    await refreshHistory(); // 调小份数时立即反映当前文档的可回滚范围
  }

  /** 切换「默认打开模式」并持久化（只影响之后打开 / 新建的文档） */
  async function setDefaultOpenMode(mode: "read" | "edit"): Promise<void> {
    defaultOpenMode = mode;
    await saveSetting("defaultOpenMode", mode);
  }

  // ---- 配置文件保存位置（批次十）----

  /** 读取当前位置模式与根目录路径（启动时与切换后刷新界面用） */
  async function refreshDataLocation(): Promise<void> {
    try {
      const [mode, root] = await Promise.all([getDataLocation(), getDataRoot()]);
      dataLocation = mode;
      dataRootPath = root;
    } catch {
      // 拿不到就保持现状，不影响设置面板其他功能
    }
  }

  /**
   * 切换配置文件保存位置（系统目录 / 当前程序目录 / 指定目录）。
   *
   * 流程：预检目标目录可读写 →（失败即提示并回退）→ 询问是否迁移数据 → 提交切换。
   * 预检与提交失败都不会改动当前配置，界面保持在修改前的状态。
   */
  async function changeDataLocation(mode: DataLocationMode, path?: string): Promise<void> {
    if (locationBusy) return;
    // 已在该位置且没有换目录时直接返回（避免重复迁移）
    if (mode === dataLocation && (mode !== "custom" || path === dataRootPath)) return;

    locationBusy = true;
    locationTip = "";

    // 1. 预检目标目录可读写；失败：提示 + 回退（不改任何配置）
    try {
      await checkDataLocation(mode, path ?? null);
    } catch (e) {
      locationBusy = false;
      locationTipOk = false;
      locationTip = t(e instanceof Error ? e.message : String(e));
      await showError(t("目标目录不可用，已保持原配置："), e);
      return;
    }

    let switched = false;
    try {
      // 2. 询问是否迁移数据（取消则整体放弃）
      const answer = await askChoice(
        t("是否把现有配置数据迁移到新位置？选择「迁移」会把设置、恢复草稿、主题与 Pandoc 复制到新目录，并在完整迁移后清理旧目录。"),
        [
          { label: t("迁移"), value: "migrate", primary: true },
          { label: t("不迁移"), value: "keep" },
        ],
      );
      if (answer === null) return;

      // 3. 提交切换
      const result = await setDataLocation(mode, path ?? null, answer === "migrate");
      dataRootPath = result.root;
      dataLocation = mode;
      locationTipOk = true;
      locationTip =
        result.migrated && !result.complete
          ? t("已切换，但迁移不完整，原目录已保留为备份，重启后生效")
          : t("已切换，重启后生效");
      switched = true;
    } catch (e) {
      locationTipOk = false;
      locationTip = t(e instanceof Error ? e.message : String(e));
      await showError(t("切换失败："), e);
    } finally {
      locationBusy = false;
    }

    // 4. 成功切换后提示重启（确认后先检查未保存文档，再重启）
    if (switched) await promptRestartAfterSwitch();
  }

  /** 选择「指定目录」并切换过去 */
  async function pickCustomLocation(): Promise<void> {
    if (locationBusy) return;
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: t("选择配置文件保存目录"),
      });
      if (typeof picked !== "string") return; // 用户取消
      await changeDataLocation("custom", picked);
    } catch (e) {
      locationTipOk = false;
      locationTip = t(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * 逐个保存所有未保存的标签；返回是否全部保存成功。
   *
   * 用户取消「另存为」或保存失败时返回 false（调用方据此中止重启）。
   * 全程会切换标签，结束后回到原先的标签。
   */
  async function saveAllDirtyTabs(): Promise<boolean> {
    captureActiveTab();
    const start = activeIndex;
    for (let i = 0; i < tabs.length; i++) {
      if (!tabDirty(i)) continue;
      if (i !== activeIndex) {
        captureActiveTab();
        await activateTab(i);
      }
      await saveFile();
      if (tabDirty(i)) {
        if (activeIndex !== start) await activateTab(start); // 失败也回到原标签，避免界面跳走
        return false;
      }
    }
    if (activeIndex !== start) await activateTab(start);
    return true;
  }

  /** 重启前的保存检查：有未保存文档则先提示保存，处理完再重启 */
  async function restartWithSaveCheck(): Promise<void> {
    if (locationBusy) return;
    locationBusy = true;
    try {
      captureActiveTab();
      if (anyTabDirty()) {
        const dirtyCount = tabs.filter((_t, i) => tabDirty(i)).length;
        const answer = await askChoice(
          t("有 {n} 个文档尚未保存，是否保存后再重启？", { n: dirtyCount }),
          [
            { label: t("保存并重启"), value: "save", primary: true },
            { label: t("不保存，直接重启"), value: "discard" },
          ],
        );
        if (answer === null) return; // 取消重启
        if (answer === "save" && !(await saveAllDirtyTabs())) return; // 保存未完成：不重启
      }
      await restartApp();
    } catch (e) {
      locationTipOk = false;
      locationTip = t(e instanceof Error ? e.message : String(e));
      await showError(t("重启失败："), e);
    } finally {
      locationBusy = false;
    }
  }

  /** 切换配置位置后的「重启后生效」提示：确认即进入保存检查并重启 */
  async function promptRestartAfterSwitch(): Promise<void> {
    const ok = await confirmDialog(t("配置位置已更新，需重启后生效。是否现在重启？"), {
      title: "Sticho",
      kind: "info",
      okLabel: t("立即重启"),
      cancelLabel: t("稍后"),
    });
    if (ok) await restartWithSaveCheck();
  }

  /** 「立即重启」按钮：先确认，再做保存检查后重启 */
  async function doRestart(): Promise<void> {
    if (locationBusy) return;
    const ok = await confirmDialog(t("重启后新的配置位置才会生效。是否现在重启？"), {
      title: "Sticho",
      kind: "info",
      okLabel: t("立即重启"),
      cancelLabel: t("取消"),
    });
    if (ok) await restartWithSaveCheck();
  }

  /**
   * 上传串行队列：同一文件的两次保存不会交错 PUT。
   * 队列本身只做「接续」，失败已在内部消化，故末尾再挂一个 catch 兜底。
   */
  let davChain: Promise<void> = Promise.resolve();

  /**
   * 把刚落盘的文档上传一份到 WebDAV（类似 WPS 云同步）。
   *
   * 刻意不 await 进 busy：网络慢不该拖住本地保存；失败也只改状态栏与设置面板提示，
   * **绝不影响本地保存的结果**。正文由 Rust 侧直接读刚落盘的字节，与磁盘完全一致。
   */
  function syncToCloud(local: string): void {
    const cfg = davConfig;
    const keep = davVersioning ? davKeep : 0;
    const policy = davConflictPolicy;
    const record = davSyncIndex[local];
    const prev = record ? { size: record.size, modified: record.modified } : null;
    davSyncState = "busy";
    davSyncTip = "";
    davChain = davChain
      .then(async () => {
        try {
          const result = await webdavUpload(cfg, local, keep, policy, prev);
          davSyncTip = result.message;
          davSyncState = "idle";
          if (result.status === "conflict") {
            // 冲突：只在同目录另存了副本，原远端文件（含对方的改动）完好无损。
            // 刻意**不回填索引**——下次保存仍会再次判定冲突并另存，直到用户自行合并，
            // 这样绝不会把对方的内容悄悄覆盖掉。
            void messageDialog(result.message, { title: "Sticho", kind: "warning" });
          } else {
            // 正常上传：回填远端状态，作为下次「远端是否被别的设备改过」的比对基准
            davSyncIndex = {
              ...davSyncIndex,
              [local]: { remote: result.remote, size: result.size, modified: result.modified },
            };
            void saveSetting("davSyncIndex", davSyncIndex);
          }
        } catch (e) {
          davSyncState = "error";
          davSyncTip = e instanceof Error ? e.message : String(e);
        }
      })
      .catch(() => {
        davSyncState = "error";
      });
  }

  /**
   * 打开云端文档 / 某个历史版本，一律作为**未命名文档**打开。
   *
   * 远端路径不是本地路径，直接塞进 currentPath 会让下一次保存写到错误的本地位置，
   * 所以这里置空路径，让用户保存时走既有「另存为」流程落回本地。
   */
  async function openCloudDoc(remote: string, content: string): Promise<void> {
    const isHtml = /\.html?$/i.test(remote);
    await loadIntoFreshTab(async () => {
      currentPath = null;
      setDocumentPath(null);
      dirty = false;
      encoding = "utf-8"; // 云端正文按 UTF-8 取回（非 UTF-8 已由 Rust 侧挡下）
      if (isHtml) {
        docKind = "html";
        htmlSource = content;
        previewDoc = content;
        previewKey += 1;
        previewMutated = false;
        htmlView = "preview";
        htmlScripts = false;
      } else if (isCodePath(remote)) {
        htmlSource = "";
        previewDoc = "";
        previewMutated = false;
        await showCodeDoc(content, remote);
      } else {
        docKind = "markdown";
        htmlSource = "";
        previewDoc = "";
        previewMutated = false;
        setEditorValue(content);
      }
      await updateTitle();
      refreshSideNow();
    });
  }

  /** 保存成功后清掉活跃标签的草稿（磁盘文件已是最新，草稿没意义了） */
  function clearRecoveryDraft(): void {
    const tab = activeTab();
    if (!tab) return;
    tab.draftHash = "";
    void deleteRecovery(tab.draftId).catch(() => {});
  }

  /**
   * 会话恢复出来的标签只带元信息，正文第一次被激活时才读盘。
   *
   * 不在此处吞掉「文件已被删除」的异常：直接把路径清掉降级为未命名文档，
   * 用户至少能看到这个标签是空的，而不是启动时弹一串错误框。
   */
  async function loadTabContent(tab: DocTab): Promise<void> {
    tab.loaded = true;
    if (!tab.path) return;
    try {
      const file = await readTextFile(tab.path);
      tab.content = file.content;
      tab.encoding = file.encoding;
    } catch {
      tab.content = "";
      tab.path = null;
    }
  }

  /**
   * 启动时恢复上次退出时的标签集（批次六）。
   *
   * 标签集与各标签的未保存正文是分开存的：元信息在 settings 的 "session" 键，
   * 正文在各自的恢复草稿里。只有「至少有一个标签带未保存内容」时才弹框——
   * 全是干净标签时静默跳过，免得每次启动都被一张「要不要恢复上次的窗口」打扰。
   * 返回 true 表示本次启动已按会话处理过（不再走单草稿的兜底提示）。
   */
  async function tryRestoreSession(): Promise<boolean> {
    const session = await loadSetting<SessionState>("session").catch(() => undefined);
    const list = session?.tabs ?? [];
    if (list.length === 0) return false;
    const dirtyCount = list.filter((item) => item.dirty).length;
    if (dirtyCount === 0) return false;

    const ok = await confirmDialog(
      t("检测到上次退出时有 {n} 个标签未保存（共 {total} 个标签）。是否恢复这些标签？", { n: dirtyCount, total: list.length }),
      { title: "Sticho", kind: "warning", okLabel: t("恢复"), cancelLabel: t("丢弃") },
    );
    if (!ok) {
      for (const item of list) void deleteRecovery(item.draftId).catch(() => {});
      await saveSetting("session", { tabs: [], active: 0 });
      lastSessionJson = "";
      return true;
    }

    const built: DocTab[] = [];
    for (const item of list) {
      tabSeq += 1;
      const tab = newDocTab(tabSeq, "");
      tab.draftId = item.draftId; // 沿用旧草稿 id：恢复出来的标签继续往同一份草稿上写
      tab.kind = item.kind === "html" ? "html" : item.kind === "code" ? "code" : "markdown";
      tab.path = item.path;
      tab.encoding = item.encoding || "utf-8";
      tab.htmlView = item.htmlView === "source" ? "source" : "preview";
      tab.dirty = !!item.dirty;
      tab.loaded = false; // 正文先不读：会话恢复只带元信息，等这个标签被激活时再读盘
      const draft = item.dirty ? await readRecovery(item.draftId).catch(() => null) : null;
      if (draft !== null) {
        tab.content = draft;
        tab.loaded = true;
      }
      built.push(tab);
    }

    tabs = built;
    tabsReady = true;
    await activateTab(Math.max(0, Math.min(session?.active ?? 0, built.length - 1)));
    return true;
  }

  /**
   * 兜底的单草稿恢复：会话只覆盖「按会话正常退出的那次」，
   * 若 settings 因故没写成功（异常终止），还有可能留下草稿。
   *
   * 恢复后**不删草稿**：用户可能再次不保存就退出；草稿只在「手动保存成功」或
   * 用户显式选「丢弃」时删除。
   */
  async function tryRestoreDraft(): Promise<void> {
    const drafts = await listRecovery().catch(() => null); // 已按 saved_at 降序
    if (!drafts || drafts.length === 0) return; // 列不出草稿就算了，不能因兜底机制阻塞启动

    const latest = drafts[0];
    const when = new Date(latest.saved_at * 1000).toLocaleString("zh-CN", { hour12: false });
    const ok = await confirmDialog(
      t("检测到上次未正常退出的编辑内容（{title}，{when}）。是否恢复？", { title: latest.title, when }),
      { title: "Sticho", kind: "warning", okLabel: t("恢复"), cancelLabel: t("丢弃") },
    );
    if (!ok) {
      await deleteRecovery(latest.id).catch(() => {});
      return;
    }

    const content = await readRecovery(latest.id).catch(() => null);
    if (content === null) return; // 草稿读不出来（损坏/被清理），静默放弃

    if (latest.path) {
      try {
        if (latest.kind === "html") await openHtmlPath(latest.path);
        else if (latest.kind === "code") await openCodePath(latest.path);
        else await openPath(latest.path);
      } catch {
        // 原文件已被删除/移动：降级为未命名文档，内容仍要恢复
        currentPath = null;
        setDocumentPath(null);
        diskMtime = null;
      }
    } else {
      currentPath = null;
      setDocumentPath(null);
      diskMtime = null;
    }

    if (latest.kind === "html") {
      docKind = "html";
      htmlSource = content;
      previewDoc = content;
      previewMutated = false;
    } else if (latest.kind === "code") {
      await showCodeEditor(content, latest.path);
    } else {
      docKind = "markdown";
      setEditorValue(content);
    }
    encoding = latest.encoding;
    dirty = true; // 恢复的是未保存内容，必须标记未保存
    // 接管这份草稿：否则下一轮会另写一份新 id 的草稿，旧的从此成了再也无人认领的孤儿
    const tab = activeTab();
    if (tab) {
      tab.draftId = latest.id;
      tab.draftHash = `${content.length}:${content.slice(0, 64)}`;
    }
    await updateTitle();
    refreshSideNow();
  }

  // 代码视图的存活严格跟随 docKind：离开代码模式就销毁 CodeMirror 实例。
  // 覆盖层是条件渲染的，DOM 消失后 CM 还握着已脱离文档的节点与 ResizeObserver，不如显式收掉。
  $effect(() => {
    if (docKind !== "code") unmountCodeEditor();
  });

  // 行号只服务「正文即源码」的视图（见 lineNumbersSupported）：纯文本走 CodeMirror 自带的
  // lineNumbers()；Markdown 只在分屏预览（SV）与大文档分节阅读态由 Vditor 那套自绘行号栏承担
  // （它按 pre.vditor-reset 的块/行单元编号，对 CM 的 DOM 不适用）；超大代码文件的分节纯文本
  // 没有 CM，行号也归自绘行号栏。HTML 源码视图另有镜像叠层（见 htmlGutterOn）。
  // 打字机模式与段落聚焦在 Markdown / 纯文本两种模式下都支持（HTML 模式下光标在 iframe 里，
  // Vditor 正文既不被编辑也量不到光标）。
  $effect(() => {
    const md = docKind === "markdown";
    const code = docKind === "code";
    const gutter = (md && (editorMode === "sv" || largeReading)) || codeLargeText !== null;
    setLineNumbersVisible(showLineNumbers && gutter);
    setTypewriterMode(typewriterOn && md);
    setParagraphFocusVisible(paragraphFocus && md);
    setCodeTypewriter(typewriterOn && code);
    setCodeParagraphFocus(paragraphFocus && code);
    setCodeLineNumbers(showLineNumbers && code); // 未挂载时是 no-op
  });

  // HTML 源码行号的叠层：叠层可见时量一次宽度并挂上 ResizeObserver（宽度随窗口 / 侧栏变化），
  // 内容变化后把叠层滚到与 textarea 相同的位置（行高变了，仅靠 scroll 事件补不齐）。
  $effect(() => {
    if (!htmlGutterOn) return;
    void htmlSourceLines; // 依赖内容：每次重排后重新对齐滚动位置
    const ta = sourceArea;
    if (!ta) return;
    syncHtmlGutterMetrics();
    const ro = new ResizeObserver(() => syncHtmlGutterMetrics());
    ro.observe(ta);
    onHtmlSourceScroll();
    return () => ro.disconnect();
  });

  // 阅读排版：同样只服务 Markdown/TXT。HTML 文档显式传空设置（等价于移除样式），
  // 保证自带颜色的 HTML 文档一个像素都不受影响；代码视图只消费字号与行距。
  $effect(() => {
    setReaderStyle(docKind === "markdown" ? readerStyle : {});
    if (docKind === "code") applyCodeReaderStyle();
  });

  // 标签栏：切标签 / 增删标签后把活跃项平滑滚进可视区。标签超出宽度才需要滚动，
  // 否则容器本就装得下，滚一下反而会抖（故先比较 rect 再决定滚不滚）。
  $effect(() => {
    const index = activeIndex;
    void tabs.length;
    const container = tabsEl;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`.tab[data-index="${index}"]`);
    if (!el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.left < cRect.left) {
      container.scrollTo({ left: container.scrollLeft - (cRect.left - eRect.left) - 6, behavior: "smooth" });
    } else if (eRect.right > cRect.right) {
      container.scrollTo({ left: container.scrollLeft + (eRect.right - cRect.right) + 6, behavior: "smooth" });
    }
  });

  // ---- 帮助 ----
  /**
   * 快捷键一览（帮助菜单）：用表格呈现，按分类分组，两列「快捷键 / 功能」便于速查。
   *
   * 按键本身不翻译（键位跨语言一致），功能描述与分组名走 t()（中文原文即键）。
   */
  const SHORTCUT_GROUPS: { group: string; items: { keys: string; desc: string }[] }[] = [
    {
      group: "文件",
      items: [
        { keys: "Ctrl+N", desc: "新建标签" },
        { keys: "Ctrl+O", desc: "打开…" },
        { keys: "Ctrl+P", desc: "命令面板…" },
        { keys: "Ctrl+S", desc: "保存" },
        { keys: "Ctrl+Shift+S", desc: "另存为…" },
        { keys: "Ctrl+,", desc: "设置" },
        { keys: "Ctrl+Q", desc: "退出" },
      ],
    },
    {
      group: "标签",
      items: [
        { keys: "Ctrl+W", desc: "关闭标签" },
        { keys: "Ctrl+Tab", desc: "下一个标签" },
        { keys: "Ctrl+Shift+Tab", desc: "上一个标签" },
        { keys: "鼠标中键", desc: "点标签也可关闭" },
      ],
    },
    {
      group: "导出",
      items: [
        { keys: "Ctrl+Shift+E", desc: "导出为 Word 文档" },
        { keys: "Ctrl+Shift+P", desc: "导出为 PDF 文档" },
        { keys: "Ctrl+Shift+H", desc: "导出为 HTML 文档" },
        { keys: "Ctrl+Shift+T", desc: "导出为纯文本文件" },
      ],
    },
    {
      group: "编辑",
      items: [
        { keys: "Ctrl+Z", desc: "撤销" },
        { keys: "Ctrl+Y", desc: "重做" },
        { keys: "Ctrl+X", desc: "剪切" },
        { keys: "Ctrl+C", desc: "复制" },
        { keys: "Ctrl+V", desc: "粘贴" },
      ],
    },
    {
      group: "查找",
      items: [
        { keys: "Ctrl+F", desc: "查找" },
        { keys: "F3", desc: "查找下一个" },
        { keys: "Shift+F3", desc: "查找上一个" },
        { keys: "Ctrl+H", desc: "替换" },
      ],
    },
    {
      group: "段落",
      items: [
        { keys: "Ctrl+1~6", desc: "标题 1~6 级" },
        { keys: "Ctrl+0", desc: "正文" },
        { keys: "Ctrl+Shift+[", desc: "有序列表" },
        { keys: "Ctrl+Shift+]", desc: "无序列表" },
        { keys: "Ctrl+[", desc: "增加缩进" },
        { keys: "Ctrl+]", desc: "减少缩进" },
        { keys: "Ctrl+Shift+Q", desc: "引用" },
      ],
    },
    {
      group: "格式",
      items: [
        { keys: "Ctrl+B", desc: "加粗" },
        { keys: "Ctrl+I", desc: "斜体" },
        { keys: "Ctrl+K", desc: "链接" },
        { keys: "Ctrl+Shift+K", desc: "代码块" },
        { keys: "Ctrl+Shift+`", desc: "行内代码" },
        { keys: "Ctrl+Shift+M", desc: "行间公式" },
        { keys: "Ctrl+Shift+I", desc: "插入图片" },
        { keys: "Alt+Shift+5", desc: "删除线" },
      ],
    },
    {
      group: "视图",
      items: [
        { keys: "Ctrl+Shift+L", desc: "侧边栏" },
        { keys: "Ctrl+Shift+1", desc: "文档大纲" },
        { keys: "Ctrl+Shift+3", desc: "文件目录树" },
        { keys: "F8", desc: "段落聚焦" },
        { keys: "F9", desc: "打字机模式" },
        { keys: "F11", desc: "沉浸式全屏编辑" },
        { keys: "Ctrl+E", desc: "阅读模式" },
      ],
    },
    {
      group: "其他",
      items: [
        { keys: "Alt+F/E/P/O/V/H", desc: "展开对应菜单" },
        { keys: "Esc", desc: "关闭菜单与查找栏" },
      ],
    },
  ];

  function showShortcuts(): void {
    shortcutsOpen = true;
  }

  async function showAbout(): Promise<void> {
    await messageDialog(
      [
        `短笺 Sticho ${APP_VERSION}`,
        "",
        t("轻量级 Markdown / HTML 文档编辑器。"),
        t("支持 Markdown、Word、PDF、HTML 互转，全部转换在本机完成。"),
        "",
        t("基于 Tauri + Svelte + Vditor 构建。"),
        t("Word 转换由 Pandoc 独立进程完成（GPL-2.0，未随本程序分发）。"),
      ].join("\n"),
      { title: t("关于 Sticho"), kind: "info" },
    );
  }

  // ---- 菜单模型（阶段 10）----
  type MenuItem = {
    label?: string;
    sep?: boolean;
    shortcut?: string;
    disabled?: () => boolean;
    checked?: () => boolean;
    /** 复选（✓）还是单选（●）：同组互斥的项标 true，渲染成圆点以示「只选其一」 */
    radio?: boolean;
    action?: () => void | Promise<void>;
    sub?: MenuItem[];
    /** 动态子菜单（最近文件随列表变化，需在展开时求值） */
    dynamic?: () => MenuItem[];
    /** 悬停说明：鼠标停在菜单项上时用原生 tooltip 显示（disabled 项也要能看到，故配合 aria-disabled） */
    tip?: string;
  };

  type MenuDef = { id: string; label: string; key: string; items: MenuItem[]; readonlyLocked?: boolean };

  /**
   * 「视图 → 语法高亮语言」的子菜单项：自动（按扩展名）/ 纯文本 / 各语言，单选。
   *
   * 只在代码文件下有意义：Markdown 走 Lute、HTML 走文档模式，高亮与语言跟格式绑定。
   * 选中态与动作都在渲染/点击时求值（不在这里缓存路径），否则切换标签后圆点会指错文档。
   */
  function codeLangSubmenu(): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: t("自动（按扩展名）"),
        radio: true,
        checked: () => codeLangOverrides[codeLangKey(currentPath)] === undefined,
        action: () => void setCodeLang(undefined),
      },
      {
        label: t("纯文本"),
        radio: true,
        checked: () => codeLangOverrides[codeLangKey(currentPath)] === null,
        action: () => void setCodeLang(null),
      },
      { sep: true },
    ];
    for (const { id, name } of LANG_LIST) {
      items.push({
        label: name,
        radio: true,
        checked: () => codeLangOverrides[codeLangKey(currentPath)] === id,
        action: () => void setCodeLang(id),
      });
    }
    return items;
  }

  // 菜单文案随语言切换重建（$derived 读取 locale，切换后自动重渲染）
  const MENUS: MenuDef[] = $derived([
    {
      id: "file",
      label: t("文件"),
      key: "f",
      items: [
        { label: t("新建标签"), shortcut: "Ctrl+N", disabled: () => busy, action: newTab },
        { label: t("打开…"), shortcut: "Ctrl+O", disabled: () => busy, action: openFile },
        // 命令面板对齐 Typora 的「快速打开」（Ctrl+P）：同一处肌肉记忆，也顺手挡住 WebView2 的打印弹窗
        { label: t("命令面板…"), shortcut: "Ctrl+P", action: openCommandPalette },
        {
          label: t("打开最近文件"),
          disabled: () => recentFiles.length === 0,
          dynamic: () => [
            ...recentFiles.map((p) => ({ label: fileName(p), action: () => openRecent(p) })),
            { sep: true },
            { label: t("清除最近文件列表"), action: clearRecentFiles },
          ],
        },
        { sep: true },
        { label: t("保存"), shortcut: "Ctrl+S", disabled: () => busy, action: saveFile },
        { label: t("另存为…"), shortcut: "Ctrl+Shift+S", disabled: () => busy, action: saveFileAs },
        { sep: true },
        { label: t("关闭标签"), shortcut: "Ctrl+W", disabled: () => busy, action: () => closeTab(activeIndex) },
        { label: t("下一个标签"), shortcut: "Ctrl+Tab", disabled: () => tabs.length < 2, action: () => cycleTab(1) },
        { label: t("上一个标签"), shortcut: "Ctrl+Shift+Tab", disabled: () => tabs.length < 2, action: () => cycleTab(-1) },
        { label: t("关闭其他标签"), disabled: () => busy || tabs.length < 2, action: () => closeOtherTabs() },
        { sep: true },
        {
          label: t("导入"),
          disabled: () => busy,
          sub: [
            { label: t("导入 Word…"), action: importWord },
            { label: t("导入 PDF…"), action: importPdfFile },
            { label: t("导入 HTML 并转为 Markdown…"), action: importHtml },
          ],
        },
        {
          label: t("导出"),
          disabled: () => busy,
          sub: [
            { label: t("导出为 Word"), shortcut: "Ctrl+Shift+E", action: exportWord },
            { label: t("导出为 PDF"), shortcut: "Ctrl+Shift+P", action: exportPdfFile },
            { label: t("导出为 HTML"), shortcut: "Ctrl+Shift+H", action: exportHtmlFile },
            { label: t("导出为纯文本"), shortcut: "Ctrl+Shift+T", action: exportTxtFile },
            { sep: true },
            { label: t("导出为 LaTeX（.tex）"), action: exportLatexFile },
            { label: t("导出为 Epub（.epub）"), action: exportEpubFile },
          ],
        },
        { label: t("打印…"), action: () => void printDoc() },
        { sep: true },
        {
          label: t("编码"),
          disabled: () => busy,
          sub: [
            { label: t("自动检测"), action: () => applyEncoding(null) },
            { sep: true },
            ...ENCODINGS.map((enc) => ({
              label: enc.label,
              checked: () => encoding === enc.id,
              action: () => applyEncoding(enc.id),
            })),
          ],
        },
        { label: t("文件属性…"), action: showFileInfo },
        {
          // 本地版本历史：保存覆盖前自动留档，误改可就地回滚（离线、无需配置）
          label: t("文件历史"),
          disabled: () => busy || !currentPath || docKind === "code",
          dynamic: () =>
            historyEntries.length === 0
              ? [{ label: t("（暂无历史版本）"), disabled: () => true }]
              : historyEntries.map((h) => ({
                  label: `${formatStamp(h.saved_at)} · ${formatSize(h.size)}`,
                  action: () => void historyVersionMenu(h.file),
                })),
        },
        {
          // 恢复中心：统一浏览恢复草稿与全部文档的本地版本历史，可预览后恢复 / 另存 / 删除
          label: t("恢复中心…"),
          action: () => {
            recoveryOpen = true;
          },
        },
        { sep: true },
        // HTML 文档专属操作（从「视图」迁来）：只在打开 .html 时可用，编辑 Markdown 时整组置灰
        { label: t("HTML 预览"), disabled: () => docKind !== "html", checked: () => docKind === "html" && htmlView === "preview", action: () => setHtmlView("preview") },
        { label: t("HTML 源码"), disabled: () => docKind !== "html", checked: () => docKind === "html" && htmlView === "source", action: () => setHtmlView("source") },
        {
          label: t("执行文档脚本（JavaScript）"),
          disabled: () => docKind !== "html",
          checked: () => htmlScripts,
          action: toggleHtmlScripts,
        },
        { label: t("转为 Markdown 编辑"), disabled: () => docKind !== "html", action: () => void convertToMarkdown() },
        { sep: true },
        // 偏好设置对齐 Typora：放在「文件」菜单末尾、Ctrl+,
        { label: t("设置…"), shortcut: "Ctrl+,", action: () => { settingsOpen = true; } },
        { sep: true },
        { label: t("退出程序"), shortcut: "Ctrl+Q", action: exitApp },
      ],
    },
    {
      id: "edit",
      label: t("编辑"),
      key: "e",
      items: [
        { label: t("撤销"), shortcut: "Ctrl+Z", disabled: () => docKind === "html" || browseMode, action: undoEditor },
        { label: t("重做"), shortcut: "Ctrl+Y", disabled: () => docKind === "html" || browseMode, action: redoEditor },
        { sep: true },
        { label: t("剪切"), shortcut: "Ctrl+X", disabled: () => docKind === "html" || browseMode, action: cutSelection },
        { label: t("复制"), shortcut: "Ctrl+C", disabled: () => docKind === "html", action: copySelection },
        { label: t("粘贴"), shortcut: "Ctrl+V", disabled: () => docKind === "html" || browseMode, action: pasteClipboard },
        { sep: true },
        // HTML 文档模式下这几项由 textarea / 预览原生行为承担，查找替换三种视图均可用
        { label: t("查找…"), shortcut: "Ctrl+F", action: openFind },
        { label: t("查找下一个"), shortcut: "F3", action: () => findNext(false) },
        { label: t("查找上一个"), shortcut: "Shift+F3", action: () => findNext(true) },
        { label: t("替换…"), shortcut: "Ctrl+H", action: openFind },
      ],
    },
    {
      id: "paragraph",
      label: t("段落"),
      key: "p",
      readonlyLocked: true,
      items: [
        {
          label: t("标题"),
          sub: [1, 2, 3, 4, 5, 6].map((n) => ({
            label: t("{n} 级标题", { n }),
            shortcut: `Ctrl+${n}`,
            action: () => applyHeading(n),
          })),
        },
        // 正文对齐 Typora 的 Ctrl+0：清掉当前行的标题，回到普通段落
        { label: t("正文"), shortcut: "Ctrl+0", action: clearHeading },
        { sep: true },
        { label: t("无序列表"), shortcut: "Ctrl+Shift+]", action: () => applyFormat("list") },
        { label: t("有序列表"), shortcut: "Ctrl+Shift+[", action: () => applyFormat("ordered-list") },
        { label: t("任务列表"), action: () => applyFormat("check") },
        { sep: true },
        { label: t("增加缩进"), shortcut: "Ctrl+[", action: () => applyFormat("indent") },
        { label: t("减少缩进"), shortcut: "Ctrl+]", action: () => applyFormat("outdent") },
        { sep: true },
        { label: t("引用"), shortcut: "Ctrl+Shift+Q", action: () => applyFormat("quote") },
        { label: t("分隔线"), action: () => applyFormat("line") },
        {
          // 批次七：Vditor 只在 IR 模式的快捷键里提供整列对齐，这里提到菜单中
          label: t("对齐整列"),
          disabled: () => docKind !== "markdown",
          sub: [
            { label: t("左对齐"), action: () => void alignTable("left") },
            { label: t("居中对齐"), action: () => void alignTable("center") },
            { label: t("右对齐"), action: () => void alignTable("right") },
          ],
        },
      ],
    },
    {
      id: "format",
      label: t("格式"),
      key: "o",
      readonlyLocked: true,
      items: [
        { label: t("加粗"), shortcut: "Ctrl+B", action: () => applyFormat("bold") },
        { label: t("斜体"), shortcut: "Ctrl+I", action: () => applyFormat("italic") },
        { label: t("删除线"), shortcut: "Alt+Shift+5", action: () => applyFormat("strike") },
        { label: t("行内代码"), shortcut: "Ctrl+Shift+`", action: () => applyFormat("inline-code") },
        { sep: true },
        { label: t("链接"), shortcut: "Ctrl+K", action: () => applyFormat("link") },
        { label: t("插入图片"), shortcut: "Ctrl+Shift+I", action: () => insertLocalImage() },
        { label: t("表情"), action: () => applyFormat("emoji") },
        { sep: true },
        { label: t("代码块"), shortcut: "Ctrl+Shift+K", action: () => applyFormat("code") },
        { label: t("行间公式"), shortcut: "Ctrl+Shift+M", action: insertMathBlock },
        { label: t("Mermaid 图"), action: insertMermaidBlock },
        { label: t("表格"), action: () => applyFormat("table") },
        { sep: true },
        {
          // 只服务代码视图：美化 / 压缩按扩展名选工具，小工具面板与语言无关
          label: t("代码工具"),
          // 超大代码文件走只读分节纯文本，没有 CodeMirror 可改写，整组置灰
          disabled: () => docKind !== "code" || codeLargeText !== null,
          sub: [
            { label: t("JSON 美化"), action: () => applyCodeTool(prettyJson) },
            { label: t("JSON 压缩"), action: () => applyCodeTool(minifyJson) },
            { sep: true },
            { label: t("CSS 美化"), action: () => applyCodeTool(prettyCss) },
            { label: t("CSS 压缩"), action: () => applyCodeTool(minifyCss) },
            { sep: true },
            // JS 走安全子集：只重排缩进 / 只删空行，绝不合并行（见 lib/codeTools.ts）
            { label: t("JS 美化（安全子集）"), action: () => applyCodeTool(prettyJs) },
            { label: t("JS 压缩（安全子集）"), action: () => applyCodeTool(minifyJs) },
            { sep: true },
            { label: t("小工具…"), action: () => (codeToolsOpen = true) },
          ],
        },
      ],
    },
    {
      id: "view",
      label: t("视图"),
      key: "v",
      items: [
        // 阅读 / 编辑：只读开关，最常用，单独置顶
        { label: t("阅读模式"), shortcut: "Ctrl+E", checked: () => browseMode, action: () => void setBrowseMode(!browseMode) },
        { sep: true },
        // 文档模式：纯文本 / Markdown / HTML，三选一，决定用哪个渲染器。
        // 默认由后缀决定（见 openPath/openHtmlPath/openCodePath），这里可手动改当前标签；
        // 超大代码文件是只读分节视图，无可切换的渲染器，整组置灰。
        {
          label: t("文档模式"),
          sub: [
            { label: t("纯文本模式"), radio: true, disabled: () => busy || codeLargeText !== null, checked: () => docKind === "code", action: () => void setDocMode("code") },
            { label: t("Markdown 模式"), radio: true, disabled: () => busy || codeLargeText !== null, checked: () => docKind === "markdown", action: () => void setDocMode("markdown") },
            { label: t("HTML 模式"), radio: true, disabled: () => busy || codeLargeText !== null, checked: () => docKind === "html", action: () => void setDocMode("html") },
          ],
        },
        // 渲染模式：仅 Markdown 有效（IR / 所见即所得 / 分屏预览），三选一
        {
          label: t("渲染模式"),
          sub: [
            { label: t("即时渲染（IR）"), radio: true, disabled: () => docKind !== "markdown", checked: () => editorMode === "ir", action: () => switchEditorMode("ir") },
            { label: t("所见即所得（WYSIWYG）"), radio: true, disabled: () => docKind !== "markdown", checked: () => editorMode === "wysiwyg", action: () => switchEditorMode("wysiwyg") },
            { label: t("分屏预览（SV）"), radio: true, disabled: () => docKind !== "markdown", checked: () => editorMode === "sv", action: () => switchEditorMode("sv") },
          ],
        },
        { sep: true },
        // 侧边栏：显示开关 + 四个面板各自的勾选开关（默认全开；全关则侧边栏自动收起）
        {
          label: t("侧边栏"),
          sub: [
            {
              label: t("显示侧边栏"),
              shortcut: "Ctrl+Shift+L",
              checked: () => sidebarVisible,
              disabled: () => !sidebarVisible && enabledSidebarViews.length === 0,
              action: toggleSidebar,
            },
            { sep: true },
            { label: t("文件目录树"), shortcut: "Ctrl+Shift+3", checked: () => sidebarPanels.tree, action: () => void toggleSidebarPanel("tree") },
            { label: t("文档大纲"), shortcut: "Ctrl+Shift+1", checked: () => sidebarPanels.outline, action: () => void toggleSidebarPanel("outline") },
            { label: t("文件属性"), checked: () => sidebarPanels.props, action: () => void toggleSidebarPanel("props") },
            { label: t("跨文件搜索"), checked: () => sidebarPanels.search, action: () => void toggleSidebarPanel("search") },
          ],
        },
        { sep: true },
        // 编辑器显示：排版工具栏（仅 Markdown）/ 行号 / 语法高亮（仅纯文本）
        {
          label: t("显示排版工具栏"),
          checked: () => showToolbar,
          disabled: () => docKind !== "markdown",
          action: toggleEditorToolbar,
          tip: t("仅在 Markdown 模式下可用：显示或隐藏正文上方的排版工具栏。"),
        },
        {
          label: t("显示行号"),
          checked: () => showLineNumbers && lineNumbersSupported,
          disabled: () => !lineNumbersSupported,
          action: toggleLineNumbers,
          tip: lineNumbersSupported
            ? t("在正文左侧显示行号。")
            : t("当前模式不支持行号显示（仅纯文本、Markdown 分屏预览与 HTML 源码视图支持）。"),
        },
        {
          label: t("语法高亮语言"),
          disabled: () => docKind !== "code" || codeLargeText !== null,
          sub: codeLangSubmenu(),
          tip: t("仅在纯文本模式下可用：指定代码着色的语言，「自动」按文件扩展名判断。"),
        },
        { sep: true },
        // 专注写作：打字机 / 段落聚焦 / 沉浸式全屏，都是「让注意力回到正文」的显示模式
        {
          label: t("打字机模式"),
          shortcut: "F9",
          checked: () => typewriterOn && docKind !== "html",
          disabled: () => docKind === "html",
          action: toggleTypewriter,
        },
        {
          label: t("段落聚焦"),
          shortcut: "F8",
          checked: () => paragraphFocus && docKind !== "html",
          disabled: () => docKind === "html",
          action: toggleParagraphFocus,
        },
        { label: t("沉浸式全屏编辑"), shortcut: "F11", checked: () => isEditorFullscreen(), action: toggleEditorFullscreen },
      ],
    },
    {
      id: "help",
      label: t("帮助"),
      key: "h",
      items: [
        { label: t("入门指南…"), action: () => (welcomeOpen = true) },
        { label: t("快捷键一览…"), action: showShortcuts },
        { sep: true },
        { label: t("导出诊断信息…"), action: exportDiagnosticsReport },
        { sep: true },
        { label: t("关于 Sticho…"), action: showAbout },
      ],
    },
  ]);

  function toggleMenu(id: string): void {
    const willOpen = menuOpen !== id;
    menuOpen = willOpen ? id : null;
    subOpen = null;
    // 展开「文件」菜单时刷新历史版本列表，供「文件历史」动态子菜单使用
    if (willOpen && id === "file") void refreshHistory();
  }

  function runMenuItem(item: MenuItem): void {
    // 菜单项改用 aria-disabled（原生 disabled 会吞掉鼠标事件，悬停说明就看不到了），
    // 因此这里必须自己挡住不可用项的动作。
    if (item.disabled?.()) return;
    menuOpen = null;
    subOpen = null;
    void item.action?.();
  }

  // ---- 命令面板（批次四，Ctrl+P）----

  /**
   * 把菜单树拍平成命令列表：展开 sub 与 dynamic 子项，跳过分隔线、无动作项与当前不可用的项。
   * dynamic 在每次打开面板时求值，最近文件 / 文件历史这类动态子菜单才能拿到最新数据。
   */
  function flatMenuItems(): PaletteCommand[] {
    const out: PaletteCommand[] = [];
    let seq = 0;
    const walk = (items: MenuItem[], category: string): void => {
      for (const item of items) {
        if (item.sep || !item.label) continue;
        // 子菜单：本身不执行，作为分类前缀继续展开
        if (item.sub) {
          walk(item.sub, `${category} › ${item.label}`);
          continue;
        }
        // 动态子菜单：展开时求值；父项不可用则整组跳过
        if (item.dynamic) {
          if (item.disabled?.()) continue;
          walk(item.dynamic(), `${category} › ${item.label}`);
          continue;
        }
        if (!item.action || item.disabled?.()) continue;
        out.push({
          id: `cmd-${seq++}`,
          label: item.label,
          category,
          shortcut: item.shortcut,
          run: () => runMenuItem(item),
        });
      }
    };
    for (const menu of MENUS) walk(menu.items, menu.label);
    return out;
  }

  function openCommandPalette(): void {
    menuOpen = null;
    subOpen = null;
    paletteCommands = flatMenuItems();
    paletteOpen = true;
  }

  // ---- 入门指南（批次四）----

  /** 关闭入门指南并记住「已看过」，不再自动弹出（帮助菜单仍可重开） */
  function dismissWelcome(): void {
    welcomeOpen = false;
    void saveSetting("welcomeShown", true);
  }

  // ---- 跨文件搜索（批次四）----

  /**
   * 编译跨文件搜索用的正则：**非全局**——复用 exec 取首个匹配位置，非全局才无 lastIndex 状态。
   * 语法有误返回 null（由调用方给提示）。
   */
  function compileSearchRegex(source: string, caseSensitive: boolean): RegExp | null {
    try {
      return new RegExp(source, caseSensitive ? "" : "i");
    } catch {
      return null;
    }
  }

  /**
   * 在当前目录树根内搜索。查询为空则清空结果；
   * 用自增序号丢弃过期请求：快速输入时先发的慢请求不会覆盖后发的快结果。
   *
   * 正则模式：Rust 侧只认字面量（不引 regex crate），先抽一段「必然出现」的字面量做粗筛，
   * 再用完整正则在**前端**对候选行二次匹配，去掉粗筛带来的误报。
   */
  async function runSearch(query: string, caseSensitive: boolean, regex: boolean): Promise<void> {
    if (!treeRoot) return;
    searchQuery = query;
    searchCaseSensitive = caseSensitive;
    searchRegex = regex;

    const clear = (message: string): void => {
      searchGroups = [];
      searchFileCount = 0;
      searchTruncated = false;
      searchError = message;
    };

    if (query === "") {
      clear("");
      return;
    }

    const re = regex ? compileSearchRegex(query, caseSensitive) : null;
    let needle = query;
    if (regex) {
      if (!re) {
        clear(t("正则表达式语法有误。"));
        return;
      }
      needle = literalAnchor(query);
      if (needle === "") {
        clear(
          t("该正则里没有可直接搜索的字面量（文字 / 数字 / 符号），无法先缩小范围。请在正则里补上一段确定的文字。"),
        );
        return;
      }
    }

    const seq = ++searchSeq;
    searchBusy = true;
    try {
      const res = await searchFiles(treeRoot, needle, caseSensitive, 500);
      if (seq !== searchSeq) return;
      if (re) {
        // 二次匹配：粗筛按字面量返回的行里，只保留整行真的命中正则的，并回填命中列号
        const hits: SearchHit[] = [];
        for (const hit of res.hits) {
          const m = re.exec(hit.text);
          if (m) hits.push({ ...hit, column: hit.text.slice(0, m.index).length });
        }
        searchGroups = groupSearchHits(hits);
      } else {
        searchGroups = groupSearchHits(res.hits);
      }
      searchFileCount = res.files;
      searchTruncated = res.truncated;
      searchError = "";
    } catch (e) {
      if (seq !== searchSeq) return;
      searchError = e instanceof Error ? e.message : String(e);
      searchGroups = [];
    } finally {
      if (seq === searchSeq) searchBusy = false;
    }
  }

  /** 点击搜索结果：打开对应文件，并把视图定位到该命中处 */
  async function openSearchHit(hit: SearchHit): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const ext = extOf(hit.path);
      if (ext === "html" || ext === "htm") await loadIntoFreshTab(() => openHtmlPath(hit.path));
      else if (isCodePath(hit.path)) await loadIntoFreshTab(() => openCodePath(hit.path));
      else await loadIntoFreshTab(() => openPath(hit.path));
      await revealSearchHit(hit);
    } catch (e) {
      await showError(t("打开失败："), e);
    } finally {
      busy = false;
    }
  }

  /**
   * 把视图定位到命中所在位置。
   *
   * 复用既有查找通路（Markdown/HTML/代码/大文档四条都覆盖），做法是：临时打开查找状态 →
   * 按查询算出命中列表 → 前进到第 occurrence 处 → 立即收起查找状态。整个过程同步完成，
   * Svelte 在同一拍内把 findOpen 从 true 又置回 false，查找栏不会闪出来。
   * 取不到精确行号时只是滚动到该文件的第一处命中，属于可接受的降级。
   */
  async function revealSearchHit(hit: SearchHit): Promise<void> {
    const group = searchGroups.find((g) => g.path === hit.path);
    const occurrence = group ? group.hits.indexOf(hit) : 0;
    const prevText = findText;
    const prevCase = findCase;
    const prevIdx = findIdx;

    findText = searchQuery;
    findCase = searchCaseSensitive;
    findWord = false;
    findRegex = searchRegex; // 定位沿用搜索时的匹配语义（字面量 / 正则）
    findIdx = -1;
    // Vditor / CodeMirror 的正文渲染是异步的，等一拍再收集命中，否则拿到空列表
    await new Promise((resolve) => window.setTimeout(resolve, 120));

    findOpen = true; // 命中收集依赖 findOpen 为真（refreshFindCount 的门槛）
    refreshFindCount();
    for (let i = 0; i <= occurrence; i++) findNext(false);

    // 收拾临时查找状态：保留滚动/选中位置，清掉高亮与计数
    findOpen = false;
    findIdx = -1;
    clearFindHighlights();
    clearCodeFind();
    findText = prevText;
    findCase = prevCase;
    findIdx = prevIdx;
  }

  // ---- 快捷键 ----
  function onKeydown(e: KeyboardEvent): void {
    // Esc：优先关闭菜单 / 查找栏
    if (e.key === "Escape") {
      if (diffView) {
        diffView = null;
        e.preventDefault();
      } else if (paletteOpen) {
        paletteOpen = false;
        e.preventDefault();
      } else if (welcomeOpen) {
        dismissWelcome();
        e.preventDefault();
      } else if (choiceState) {
        resolveChoice(null);
        e.preventDefault();
      } else if (recoveryOpen) {
        recoveryOpen = false;
        e.preventDefault();
      } else if (settingsOpen) {
        settingsOpen = false;
        e.preventDefault();
      } else if (shortcutsOpen) {
        shortcutsOpen = false;
        e.preventDefault();
      } else if (codeToolsOpen) {
        codeToolsOpen = false;
        e.preventDefault();
      } else if (tabMenu) {
        tabMenu = null;
        e.preventDefault();
      } else if (menuOpen) {
        menuOpen = null;
        subOpen = null;
        e.preventDefault();
      } else if (skinOpen) {
        skinOpen = false;
        e.preventDefault();
      } else if (findOpen) {
        closeFind();
        e.preventDefault();
      }
      return;
    }

    // Alt+Shift+5：删除线（对齐 Typora）。必须排在 Alt+字母 之前——那个分支会吞掉所有 Alt 组合键
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "Digit5") {
      e.preventDefault();
      if (docKind === "markdown") applyFormat("strike");
      return;
    }

    // Alt+字母：展开对应一级菜单（文件/编辑/段落/格式/视图/帮助）
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const hit = MENUS.find((m) => m.key === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        toggleMenu(hit.id);
      }
      return;
    }

    // 功能键：F3 查找下一个 / F8 段落聚焦 / F9 打字机 / F11 沉浸式全屏（对齐 Typora）
    if (e.key === "F3") {
      e.preventDefault();
      findNext(e.shiftKey);
      return;
    }

    if (e.key === "F8") {
      e.preventDefault();
      void toggleParagraphFocus();
      return;
    }

    if (e.key === "F9") {
      e.preventDefault();
      void toggleTypewriter();
      return;
    }

    if (e.key === "F11") {
      e.preventDefault();
      void toggleEditorFullscreen();
      return;
    }

    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();

    // 方括号 / 反引号 / 数字键按住 Shift 时 e.key 会变成 { } ~ ! #，用字符比较会漏判，
    // 这几组一律按物理键位 e.code 判定（对齐 Typora 的方括号与反引号组合）
    if (e.code === "BracketLeft" && docKind === "markdown") {
      e.preventDefault();
      applyFormat(e.shiftKey ? "ordered-list" : "indent");
      return;
    }
    if (e.code === "BracketRight" && docKind === "markdown") {
      e.preventDefault();
      applyFormat(e.shiftKey ? "list" : "outdent");
      return;
    }
    if (e.code === "Backquote" && e.shiftKey && docKind === "markdown") {
      e.preventDefault();
      applyFormat("inline-code");
      return;
    }
    if (e.shiftKey && e.code === "Digit1") {
      // Ctrl+Shift+1：文档大纲（对齐 Typora）
      e.preventDefault();
      void showSidebarView("outline");
      return;
    }
    if (e.shiftKey && e.code === "Digit3") {
      // Ctrl+Shift+3：文件目录树（对齐 Typora）
      e.preventDefault();
      void showSidebarView("tree");
      return;
    }

    if (key === "n" && !e.shiftKey) {
      e.preventDefault();
      void newTab();
    } else if (key === "tab") {
      // Ctrl+Tab / Ctrl+Shift+Tab：标签间循环。Vditor 在 IR 里也用 Tab 缩进，
      // 但带 Ctrl 的组合键不是编辑动作，拦下来不会影响正文输入
      e.preventDefault();
      void cycleTab(e.shiftKey ? -1 : 1);
    } else if (key === "w" && !e.shiftKey) {
      e.preventDefault();
      void closeTab(activeIndex);
    } else if (key === "o" && !e.shiftKey) {
      e.preventDefault();
      void openFile();
    } else if (key === "s" && !e.shiftKey) {
      e.preventDefault();
      void saveFile();
    } else if (key === "s" && e.shiftKey) {
      e.preventDefault();
      void saveFileAs();
    } else if (key === "q" && !e.shiftKey) {
      e.preventDefault();
      void exitApp();
    } else if (key === "q" && e.shiftKey) {
      // Ctrl+Shift+Q：引用（对齐 Typora）；退出改由 Ctrl+Q 独占
      e.preventDefault();
      if (docKind === "markdown") applyFormat("quote");
    } else if (key === "p" && !e.shiftKey) {
      // Ctrl+P：命令面板，对齐 Typora 的「快速打开」，同时挡住 WebView2 的打印弹窗
      e.preventDefault();
      openCommandPalette();
    } else if (key === "k" && !e.shiftKey) {
      // Ctrl+K：链接（对齐 Typora）
      e.preventDefault();
      if (docKind === "markdown") applyFormat("link");
    } else if (key === "k" && e.shiftKey) {
      // Ctrl+Shift+K：代码块（对齐 Typora）
      e.preventDefault();
      if (docKind === "markdown") applyFormat("code");
    } else if (key === "i" && e.shiftKey) {
      // Ctrl+Shift+I：插入图片（对齐 Typora）
      e.preventDefault();
      if (docKind === "markdown") insertLocalImage();
    } else if (key === "m" && e.shiftKey) {
      // Ctrl+Shift+M：行间公式（对齐 Typora）
      e.preventDefault();
      if (docKind === "markdown") insertMathBlock();
    } else if (key === "l" && e.shiftKey) {
      // Ctrl+Shift+L：显示 / 隐藏侧边栏（对齐 Typora）
      e.preventDefault();
      void toggleSidebar();
    } else if (key === "f" && !e.shiftKey) {
      e.preventDefault();
      void openFind();
    } else if (key === "h" && !e.shiftKey) {
      e.preventDefault();
      void openFind();
    } else if (key === "e" && !e.shiftKey) {
      // Ctrl+E：阅读 / 编辑模式互切。Vditor 内部未占用该组合键
      e.preventDefault();
      void setBrowseMode(!browseMode);
    } else if (key === "e" && e.shiftKey) {
      e.preventDefault();
      void exportWord();
    } else if (key === "p" && e.shiftKey) {
      e.preventDefault();
      void exportPdfFile();
    } else if (key === "h" && e.shiftKey) {
      e.preventDefault();
      void exportHtmlFile();
    } else if (key === "t" && e.shiftKey) {
      e.preventDefault();
      void exportTxtFile();
    } else if (key === "," && !e.shiftKey) {
      // Ctrl+,：偏好设置（对齐 Typora）
      e.preventDefault();
      settingsOpen = true;
    } else if (docKind === "markdown" && !e.shiftKey && key === "0") {
      // Ctrl+0：正文，清除当前行的标题（对齐 Typora）
      e.preventDefault();
      clearHeading();
    } else if (docKind === "markdown" && !e.shiftKey && /^[1-6]$/.test(key)) {
      // Ctrl+1~6 是 Markdown 标题快捷方式；代码模式下必须忽略，
      // 否则会改到被覆盖层挡住的 Vditor，把代码文件白白标成「未保存」
      e.preventDefault();
      applyHeading(Number(key));
    }
  }

  // 点击菜单栏/面板外部时收起
  function onWindowClick(e: MouseEvent): void {
    if (!(e.target as Element | null)?.closest?.(".menu-root")) {
      menuOpen = null;
      subOpen = null;
    }
    if (!(e.target as Element | null)?.closest?.(".skin-root")) {
      skinOpen = false;
    }
    if (!(e.target as Element | null)?.closest?.(".encoding-wrap")) {
      encodingOpen = false;
    }
    if (!(e.target as Element | null)?.closest?.(".lang-wrap")) {
      codeLangOpen = false;
    }
    if (!(e.target as Element | null)?.closest?.(".tab-menu")) {
      tabMenu = null;
    }
  }

  // ---- 拖拽导入（阶段 7）：md/html 直接打开，docx/pdf 走导入管道 ----
  async function handleDroppedFiles(paths: string[]): Promise<void> {
    if (busy || paths.length === 0) return;
    const path = paths[0]!;
    const ext = extOf(path);
    busy = true;
    try {
      if (ext === "md" || ext === "markdown") {
        await loadIntoFreshTab(() => openPath(path));
      } else if (ext === "html" || ext === "htm") {
        await loadIntoFreshTab(() => openHtmlPath(path));
      } else if (isCodePath(path)) {
        await loadIntoFreshTab(() => openCodePath(path));
      } else if (ext === "docx") {
        await importWordPath(path);
      } else if (ext === "pdf") {
        // 拖拽即意图明确：跳过「继续吗」确认，仅保留结果/错误提示
        await importPdfPath(path);
      } else {
        await messageDialog(t("暂不支持该文件类型（.{ext}），仅支持 md / html / docx / pdf / 代码文件。", { ext }), {
          title: "Sticho",
          kind: "info",
        });
      }
    } catch (e) {
      await showError(t("打开失败："), e);
    } finally {
      busy = false;
    }
  }

  // ---- 生命周期 ----
  onMount(() => {
    const win = getCurrentWindow();

    void (async () => {
      // 启动配置一次性读回：此前二十个键逐个 await 是二十次串行 IPC，整体拖慢首帧
      const s = await loadAllSettings();
      // 启动配置：主题（显式设置 > 系统偏好）、最近文件、侧边栏、文件关联
      const savedTheme = s["theme"] as "light" | "dark" | undefined;
      // savedTheme 是字符串 "light"/"dark"，不能直接当布尔用："light" 同样是真值，
      // 原写法 savedTheme ?? matchMedia(...) 会让「存过浅色」也走 applyAppTheme(true) 渲染成深色。
      // 这里显式换算：设置里只有明确存了 light/dark 才算用户显式选择，否则跟随系统。
      userThemeSet = savedTheme === "light" || savedTheme === "dark";
      applyAppTheme(
        userThemeSet
          ? savedTheme === "dark"
          : window.matchMedia("(prefers-color-scheme: dark)").matches,
      );
      // 界面语言（批次八）：先读设置再初始化编辑器，让 Vditor 一次就用对语言
      locale = (s["locale"] as Locale | undefined) ?? "zh-CN";
      setEditorLocale(vditorLang(locale));
      document.documentElement.lang = locale;
      userTheme = (s["userTheme"] as string | undefined) ?? null;
      recentFiles = (s["recentFiles"] as string[] | undefined) ?? [];
      sidebarVisible = (s["sidebarVisible"] as boolean | undefined) ?? true;
      sidebarView = (s["sidebarView"] as SidebarView | undefined) ?? "outline";
      // 面板开关：与默认值合并，兼容旧配置（没有该键时四项全开）
      sidebarPanels = { tree: true, outline: true, props: true, search: true, ...(s["sidebarPanels"] as Partial<Record<SidebarView, boolean>> | undefined) };
      // 四个面板全关时侧边栏没有内容可显示，强制收起（旧配置可能存着 sidebarVisible=true）
      if (enabledSidebarViews.length === 0) sidebarVisible = false;
      // 上次停留的面板被关掉时，落回第一个仍开启的面板
      else if (!sidebarPanels[sidebarView]) sidebarView = enabledSidebarViews[0]!;
      // 行号的开合统一由下方按「当前视图是否支持」的门控 $effect 落地，这里只取值，
      // 否则会在 IR / 所见即所得这类不支持行号的视图里把它硬打开
      showLineNumbers = (s["lineNumbers"] as boolean | undefined) ?? true;
      typewriterOn = (s["typewriterMode"] as boolean | undefined) ?? false;
      paragraphFocus = (s["paragraphFocus"] as boolean | undefined) ?? false;
      setTypewriterMode(typewriterOn);
      setParagraphFocusVisible(paragraphFocus);
      // 阅读排版（字体 / 字号 / 行距 / 文字色 / 护眼底色）：只对 Markdown / 纯文本生效
      readerStyle = (s["readerStyle"] as ReaderStyle | undefined) ?? {};
      autoSaveEnabled = (s["autoSave"] as boolean | undefined) ?? true;
      defaultOpenMode = (s["defaultOpenMode"] as "read" | "edit" | undefined) ?? "read";
      findCase = (s["findCase"] as boolean | undefined) ?? false;
      findWord = (s["findWord"] as boolean | undefined) ?? false;
      findRegex = (s["findRegex"] as boolean | undefined) ?? false;
      // WebDAV 云同步（批次九）：连接参数与开关；davVerified 不持久化见状态声明处的说明
      davUrl = (s["davUrl"] as string | undefined) ?? "";
      davUser = (s["davUser"] as string | undefined) ?? "";
      davRoot = (s["davRoot"] as string | undefined) ?? "/Sticho";
      davEnabled = (s["davEnabled"] as boolean | undefined) ?? false;
      davVersioning = (s["davVersioning"] as boolean | undefined) ?? false;
      davKeep = (s["davKeep"] as number | undefined) ?? 3;
      historyKeep = (s["historyKeep"] as number | undefined) ?? 20;
      davConflictPolicy = (s["davConflictPolicy"] as "copy" | "overwrite" | undefined) ?? "copy";
      davSyncIndex =
        (s["davSyncIndex"] as
          | Record<string, { remote: string; size: number; modified: number }>
          | undefined) ?? {};
      // 入门指南（批次四）：只在首次启动弹出；看过之后写 welcomeShown，帮助菜单仍可重开
      const welcomeShown = (s["welcomeShown"] as boolean | undefined) ?? false;

      // 主题与语言已就绪：界面壳此刻可以亮出来了，编辑器与主题目录的加载
      // 不再挡住窗口出现（tauri.conf.json 里 visible:false，这里负责首次 show）。
      // 用 setTimeout 而非 rAF：隐藏窗口的 rAF 可能被 Chromium 节流到不触发。
      // 失败必须留日志：show 需要 core:window:allow-show 权限，漏配时曾是静默失败。
      await tick();
      window.setTimeout(() => {
        win.show().catch((e) => console.error("[sticho] 亮窗失败：", e));
      }, 0);

      // 自定义主题（批次八）：读主题目录，已选主题立即注入 head
      await refreshThemes();
      // 密码走加密存储，并顺带把旧版留在 settings.json 里的明文迁移走
      await restoreDavPassword();
      // 配置文件保存位置（批次十）：只读展示当前根目录，位置本身由 Rust 引导文件决定
      await refreshDataLocation();

      const host = document.getElementById("editor-host")!;
      // 打开即阅读模式：先把只读意图写进编辑器层（此时正文元素还没建好，
      // 真正的 disabled() 由 editor.ts 在就绪回调里补一次）
      setEditorReadonly(true);
      void initEditor(host, WELCOME, theme === "dark");
      onEditorChange(() => syncFromEditor());
      // 渲染模式变化（工具栏下拉或菜单）：同步状态栏图标与视图菜单复选
      onEditorModeChange((mode) => (editorMode = mode));
      // 大文档走分节渲染通路时（editor.ts 自动判定），把应用层拉回阅读模式：
      // 那条通路只有只读的分节正文，界面必须如实反映「现在是阅读态」。
      onLargeModeChange((active) => {
        largeReading = active; // 行号适用性判定要用（见 lineNumbersSupported）
        if (active) resetToBrowseMode();
      });
      // 大文档的正文随滚动挂载 / 卸载分节，查找高亮的 Range 会随之失效，重画一次
      onLargeRenderChange(() => scheduleLargeFindRepaint());
      await updateTitle();
      void loadAssocState();

      // Vditor 异步加载资源，初始化完成前读写内容会抛错（侧边栏大纲、启动文件都要用到）
      await whenEditorReady();
      tabsReady = true; // 此刻起才允许把编辑器正文搬进标签快照
      refreshSideNow();

      // 文件关联后双击文档启动：命令行带进来的文件直接打开
      const startup = await getStartupFile();
      if (startup) {
        const ext = extOf(startup);
        try {
          await loadIntoFreshTab(async () => {
            if (ext === "html" || ext === "htm") await openHtmlPath(startup);
            else if (isCodePath(startup)) await openCodePath(startup);
            else await openPath(startup);
          });
        } catch (e) {
          await showError(t("打开启动文件失败："), e);
        }
      } else if (!(await tryRestoreSession())) {
        // 没有指定启动文件时才查恢复内容：双击文档进来的是「开这篇文件」的意图，
        // 此时再弹恢复提示会跟着用户的实际操作打架。
        // 先按会话整体恢复标签集，会话里没有未保存内容时再退回单草稿的兜底提示。
        await tryRestoreDraft();
      }

      // 环境自检（用户要求）：pandoc 缺失时提示一次并可一键下载。
      // 放在最后，避免与上面的会话恢复 / 启动文件对话框抢焦点。
      await checkPandocOnStartup();

      // 入门指南（批次四）：首次启动弹一次，与上面的对话框顺序出现，避免叠在一起
      if (!welcomeShown) welcomeOpen = true;
    })();

    // 自动保存定时器：30 秒一轮，按标签落草稿并记录会话（内容没变时跳过写盘）
    const autoSaveTimer = window.setInterval(() => void tickAutoSave(), 30_000);

    // 外部变更轮询（批次七）：5 秒一轮，只在有路径且非 busy 时真正发起查询；
    // 窗口不可见时 checkExternalChange 会直接跳过（见其内部注释）
    const externalTimer = window.setInterval(() => void checkExternalChange(), 5000);

    // 恢复可见时立刻补查一次，不必干等下一个 5 秒
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkExternalChange();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // 用户未显式设置主题时，跟随系统深浅色变化
    const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = (e: MediaQueryListEvent) => {
      if (!userThemeSet) applyAppTheme(e.matches);
    };
    schemeQuery.addEventListener("change", onSchemeChange);

    // Tauri 的事件监听返回解绑函数（异步 resolve），要在卸载时调用，否则监听器会随
    // 组件重建不断累积——旧闭包仍持有已失效的状态。
    let unlistenClose: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;
    let unlistenOpenFile: (() => void) | undefined;

    // 未保存关闭拦截（preventDefault 必须同步调用，确认框异步进行）
    let closing = false;
    void win.onCloseRequested((event) => {
      captureActiveTab();
      if (!anyTabDirty() || closing) return;
      closing = true;
      event.preventDefault();
      void (async () => {
        const dirtyCount = tabs.filter((_t, i) => tabDirty(i)).length;
        const ok = await confirmDialog(
          dirtyCount > 1
            ? t("有 {n} 个标签存在未保存的修改，退出将丢弃这些修改。确定退出吗？", { n: dirtyCount })
            : t("当前文档有未保存的修改，退出将丢弃这些修改。确定退出吗？"),
          {
            title: "Sticho",
            kind: "warning",
            okLabel: t("退出"),
            cancelLabel: t("取消"),
          },
        );
        if (ok) {
          // 退出前最后落一份草稿与会话：定时器可能刚好还没轮到（tickAutoSave 已吞掉所有异常）
          await tickAutoSave();
          await win.destroy();
        } else closing = false;
      })();
    }).then((fn) => {
      unlistenClose = fn;
    });

    // 拖拽文件到窗口（enter/leave 控制高亮，drop 分发到对应处理管道）
    void win.onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter") {
        dragOver = true;
      } else if (payload.type === "leave") {
        dragOver = false;
      } else if (payload.type === "drop") {
        dragOver = false;
        void handleDroppedFiles(payload.paths);
      }
    }).then((fn) => {
      unlistenDrop = fn;
    });

    // 单实例转发（文件关联后双击文档时，程序已在运行）：Rust 侧把第二次启动的
    // 文件路径通过 open-file 事件发过来，复用拖拽导入的分发逻辑新开标签页。
    void listen<string[]>("open-file", (event) => {
      const paths = event.payload ?? [];
      if (paths.length > 0) void handleDroppedFiles(paths);
    }).then((fn) => {
      unlistenOpenFile = fn;
    });

    return () => {
      window.clearInterval(autoSaveTimer);
      window.clearInterval(externalTimer);
      schemeQuery.removeEventListener("change", onSchemeChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unlistenClose?.();
      unlistenDrop?.();
      unlistenOpenFile?.();
    };
  });
</script>

<svelte:window onkeydown={onKeydown} onclick={onWindowClick} />

<div class="app" class:drag-over={dragOver}>
  <!-- 菜单栏（阶段 10）：一级菜单 文件/编辑/段落/格式/视图/帮助 -->
  <header class="menubar">
    {#each MENUS as menu (menu.id)}
      <div class="menu-root">
        <button
          class="menu-title"
          class:open={menuOpen === menu.id}
          onclick={() => toggleMenu(menu.id)}
          onmouseenter={() => {
            if (menuOpen) menuOpen = menu.id;
          }}
        >{menu.label}({menu.key.toUpperCase()})</button>

        {#if menuOpen === menu.id}
          {@const locked = menu.readonlyLocked === true && browseMode}
          <div class="menu-panel">
            {#each menu.items as item, i (i)}
              {#if item.sep}
                <div class="menu-sep"></div>
              {:else if item.sub || item.dynamic}
                {@const children = item.sub ?? item.dynamic?.() ?? []}
                <div
                  class="menu-sub"
                  role="none"
                  onmouseenter={() => {
                    // 不可用的父项不展开子菜单（否则灰掉的项一悬停就弹出面板）
                    if (!locked && !item.disabled?.()) subOpen = item.label ?? null;
                  }}
                  onmouseleave={() => (subOpen = null)}
                >
                  <button
                    class="menu-item"
                    class:is-disabled={locked || item.disabled?.()}
                    aria-disabled={locked || item.disabled?.()}
                    title={item.tip}
                    onclick={() => {
                      if (!locked && !item.disabled?.()) subOpen = item.label ?? null;
                    }}
                  >
                    <span class="mark"></span>
                    <span class="label">{item.label}</span>
                    <span class="arrow">›</span>
                  </button>
                  {#if subOpen === item.label}
                    <div class="menu-panel sub-panel">
                      {#each children as child, j (j)}
                        {#if child.sep}
                          <div class="menu-sep"></div>
                        {:else}
                          <button
                            class="menu-item"
                            class:is-disabled={locked || child.disabled?.()}
                            aria-disabled={locked || child.disabled?.()}
                            onclick={() => runMenuItem(child)}
                          >
                            <span class="mark">{child.radio ? (child.checked?.() ? "●" : "") : (child.checked?.() ? "✓" : "")}</span>
                            <span class="label" title={child.tip ?? child.label}>{child.label}</span>
                            {#if child.shortcut}<span class="shortcut">{child.shortcut}</span>{/if}
                          </button>
                        {/if}
                      {/each}
                    </div>
                  {/if}
                </div>
              {:else}
                <button
                  class="menu-item"
                  class:is-disabled={locked || item.disabled?.()}
                  aria-disabled={locked || item.disabled?.()}
                  title={item.tip}
                  onclick={() => runMenuItem(item)}
                >
                  <span class="mark">{item.radio ? (item.checked?.() ? "●" : "") : (item.checked?.() ? "✓" : "")}</span>
                  <span class="label">{item.label}</span>
                  {#if item.shortcut}<span class="shortcut">{item.shortcut}</span>{/if}
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    <span class="spacer"></span>

    <!-- 标签栏（批次六）：活跃标签的名字与未保存圆点直接读全局状态，其余读各自快照；
         标签多了横向滚动，滚轮也能推着滚（onwheel 里手动转成横向） -->
    <div class="tabs" bind:this={tabsEl} onwheel={onTabsWheel}>
      {#each tabs as tab, i (tab.id)}
        <button
          class="tab"
          class:active={i === activeIndex}
          data-index={i}
          title={i === activeIndex ? currentPath ?? t("尚未保存到磁盘") : tab.path ?? t("尚未保存到磁盘")}
          onclick={() => void switchTab(i)}
          oncontextmenu={(e) => openTabMenu(e, i)}
          onauxclick={(e) => {
            // 中键关闭：与浏览器标签的习惯一致
            if (e.button === 1) {
              e.preventDefault();
              void closeTab(i);
            }
          }}
        >
          <span class="tab-label">{tabTitle(i)}{tabDirty(i) ? " ●" : ""}</span>
          <span
            class="tab-close"
            role="none"
            title={t("关闭标签")}
            onclick={(e) => {
              e.stopPropagation();
              void closeTab(i);
            }}
          >×</span>
        </button>
      {/each}
    </div>

    <!-- 右上角图标按钮（阶段 12）：皮肤设置（衣服）/ 软件设置（齿轮）。
         阅读 / 编辑模式开关已移到状态栏（见 StatusBar.svelte） -->
    <div class="corner-tools">
      <div class="menu-root skin-root">
        <button
          class="icon-btn"
          class:open={skinOpen}
          title={t("皮肤设置")}
          aria-label={t("皮肤设置")}
          onclick={toggleSkin}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8.5 3 L4.2 5.1 A1.6 1.6 0 0 0 3.4 6.5 V10 a0.9 0.9 0 0 0 0.9 0.9 H6.2 V20 a1 1 0 0 0 1 1 H16.8 a1 1 0 0 0 1-1 V10.9 H19.7 a0.9 0.9 0 0 0 0.9-0.9 V6.5 a1.6 1.6 0 0 0 -0.8-1.4 L15.5 3" />
            <path d="M8.5 3 a3.5 3.5 0 0 0 7 0" />
          </svg>
        </button>

        {#if skinOpen}
          <div class="menu-panel skin-panel">
            <!-- 外观：明/暗档位（用户显式选择优先，未设置时跟随系统） -->
            <section class="set-group">
              <h3>{t("外观")}</h3>
              <div class="set-choices">
                <button class:active={userThemeSet && theme === "light"} onclick={() => void setThemeChoice("light")}>{t("浅色")}</button>
                <button class:active={userThemeSet && theme === "dark"} onclick={() => void setThemeChoice("dark")}>{t("深色")}</button>
                <button class:active={!userThemeSet} onclick={() => void setThemeChoice("system")}>{t("跟随系统")}</button>
              </div>
            </section>

            <!-- 主题：主题文件夹里的自定义 .css，叠加在当前明/暗档位之上 -->
            <section class="set-group">
              <h3>{t("主题")}</h3>
              <p class="set-tip">{t("把任意 .css 放进主题文件夹，即可在此选用（叠加在当前明/暗档位之上）。")}</p>
              {#if themeFiles.length > 0}
                <div class="set-choices set-choices--wrap">
                  <button class:active={userTheme === null} onclick={() => void selectUserTheme(null)}>{t("默认")}</button>
                  {#each themeFiles as file (file.name)}
                    <button
                      class:active={userTheme === file.name}
                      onclick={() => void selectUserTheme(file.name)}
                    >{file.name.replace(/\.css$/i, "")}</button>
                  {/each}
                </div>
              {/if}
              <button class="set-action" onclick={() => void openThemesFolder()}>{t("打开主题文件夹")}</button>
            </section>

            <!-- 阅读排版：只服务 Markdown / 纯文本，HTML 文档自带样式不受影响 -->
            <section class="set-group">
              <h3>{t("阅读排版")}</h3>
              <p class="set-tip">{t("只作用于 Markdown / 纯文本文档；HTML 文档自带样式，不受这里影响。")}</p>

              <label class="set-row">
                <span class="set-label">{t("字体")}</span>
                <select
                  class="set-select"
                  value={readerStyle.fontFamily ?? ""}
                  onchange={(e) => void setReaderOption("fontFamily", e.currentTarget.value)}
                >
                  {#each READER_FONTS as item (item.id)}
                    <option value={item.value}>{item.label}</option>
                  {/each}
                </select>
              </label>

              <label class="set-row">
                <span class="set-label">{t("字号")}</span>
                <select
                  class="set-select"
                  value={readerStyle.fontSize ?? ""}
                  onchange={(e) => void setReaderOption("fontSize", e.currentTarget.value)}
                >
                  <option value="">{t("默认")}</option>
                  {#each READER_SIZES as size (size)}
                    <option value={size}>{size}</option>
                  {/each}
                </select>
              </label>

              <label class="set-row">
                <span class="set-label">{t("行距")}</span>
                <select
                  class="set-select"
                  value={readerStyle.lineHeight ?? ""}
                  onchange={(e) => void setReaderOption("lineHeight", e.currentTarget.value)}
                >
                  <option value="">{t("默认")}</option>
                  {#each READER_LINES as lh (lh)}
                    <option value={lh}>{lh}</option>
                  {/each}
                </select>
              </label>

              <div class="set-row set-row--stack">
                <span class="set-label">{t("文字颜色")}</span>
                <div class="reader-swatches">
                  <button class:active={!readerStyle.textColor} title={t("默认")} onclick={() => void setReaderOption("textColor", "")}>
                    {t("默认")}
                  </button>
                  {#each READER_TEXT_COLORS as color (color.value)}
                    <button
                      class="swatch"
                      class:active={readerStyle.textColor === color.value}
                      style={`--swatch: ${color.value}`}
                      title={color.label}
                      aria-label={color.label}
                      onclick={() => void setReaderOption("textColor", color.value)}
                    ></button>
                  {/each}
                  <input
                    class="set-color"
                    type="color"
                    value={readerStyle.textColor ?? "#1a1a1a"}
                    title={t("自定义颜色")}
                    oninput={(e) => void setReaderOption("textColor", e.currentTarget.value)}
                  />
                </div>
              </div>

              <div class="set-row set-row--stack">
                <span class="set-label">{t("页面背景")}</span>
                <div class="reader-swatches">
                  <button class:active={!readerStyle.background} title={t("默认")} onclick={() => void setReaderOption("background", "")}>
                    {t("默认")}
                  </button>
                  {#each READER_BACKGROUNDS as color (color.value)}
                    <button
                      class="swatch"
                      class:active={readerStyle.background === color.value}
                      style={`--swatch: ${color.value}`}
                      title={color.label}
                      aria-label={color.label}
                      onclick={() => void setReaderOption("background", color.value)}
                    ></button>
                  {/each}
                  <input
                    class="set-color"
                    type="color"
                    value={readerStyle.background ?? "#f6efdc"}
                    title={t("自定义颜色")}
                    oninput={(e) => void setReaderOption("background", e.currentTarget.value)}
                  />
                </div>
              </div>

              <button class="set-action" onclick={() => void resetReaderStyle()}>{t("恢复默认排版")}</button>
            </section>
          </div>
        {/if}
      </div>

      <button class="icon-btn" title={t("软件设置")} aria-label={t("软件设置")} onclick={() => (settingsOpen = true)}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  </header>

  {#if findOpen}
    <FindBar
      {locale}
      bind:findText
      bind:replaceText
      {findStatus}
      {findCase}
      {findWord}
      {findRegex}
      {browseMode}
      onFindInput={onFindInput}
      onToggleFlag={(flag) => void toggleFindFlag(flag)}
      onNext={findNext}
      onReplaceOne={replaceOne}
      onReplaceAll={replaceAll}
      onClose={closeFind}
    />
  {/if}

  <div class="body">
    {#if sidebarVisible}
      <Sidebar
        view={sidebarView}
        panels={sidebarPanels}
        root={treeRoot}
        {currentPath}
        {outline}
        {fileProps}
        codeFile={docKind === "code"}
        {searchGroups}
        {searchBusy}
        {searchError}
        searchFiles={searchFileCount}
        {searchTruncated}
        onView={setSidebarView}
        onClose={toggleSidebar}
        onOpenFile={openFromTree}
        onPickRoot={pickTreeRoot}
        onGotoHeading={gotoHeading}
        onSearch={(q, cs, re) => void runSearch(q, cs, re)}
        onOpenHit={(hit) => void openSearchHit(hit)}
        t={t}
      />
    {/if}

    <div class="editor-area">
      <main id="editor-host"></main>

      {#if docKind === "html"}
        <!-- HTML 文档模式：覆盖层而非隐藏 Vditor，避免其布局失效 -->
        <div class="html-view">
          {#if htmlView === "preview"}
            <!-- 沙箱两模式互斥：不跑脚本时给 allow-same-origin（父窗口可读文档，支撑编辑/查找/大纲定位），
                 跑脚本时只给 allow-scripts（iframe 降级为独立源，脚本无法反向操作本应用） -->
            {#key previewKey}
              <iframe
                bind:this={previewFrame}
                class:editing={previewEditable}
                title={t("HTML 预览")}
                sandbox={htmlScripts ? "allow-scripts" : "allow-same-origin"}
                srcdoc={previewDoc}
                onload={onPreviewLoad}
              ></iframe>
            {/key}
          {:else}
            <!-- HTML 源码视图：原生 textarea（大文件不卡），行号交给一层透明镜像叠层绘制 -->
            <div
              class={"html-source" + (htmlGutterOn ? " with-linenumbers" : "")}
              bind:this={htmlSourceWrap}
            >
              <textarea
                bind:this={sourceArea}
                spellcheck="false"
                readonly={browseMode}
                value={htmlSource}
                oninput={(e) => onHtmlInput(e.currentTarget.value)}
                onscroll={onHtmlSourceScroll}
              ></textarea>
              {#if htmlGutterOn}
                <!-- 镜像叠层：逐行隐藏原文（决定软换行后的行高），行号绝对定位到左侧车道。
                     与编辑器自绘行号栏同理，行号只随纵向滚动同步，不参与交互。 -->
                <div class="html-linenumbers" bind:this={htmlGutterEl} aria-hidden="true">
                  {#each htmlSourceLines as line, i (i)}
                    <div class="html-linenumber">
                      <span class="num">{i + 1}</span>
                      <span class="ghost">{line === "" ? "\u200b" : line}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if docKind === "code" && codeLargeText === null}
        <!-- 代码文件模式：CodeMirror 覆盖层（与 HTML 同一范式：覆盖而不隐藏 Vditor） -->
        <div class="code-view" bind:this={codeHost}></div>
      {/if}
    </div>
  </div>

  <StatusBar
    {locale}
    {wordCount}
    {charCount}
    {lineCount}
    {currentPath}
    {dirty}
    {docKind}
    {editorMode}
    onSetEditorMode={switchEditorMode}
    {htmlView}
    onSetHtmlView={setHtmlView}
    {htmlScripts}
    onToggleHtmlScripts={toggleHtmlScripts}
    {codeLargeText}
    {codeLangLabel}
    {codeCursor}
    {codeMatch}
    {browseMode}
    onSetBrowseMode={(read) => void setBrowseMode(read)}
    codeLangOverride={codeLangChoice()}
    onSetCodeLang={(id) => void setCodeLang(id)}
    bind:codeLangOpen
    {typewriterOn}
    {paragraphFocus}
    {encoding}
    bind:encodingOpen
    onApplyEncoding={(id) => void applyEncoding(id)}
    {davEnabled}
    {davSyncState}
    {davSyncTip}
  />

  {#if dragOver}
    <div class="drop-overlay">{t("松开鼠标打开文件（支持 md / html / docx / pdf）")}</div>
  {/if}

  <!-- 快捷键一览（帮助菜单）：表格按分类分组，比原先的一行行文本更好速查 -->
  {#if shortcutsOpen}
    <div
      class="modal-mask"
      role="none"
      onclick={(e) => {
        if (e.target === e.currentTarget) shortcutsOpen = false;
      }}
    >
      <div class="modal modal--shortcuts" role="dialog" aria-label={t("快捷键一览")}>
        <div class="modal-head">
          <span>{t("快捷键一览")}</span>
          <button class="icon-btn" title={t("关闭")} aria-label={t("关闭")} onclick={() => (shortcutsOpen = false)}>✕</button>
        </div>
        <div class="modal-body">
          <table class="sc-table">
            <thead>
              <tr><th>{t("快捷键")}</th><th>{t("功能")}</th></tr>
            </thead>
            {#each SHORTCUT_GROUPS as group (group.group)}
              <tbody>
                <tr class="sc-group"><td colspan="2">{t(group.group)}</td></tr>
                {#each group.items as item (item.desc)}
                  <tr>
                    <td class="sc-keys"><kbd>{item.keys}</kbd></td>
                    <td>{t(item.desc)}</td>
                  </tr>
                {/each}
              </tbody>
            {/each}
          </table>
        </div>
      </div>
    </div>
  {/if}

  <!-- 多选一对话框（批次七）：外部变更三选 -->
  {#if choiceState}
    <div
      class="modal-mask modal-mask--choice"
      role="none"
      onclick={(e) => {
        if (e.target === e.currentTarget) resolveChoice(null);
      }}
    >
      <div class="modal" role="dialog" aria-label={choiceState.title}>
        <div class="modal-head">
          <span>{choiceState.title}</span>
          <button class="icon-btn" title={t("取消")} aria-label={t("取消")} onclick={() => resolveChoice(null)}>✕</button>
        </div>
        <div class="modal-body">
          <p class="choice-message">{choiceState.message}</p>
          <div class="choice-actions">
            {#each choiceState.options as option (option.value)}
              <button class:primary={option.primary} onclick={() => resolveChoice(option.value)}>{option.label}</button>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- 软件设置（阶段 12）：左上角齿轮按钮打开的模态面板，状态与样式由组件自管 -->
  {#if settingsOpen}
    <SettingsModal
      {locale}
      appVersion={APP_VERSION}
      bind:settingsTab
      onClose={() => (settingsOpen = false)}
      selectLocale={(id) => void selectLocale(id)}
      {autoSaveEnabled}
      onToggleAutoSave={() => void toggleAutoSave()}
      {defaultOpenMode}
      onSetDefaultOpenMode={(m) => void setDefaultOpenMode(m)}
      {historyKeep}
      onSetHistoryKeep={(n) => void setHistoryKeep(n)}
      {notepadAll}
      {assocBusy}
      onToggleNotepad={() => void toggleNotepad()}
      onOpenDefaultApps={() => void openDefaultApps()}
      {contextMenu}
      onToggleContextMenu={() => void toggleContextMenu()}
      {recentFiles}
      onClearRecentFiles={() => void clearRecentFiles()}
      {assoc}
      {assocExts}
      {allAssoc}
      {assocOfGroup}
      {assocStats}
      onSetAssocBatch={(exts, v) => void setAssocBatch(exts, v)}
      onToggleAssoc={(ext) => void toggleAssoc(ext)}
      bind:davUrl
      bind:davUser
      bind:davPass
      bind:davRoot
      {onDavInput}
      onPersistDavConfig={() => void persistDavConfig()}
      {davTesting}
      {davTip}
      {davVerified}
      {davEnabled}
      {davReady}
      onTestDav={() => void testDav()}
      onToggleDavEnabled={() => void toggleDavEnabled()}
      onOpenCloud={() => (cloudOpen = true)}
      {davVersioning}
      onToggleDavVersioning={() => void toggleDavVersioning()}
      {davKeep}
      onSetDavKeep={(n) => void setDavKeep(n)}
      {davConflictPolicy}
      onSetDavConflictPolicy={(p) => void setDavConflictPolicy(p)}
      {dataLocation}
      {locationBusy}
      onChangeDataLocation={(m) => void changeDataLocation(m)}
      onPickCustomLocation={() => void pickCustomLocation()}
      {dataRootPath}
      {locationTip}
      {locationTipOk}
      onRestart={() => void doRestart()}
    />
  {/if}

  {#if codeToolsOpen}
    <CodeTools
      {locale}
      readSelection={getCodeSelection}
      writeText={(text) => {
        replaceCodeSelection(text);
        syncFromCode();
      }}
      onClose={() => (codeToolsOpen = false)}
    />
  {/if}

  {#if cloudOpen}
    <CloudBrowser
      {locale}
      dav={davConfig}
      onOpen={(remote, content) => void openCloudDoc(remote, content)}
      onClose={() => (cloudOpen = false)}
    />
  {/if}

  <!-- 恢复中心（文件菜单 →「恢复中心…」）：统一浏览恢复草稿与本地版本历史 -->
  {#if recoveryOpen}
    <RecoveryCenter
      {locale}
      onRestore={(payload) => void restoreFromRecoveryCenter(payload)}
      onClose={() => (recoveryOpen = false)}
    />
  {/if}

  {#if diffView}
    <DiffView
      {locale}
      title={diffView.title}
      leftLabel={diffView.leftLabel}
      rightLabel={diffView.rightLabel}
      lines={diffView.lines}
      onClose={() => (diffView = null)}
    />
  {/if}

  <!-- 命令面板（批次四）：Ctrl+P 打开，回车执行菜单里的任意命令 -->
  {#if paletteOpen}
    <CommandPalette
      {locale}
      commands={paletteCommands}
      onClose={() => (paletteOpen = false)}
    />
  {/if}

  <!-- 入门指南（批次四）：首次启动弹出，帮助菜单可随时重开 -->
  {#if welcomeOpen}
    <WelcomeDialog {locale} appVersion={APP_VERSION} onClose={dismissWelcome} />
  {/if}

  <!-- 标签栏右键菜单：固定定位在鼠标处（放在最外层，不受 .tabs 横向滚动裁剪） -->
  {#if tabMenu}
    <div
      class="tab-menu"
      role="menu"
      tabindex="-1"
      style={`left:${tabMenu.x}px; top:${tabMenu.y}px`}
      oncontextmenu={(e) => e.preventDefault()}
    >
      <button class="menu-item" role="menuitem" onclick={() => runTabMenu(true)}>
        <span class="label">{t("关闭标签页")}</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        disabled={tabs.length < 2}
        onclick={() => runTabMenu(false)}
      >
        <span class="label">{t("关闭其他标签页")}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    position: relative;
  }

  /* ---- 菜单栏 ---- */
  .menubar {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    padding: 0.15rem 0.4rem;
    background: var(--toolbar-bg, #f5f5f5);
    border-bottom: 1px solid var(--border, #ddd);
    user-select: none;
    flex-shrink: 0;
    position: relative;
    z-index: 300;
  }

  .menu-root {
    position: relative;
  }

  .menu-title {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .menu-title:hover,
  .menu-title.open {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .menu-panel {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 250px;
    padding: 4px;
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
    z-index: 400;
  }

  .sub-panel {
    top: -5px;
    left: 100%;
    /* 「语法高亮语言」有二十多项，限高并滚动，免得超出窗口底部点不到 */
    max-height: min(62vh, 480px);
    overflow-y: auto;
  }

  .menu-sub {
    position: relative;
  }

  /* 标签栏右键菜单：与下拉菜单同一套观感，但按鼠标位置固定定位 */
  .tab-menu {
    position: fixed;
    z-index: 500;
    min-width: 160px;
    padding: 4px;
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.3rem 0.5rem;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .menu-item:hover:not(.is-disabled) {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  /* 不可用项：置灰且不可点。用类而不是原生 :disabled——原生 disabled 会吞掉鼠标事件，
     悬停说明（原生 title）就显示不出来了。 */
  .menu-item.is-disabled {
    opacity: 0.4;
    cursor: default;
  }

  .menu-item .mark {
    flex: 0 0 0.9rem;
    text-align: center;
    opacity: 0.9;
  }

  .menu-item .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 320px;
  }

  .menu-item .shortcut {
    flex-shrink: 0;
    opacity: 0.55;
    font-size: 0.75rem;
    padding-left: 1rem;
  }

  .menu-item .arrow {
    flex-shrink: 0;
    opacity: 0.6;
    padding-left: 0.75rem;
  }

  .menu-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border, #ddd);
  }

  .spacer {
    flex: 1;
  }

  /* 标签栏（批次六）：占菜单栏右侧剩余空间的固定比例，标签多了自身横向滚动 */
  .tabs {
    display: flex;
    align-items: center;
    gap: 3px;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 60%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    padding: 0 2px;
  }

  /* 标签超出宽度时的横向滚动条：细、低调、悬停才明显，避免抢视觉 */
  .tabs::-webkit-scrollbar {
    height: 6px;
  }

  .tabs::-webkit-scrollbar-track {
    background: transparent;
  }

  .tabs::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(128, 128, 128, 0.35);
  }

  .tabs::-webkit-scrollbar-thumb:hover {
    background: rgba(128, 128, 128, 0.6);
  }

  /* 未选中标签：给一层卡片外观（底色 + 边框）稍微后退，避免与菜单栏底色糊在一起分不出边界 */
  .tab {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.35rem 0.15rem 0.55rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    background: var(--bg, #fff);
    color: var(--fg);
    opacity: 0.72;
    cursor: pointer;
    white-space: nowrap;
    max-width: 12rem;
    /* 不参与收缩：标签变多时保持各自宽度，靠容器横向滚动而不是把标签挤窄 */
    flex: 0 0 auto;
    transition: opacity 0.12s ease, background-color 0.12s ease, border-color 0.12s ease;
  }

  .tab:hover {
    opacity: 0.9;
    background: var(--hover, rgba(128, 128, 128, 0.12));
  }

  /* 选中标签：不透明 + 加粗 + 顶部强调条，与未选中拉开层级 */
  .tab.active {
    opacity: 1;
    font-weight: 600;
    border-color: var(--accent, #2563eb);
    box-shadow: inset 0 2px 0 var(--accent, #2563eb);
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-close {
    flex-shrink: 0;
    width: 0.9rem;
    height: 0.9rem;
    line-height: 0.85rem;
    text-align: center;
    border-radius: 3px;
    /* 父级 .tab 本身带透明度，这里取高一点，否则未选中标签的关闭按钮几乎看不见 */
    opacity: 0.7;
  }

  .tab-close:hover {
    background: var(--danger, #e5484d);
    color: #fff;
    opacity: 1;
  }

  /* ---- 右上角图标按钮（阶段 12）：软件设置 / 皮肤设置 ---- */
  .corner-tools {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    padding-left: 0.3rem;
    margin-left: 0.15rem;
    border-left: 1px solid var(--border, #ddd);
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .icon-btn:hover,
  .icon-btn.open {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  /* 皮肤设置面板：承载外观 / 主题 / 阅读排版三块设置，比一级菜单宽；
     按钮在齿轮左边，面板向左展开避免溢出窗口右侧，内容超高时自身滚动 */
  .skin-panel {
    width: 300px;
    max-height: 72vh;
    overflow-y: auto;
    padding: 0.8rem;
    left: auto;
    right: 0;
  }

  /* ---- 软件设置面板 ---- */
  .modal-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    z-index: 600;
  }

  /* 多选一对话框（askChoice）永远盖在最上层：它可能从软件设置面板内部弹出 */
  .modal-mask--choice {
    z-index: 700;
  }

  .modal {
    display: flex;
    flex-direction: column;
    width: 380px;
    max-width: 92vw;
    max-height: 82vh;
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 10px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.5rem 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border, #ddd);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .modal-body {
    padding: 0.8rem;
    overflow: auto;
  }

  .set-group + .set-group {
    margin-top: 1rem;
  }

  /* ---- 多选一对话框（批次七）---- */
  .choice-message {
    font-size: 0.8125rem;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .choice-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .choice-actions button {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.35rem 0.8rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .choice-actions button:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .choice-actions button.primary {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ---- 快捷键一览表格（帮助菜单）---- */
  .modal--shortcuts {
    width: 640px;
  }

  .sc-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .sc-table thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 0.35rem 0.5rem;
    text-align: left;
    font-weight: 600;
    opacity: 0.85;
    background: var(--bg, #fff);
    border-bottom: 1px solid var(--border, #ddd);
  }

  .sc-table td {
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--border, #eee);
    vertical-align: top;
  }

  /* 分类行：跨两列的浅色标题条，把表格分段 */
  .sc-table .sc-group td {
    font-weight: 600;
    opacity: 0.9;
    background: var(--hover, rgba(0, 0, 0, 0.04));
  }

  .sc-table .sc-keys {
    white-space: nowrap;
    width: 1%;
  }

  .sc-table .sc-keys kbd {
    display: inline-block;
    font-family: inherit;
    font-size: 0.75rem;
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 4px;
    background: var(--hover, rgba(0, 0, 0, 0.05));
  }

  .set-group h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    opacity: 0.85;
    margin-bottom: 0.5rem;
  }

  .set-choices {
    display: flex;
    gap: 0.4rem;
  }

  .set-choices button {
    flex: 1;
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.35rem 0;
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .set-choices button:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .set-choices button.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* 主题名长短不一：皮肤设置面板里放不下就换行，且按钮按内容宽度而非等分 */
  .set-choices--wrap {
    flex-wrap: wrap;
    margin-top: 0.4rem;
  }

  .set-choices--wrap button {
    flex: 0 1 auto;
    padding: 0.35rem 0.7rem;
  }

  /* 皮肤设置面板里的动作按钮（打开主题文件夹 / 恢复默认排版）与上方控件拉开间距 */
  .set-group > .set-action {
    margin-top: 0.5rem;
  }

  .set-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.8125rem;
    padding: 0.25rem 0;
    cursor: pointer;
  }

  /* 阅读排版（字体 / 字号 / 行距 / 文字色 / 护眼底色）：标签在左、控件在右 */
  .set-label {
    flex-shrink: 0;
    width: 4.2rem;
    opacity: 0.8;
  }

  /* 色板一行放不下时改为上下排布（标签 + 换行的色块区） */
  .set-row--stack {
    align-items: flex-start;
    cursor: default;
  }

  .set-select {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.25rem 0.35rem;
    color: inherit;
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    outline: none;
  }

  .reader-swatches {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  /* 「默认」是一个带文字的按钮，与后面的纯色块区分开 */
  .reader-swatches > button {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.45rem;
    color: inherit;
    background: transparent;
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    cursor: pointer;
  }

  .reader-swatches > button:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  /* 色块：颜色由内联的 --swatch 提供 */
  .reader-swatches > button.swatch {
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    background: var(--swatch);
    border-color: var(--border, #ddd);
  }

  .reader-swatches > button.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  /* 自定义颜色：去掉原生色框的默认外观，与色块同尺寸 */
  .set-color {
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }

  .set-tip {
    font-size: 0.75rem;
    opacity: 0.6;
    margin-top: 0.35rem;
  }

  .set-action {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .set-action:hover:not(:disabled) {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  /* 查找 / 替换栏的样式随组件搬到 components/FindBar.svelte（Svelte 样式按组件作用域隔离） */

  /* 侧边栏 + 编辑区并排（阶段 11） */
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  main {
    flex: 1;
    min-width: 0;
    min-height: 0; /* 允许编辑器在 flex 容器内正确滚动 */
    overflow: hidden;
  }

  /* ---- HTML 文档模式（打开 .html）：编辑器区 + 覆盖层 ---- */
  .editor-area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    position: relative;
    display: flex;
  }

  .html-view {
    position: absolute;
    inset: 0;
    display: flex;
    background: #ffffff; /* 文档自带配色，不注入应用主题 */
  }

  .html-view iframe {
    flex: 1;
    width: 100%;
    height: 100%;
    border: none;
    background: #ffffff;
  }

  .html-view textarea {
    flex: 1;
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    padding: 12px 16px;
    font-family: Consolas, "Courier New", var(--font-sans);
    font-size: 13px;
    line-height: 1.6;
    color: var(--fg);
    background: var(--bg);
    /* 必须软换行：压缩型 HTML 正文可能整篇只有一行（例如 44 万字符一行），
       white-space: pre 会让它变成一条超宽单行，屏幕上只能看到开头一小段。 */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow: auto;
    user-select: text; /* 全局禁选了，输入区要放开 */
    tab-size: 2;
  }

  /* ---- HTML 源码视图的行号叠层（批次 E）----
     叠层与 textarea 同字体 / 同内容宽（宽度由 JS 量出写进 --html-ln-w），逐行镜像原文但隐藏，
     于是软换行位置与 textarea 完全一致；行号绝对定位到左侧车道（--html-ln-pad 那一段空位）。 */
  .html-source {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
  }

  /* 开启行号时给 textarea 让出左侧车道，叠层按同一内边距排版才能对齐 */
  .html-source.with-linenumbers textarea {
    padding-left: 40px;
  }

  .html-linenumbers {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: calc(var(--html-ln-pad, 0px) + var(--html-ln-w, 0px));
    box-sizing: border-box;
    padding: 12px 0 0 var(--html-ln-pad, 0px);
    overflow: hidden; /* 内容比 textarea 高，靠 scrollTop 跟着 textarea 滚 */
    pointer-events: none; /* 只负责显示：点击 / 选中都交给下层 textarea */
    user-select: none;
    font-family: Consolas, "Courier New", var(--font-sans);
    font-size: 13px;
    line-height: 1.6;
    color: var(--fg);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 2;
  }

  /* 每个逻辑行一行：ghost 决定该行折行后的高度，num 落在这段高度左上角 */
  .html-linenumber {
    position: relative;
  }

  .html-linenumber .ghost {
    visibility: hidden;
  }

  .html-linenumber .num {
    position: absolute;
    top: 0;
    left: calc(-1 * var(--html-ln-pad, 0px));
    width: calc(var(--html-ln-pad, 0px) - 6px);
    text-align: right;
    opacity: 0.35;
  }

  /* ---- 代码文件模式（打开 .py / .bat 等）：CodeMirror 覆盖层 ---- */
  .code-view {
    position: absolute;
    inset: 0;
    display: flex;
    /* 底色由 CodeMirror 自己的 theme 决定（默认读 --cm-bg），这里只兜一层容器色 */
    background: var(--cm-bg, #ffffff);
  }

  /* .cm-editor 由 CodeMirror 在运行时创建（没有本组件的样式作用域类），
     所以这里必须用 :global；theme 里已给 height:100%，这里补横向撑满与可收缩 */
  .code-view :global(.cm-editor) {
    flex: 1;
    min-width: 0;
  }

  /* 状态栏的 .code-info / .html-switch / .html-edit 与整套状态栏样式，
     随组件搬到 components/StatusBar.svelte（Svelte 样式按组件作用域隔离） */

  /* 编辑态给预览区一圈内描边，明确「现在改的是文档本身」 */
  .html-view iframe.editing {
    outline: 2px solid var(--accent, #2563eb);
    outline-offset: -2px;
  }

  /* ---- 拖拽悬停遮罩 ---- */
  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    background: color-mix(in srgb, var(--bg, #fff) 75%, transparent);
    border: 3px dashed var(--accent);
    pointer-events: none; /* 不拦截 drop，事件由原生层处理 */
  }

  .app.drag-over main {
    outline: 2px solid var(--accent);
  }
</style>
