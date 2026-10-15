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
    getMdBookmarkAnchor,
    getMdTopBookmarkAnchor,
    revealMdBookmark,
    selectAllEditorContent,
    setLargeReaderWrap,
    preloadEditor,
    whenEditorReady,
    type MdBookmarkAnchor,
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
    clearSystemIntegration,
    writeRecovery,
    listRecovery,
    readRecovery,
    deleteRecovery,
    exportPandoc,
    loadThemes,
    openThemeDir,
    ensurePacks,
    loadLocales,
    loadFonts,
    openPackDir,
    webdavTest,
    webdavUpload,
    webdavPut,
    webdavDownload,
    webdavStat,
    saveDavPassword,
    loadDavPassword,
    getDataLocation,
    getDataRoot,
    getConfigState,
    setupConfigLocation,
    checkDataLocation,
    setDataLocation,
    restartApp,
    clearAllData,
    openUrl,
    listHistory,
    readHistory,
    restoreHistory,
    pruneHistory,
    bookmarksSave,
    bookmarksLoad,
    bookmarksDelete,
    searchFiles,
    revealFile,
    logEvent,
    exportDiagnostics,
    type DataLocationMode,
    type ConfigState,
    type DavConfig,
    type ThemeFile,
    type LocalePack,
    type FontPack,
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
    setCodeLineWrapping,
    setCodeTypewriter,
    setCodeParagraphFocus,
    setCodeReaderStyle,
    focusCodeEditor,
    toggleCodeBookmark,
    nextCodeBookmark,
    getCodeBookmarkPositions,
    getCodeBookmarks,
    clearCodeBookmarks,
    setCodeBookmarks,
    scrollToCodeOffset,
    addCodeBookmark,
    removeCodeBookmark,
    getCodeSelectionText,
    deleteCodeSelection,
    insertCodeText,
    selectAllCode,
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
  import {
    cjkLatinAddSpace,
    cjkLatinRemoveSpace,
    collapseInnerSpaces,
    removeBlankLines,
    removeTrailingSpaces,
  } from "./lib/textTools";
  import { ENCODINGS, encodingLabel } from "./lib/encoding";
  import { newDocTab, sessionOf, applyEol, detectEol, restoredTabNeedsWelcome, type DocTab, type Eol, type SessionState } from "./lib/docState";
  import { parseOutline, parseOutlineFromHtml, parseFrontMatter, htmlPlainText, type OutlineItem, type SidebarView } from "./lib/sidebar";
  import Sidebar from "./components/Sidebar.svelte";
  import CodeTools from "./components/CodeTools.svelte";
  import CloudBrowser from "./components/CloudBrowser.svelte";
  import DiffView from "./components/DiffView.svelte";
  import RecoveryCenter from "./components/RecoveryCenter.svelte";
  import FindBar from "./components/FindBar.svelte";
  import StatusBar from "./components/StatusBar.svelte";
  import SettingsModal from "./components/SettingsModal.svelte";
  import ConfigSetupDialog from "./components/ConfigSetupDialog.svelte";
  import CommandPalette, { type PaletteCommand } from "./components/CommandPalette.svelte";
  import WelcomeDialog from "./components/WelcomeDialog.svelte";
  import { groupSearchHits, literalAnchor, type SearchGroup, type SearchHit } from "./lib/fileSearch";
  // 导出 / 导入实现（export-pdf、export-html、export-txt、import-html、export-docx、
  // import-pdf）统一走调用点动态加载：它们拖着 markdown-it / turndown / docx /
  // pdfjs-dist 这类大依赖，却只在对应菜单动作时才用得上。
  import { loadSetting, loadAllSettings, saveSetting, deleteSetting } from "./lib/settings";
  import { diffLines, type DiffLine } from "./lib/diff";
  import { ZH, LOCALES, makeTFrom, vditorLang, type Locale } from "./lib/i18n";
  import { DEFAULT_PACK_FILES, INK_DARK_THEME_FILE } from "./lib/defaultPacks";
  import { loadWelcomeDocs, welcomeFor } from "./lib/welcome";
  import {
    compileFindRegex,
    collectDomHits,
    collectStringHits,
    applyReplacement,
    hitIndexFrom,
    setHighlightRanges,
    applyFindHighlights,
    clearFindHighlights,
    type DomHit,
    type StringHit,
  } from "./lib/findReplace";
  import { runAutoSave, runExternalChangeCheck, startPolling, recoveryFingerprint, EXTERNAL_POLL_INTERVAL_MS } from "./lib/autoSave";
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";

  /** 版本号：由 vite define 从 package.json 注入（单一来源，勿手写） */
  const APP_VERSION = __APP_VERSION__;

  // ---- 应用状态（Svelte 5 runes）----
  let currentPath = $state<string | null>(null); // null = 尚未保存过的新文档
  /**
   * 当前文档绑定的云端远端路径（批次十一）。
   *
   * 由侧边栏「云端」视图打开的文件带此值：这类文档没有本地文件（currentPath 为 null），
   * 保存时按此路径直接写回云端（见 saveFile 的云端分支）。本地文档此值恒为 null。
   */
  let currentRemote = $state<string | null>(null);
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
  let recentFiles = $state<string[]>([]);
  let wordCount = $state(0);
  let charCount = $state(0); // 状态栏实时统计：字符数（批次七）
  let lineCount = $state(0); // 状态栏实时统计：行数（批次七）
  let dragOver = $state(false); // 拖拽悬停高亮
  let showToolbar = $state(true); // 是否显示编辑器自带排版工具栏
  // 当前 Vditor 渲染模式（状态栏图标 / 视图菜单复选共用）。仅 Markdown 模式有意义，
  // 由 onEditorModeChange 持续同步（含工具栏下拉与菜单两条切换路径）。
  let editorMode = $state<"ir" | "wysiwyg" | "sv" | "none">("ir");
  let shortcutsOpen = $state(false); // 「快捷键一览」模态（帮助菜单）
  let aboutOpen = $state(false); // 「关于」模态：带应用图标的自绘对话框（帮助菜单）
  let tabsEl = $state<HTMLElement | null>(null); // 标签栏滚动容器（切标签时把活跃项滚进可视区）
  let showLineNumbers = $state(true); // 是否显示正文行号（默认显示）
  let autoWrap = $state(true); // 自动换行（视图 → 自动换行）：默认开
  let bookmarkCursor = $state(-1); // 上次跳转到的书签下标（Markdown 锚点数组；-1 = 未开始）
  /** 代码书签的行号 + 文本镜像：命令式读 CM 后写回，供侧边栏面板响应式消费 */
  let codeBookmarkInfo = $state<{ line: number; text: string }[]>([]);
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
  /** 自动保存间隔（分钟）：0.5 表示 30 秒；持久化键 "autoSaveIntervalMin"，默认 1 分钟 */
  let autoSaveIntervalMin = $state(1);

  /**
   * 默认打开模式：打开 / 新建 / 导入文档后先进阅读模式还是直接进编辑模式。
   * 只在「新文档落点」生效（见 resetToBrowseMode），不影响标签间切换时各自已有的模式。
   * 缺省为编辑模式（用户未设置过时也走这一支，见启动回填）。
   */
  let defaultOpenMode = $state<"read" | "edit">("edit");

  // ---- WebDAV 云同步（批次九）----
  // 配置持久化在 settings.json（密码另行经 DPAPI 加密存于 secrets.json）；davVerified 仍刻意不持久化，但改为
  // **启动时后台静默测一次连接**（见 initCloud）：成功即视为本会话已通过，于是已开启的
  // 云同步重启后会自动继续，既去掉了「每次手动点测试」的摩擦，也不会拿失效配置盲传。
  let davUrl = $state("");
  let davUser = $state("");
  let davPass = $state("");
  let davRoot = $state("/Sticho");
  let davUseHttps = $state(true); // 使用 HTTPS；关闭后允许明文 http 连接
  let davEnabled = $state(false); // 每次保存后自动上传
  let davVerified = $state(false); // 本会话内「测试连接」已通过

  // ---- 本地多版本控制（保存覆盖前留档，供「文件 → 文件历史」回溯）----
  // 三类上限（数量 / 容量 / 时长）各有独立开关；只有开启的那一项参与裁剪，
  // 超限一律从最老的版本开始删（见 Rust 侧 history.rs 的 prune）。
  let historyKeep = $state(20); // 数量上限：每份文档最多保留的版本数
  let historyCountLimitOn = $state(true); // 数量上限开关（默认开）
  let historySizeLimitOn = $state(false); // 容量上限开关（默认关）
  let historyMaxSizeMb = $state(100); // 容量上限：每份文档的版本总体积（MB）
  let historyAgeLimitOn = $state(false); // 时长上限开关（默认关）
  let historyMaxAgeDays = $state(30); // 时长上限：版本的最长保留天数
  // 冲突处理策略：copy = 另存冲突副本（默认，绝不丢数据）/ overwrite = 直接覆盖
  let davConflictPolicy = $state<"copy" | "overwrite">("copy");
  // 同步索引：本地路径 → 上次上传后记录的远端状态，供「远端是否被别的设备改过」判定
  let davSyncIndex = $state<Record<string, { remote: string; size: number; modified: number }>>({});
  let davTesting = $state(false); // 测试连接进行中
  let davTip = $state(""); // 设置面板里那行结论 / 错误提示
  let davSyncState = $state<"idle" | "busy" | "error">("idle"); // 状态栏同步指示
  let davSyncTip = $state(""); // 状态栏指示的 tooltip（失败详情）
  // 云端变更检测：本机同步过、但远端已被别的设备改过的文档（远端路径 + 显示名）。
  // 检测只做提示，绝不改动本地或云端内容——冲突防护仍由上传时的判定负责。
  let cloudUpdates = $state<{ remote: string; name: string }[]>([]);
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

  // ---- 配置文件保存位置（批次十 / 位置自动探测）----
  // 「系统目录」= %APPDATA%\Sticho；「当前程序目录」= exe 同目录下的 Sticho\（便携）。
  // 位置由 Rust 侧探测（程序目录优先，其次系统目录），这里只做展示与切换；切换后需重启才完全生效。
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
  /**
   * HTML 预览「执行文档内脚本」按标签各自保存（键为标签运行时 id）。
   *
   * 安全开关不能串台：一个标签开了脚本、切到另一个标签时，不应被误当成也开着——
   * 全局单开关在切换标签时会把执行态带过去，这正是本次修复的问题。
   */
  let htmlScriptsByTab = $state<Record<number, boolean>>({});
  /** 当前标签的「执行文档脚本」状态（无标签时恒为关）。
   *  读的是「当前标签」的值，供模板里的菜单勾选态与 iframe sandbox 属性使用。 */
  function currentHtmlScripts(): boolean {
    const tab = tabs[activeIndex];
    return tab ? htmlScriptsByTab[tab.id] === true : false;
  }
  /** 写入当前标签的「执行文档脚本」状态（按标签保存，切换标签互不影响） */
  function setCurrentHtmlScripts(value: boolean): void {
    const tab = tabs[activeIndex];
    if (tab) htmlScriptsByTab[tab.id] = value;
  }
  const htmlScripts = $derived(currentHtmlScripts());
  // 预览 DOM 是否已被改动（直接编辑或预览内替换）。决定要不要序列化回 htmlSource：
  // 没改过就不序列化，避免「只是切个视图」把源码整体重排一遍。
  let previewMutated = false;
  // iframe 的重建键：srcdoc 变化时 Svelte 会自动重载，但沙箱模式（sandbox 属性）变化
  // 不会对已加载的文档生效，必须换 key 强制重建。这里只在「正文或沙箱模式真的变了」时才自增，
  // 避免切换 HTML 标签 / 重开同一文件时无谓地重建 iframe。
  let previewKey = $state(0);
  /** 上次真正渲染进 iframe 的正文与沙箱模式，作为「是否需要重建」的比对基准 */
  let previewBuiltContent: string | null = null;
  let previewBuiltScripts = false;
  /** 按需重建 iframe：正文或沙箱模式与上次渲染相同则跳过（srcdoc 变化已由 Svelte 自行处理）。
   *  previewMutated 表示当前 DOM 已与源码不一致（预览里直接编辑过），此时即便正文串没变也必须重建，
   *  才能把 DOM 恢复成源码的样子；force 供「上一个标签的 DOM 还留着改动」这类调用方使用。 */
  function rebuildPreview(content: string, force = false): void {
    if (!force && content === previewBuiltContent && htmlScripts === previewBuiltScripts && !previewMutated) {
      return;
    }
    previewBuiltContent = content;
    previewBuiltScripts = htmlScripts;
    previewMutated = false; // 重建后 DOM 由源码生成，与源码一致
    previewKey += 1;
  }
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
      (docKind === "markdown" && (editorMode === "sv" || editorMode === "none" || largeReading)) ||
      (docKind === "html" && htmlView === "source"),
  );

  /** HTML 源码视图的行号叠层是否应当出现（跟随总开关与当前视图） */
  const htmlGutterOn = $derived(
    docKind === "html" && htmlView === "source" && showLineNumbers && lineNumbersSupported,
  );

  /** 叠层逐行渲染用的源码行（仅在叠层可见时才拆分，避免编辑时白白 split 大文本） */
  const htmlSourceLines = $derived(htmlGutterOn ? htmlSource.split(/\r\n|\r|\n/) : []);

  /**
   * Markdown「不渲染」模式：只保留 SV 源码栏，渲染结果栏由 CSS 隐藏（见 app.css 的
   * .md-source-only）。用于根节点挂类名，非 Markdown 文档恒为 false。
   */
  const mdSourceOnly = $derived(docKind === "markdown" && editorMode === "none");

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
  let docEol = $state<Eol>("\n"); // 当前文档行尾风格（保存时按它还原，避免 Markdown 被 Vditor 规整成 LF）
  let encodingOpen = $state(false); // 状态栏编码下拉是否展开
  let codeLangOpen = $state(false); // 状态栏「语法高亮方案」下拉是否展开
  let modeOpen = $state(false); // 状态栏文档模式下拉是否展开

  // ---- 侧边栏（阶段 11）----
  let sidebarVisible = $state(true);
  let sidebarView = $state<SidebarView>("outline");
  /**
   * 侧边栏各面板各自的开关（视图 → 侧边栏 里的勾选项）。
   * 面板开关只决定「该面板是否作为可切换的视图存在」；同一时刻仍只显示一个面板
   * （sidebarView）。全部关闭时侧边栏没有任何内容可显示，会自动收起。
   *
   * 初始默认只启用「文件目录树 / 文档大纲 / 书签」三项；属性、搜索、云端三项默认不选中，
   * 用户可在「视图 → 侧边栏」里按需打开。
   *
   * 同时开启的面板数上限为 MAX_SIDEBAR_PANELS（5 个）：面板多了之后标签栏会挤成一排，
   * 超出时弹一次提示、不改状态（见 sidebarLimitReached）。
   */
  let sidebarPanels = $state<Record<SidebarView, boolean>>({
    tree: true,
    outline: true,
    bookmarks: true,
    props: false,
    search: false,
    cloud: false,
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
  let subOpen2 = $state<string | null>(null); // 展开的三级菜单标签

  // ---- 左上角图标按钮（阶段 12）：软件设置 / 皮肤设置 ----
  let settingsOpen = $state(false); // 软件设置面板
  // 当前标签：具体标签清单与文案由 SettingsModal 组件自带，这里只保留受控状态
  let settingsTab = $state<"general" | "save" | "assoc" | "cloud">("general");
  let skinOpen = $state(false); // 皮肤设置面板
  let themeFiles = $state<ThemeFile[]>([]); // 自定义主题目录里的 .css（批次八）
  let userTheme = $state<string | null>(null); // 当前选用的自定义主题文件名
  let fontPacks = $state<FontPack[]>([]); // 字体包目录里的字体文件（批次十二）

  // ---- 顶栏「工具栏自定义」按钮：勾选项以小图标显示在皮肤按钮左侧（皮肤设置 → 工具栏）----
  /** 可在顶栏显示的自定义按钮 id */
  type ToolbarButtonId = "find" | "undo" | "redo" | "save" | "recovery" | "fullscreen";
  type ToolbarButtonDef = {
    id: ToolbarButtonId;
    /** 浮窗提示里的按钮名（i18n 键，以英文原文为键） */
    label: string;
    run: () => void;
    /** 当前不可用（非 Markdown 文档 / 阅读模式 / 正在忙） */
    disabled: () => boolean;
  };
  /** 六个可勾选的顶栏按钮：撤销 / 重做 / 全屏是 Vditor 的能力，仅在 Markdown 文档下可用 */
  const TOOLBAR_BUTTONS: ToolbarButtonDef[] = [
    {
      id: "save",
      label: "Save",
      run: () => void saveFile(),
      disabled: () => busy,
    },
    {
      id: "undo",
      label: "Undo",
      run: undoEditor,
      disabled: () => docKind !== "markdown" || browseMode,
    },
    {
      id: "redo",
      label: "Redo",
      run: redoEditor,
      disabled: () => docKind !== "markdown" || browseMode,
    },
    {
      id: "find",
      label: "Find…",
      run: () => void openFind(),
      disabled: () => false,
    },
    {
      // 文件恢复中心：与「文件 → 恢复中心…」同一入口，统一浏览恢复草稿与本地版本历史
      id: "recovery",
      label: "Recovery Center…",
      run: () => {
        recoveryOpen = true;
      },
      disabled: () => false,
    },
    {
      id: "fullscreen",
      label: "Fullscreen",
      run: toggleEditorFullscreen,
      disabled: () => docKind !== "markdown",
    },
  ];
  let toolbarButtons = $state<Record<ToolbarButtonId, boolean>>({
    find: false,
    undo: false,
    redo: false,
    save: false,
    recovery: false,
    fullscreen: false,
  });
  /** 勾选 / 取消某个顶栏按钮并持久化 */
  async function toggleToolbarButton(id: ToolbarButtonId): Promise<void> {
    const next = { ...toolbarButtons, [id]: !toolbarButtons[id] };
    toolbarButtons = next;
    await saveSetting("toolbarButtons", next);
  }

  // ---- 界面语言（批次八；批次十四改由语言包提供词表；批次十五起默认中文，可在首次运行引导里改）----
  let locale = $state<Locale>("zh-CN");
  /** 语言包目录里已加载的语言包（含内置释放的 zh-CN / en-US） */
  let localePacks = $state<LocalePack[]>([]);
  /**
   * 当前语种的词表：以内置词表打底，再叠加语言包词条（语言包可逐条覆盖内置译文）。
   *
   * 不用「有语言包就整体替换」：旧版本释放的 locales/zh-CN.json 只含 `_label`、
   * 没有词条（当时以中文为键，无需译文），整体替换会让查表全部落空而回落英文，
   * 表现为「切到中文却仍是英文」。以 ZH 打底即可兜住这类陈旧语言包。
   */
  const activeEntries = $derived.by(() => {
    const base = locale === "zh-CN" ? ZH : {};
    const pack = localePacks.find((p) => p.id === locale);
    return pack ? { ...base, ...pack.entries } : base;
  });
  /** 翻译函数：以英文原文为键；语种或词表变化时重建，界面文案随之刷新 */
  const t = $derived(makeTFrom(activeEntries));
  /** 语言下拉项：内置两种始终在列，再并入语言包里的其它语种（按 id 去重） */
  const localeOptions = $derived.by(() => {
    const out = [...LOCALES];
    for (const pack of localePacks) {
      if (!out.some((o) => o.id === pack.id)) out.push({ id: pack.id, label: pack.label });
    }
    return out;
  });

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

  /**
   * 新建文档的欢迎正文：优先取配置目录 `docs/Welcome.<locale>.md` 的正文（用户可自由修改），
   * 读不到时回落内置文案。文档内容不随切换语言重译——只在「新建标签 / 首次打开」时取当时的语言，
   * 之后它就是普通正文，用户改动与保存都不受影响。
   */
  function welcomeText(): string {
    return welcomeFor(locale) ?? builtinWelcomeText();
  }

  /** 内置欢迎文案（配置目录里没有对应文档时的回落） */
  function builtinWelcomeText(): string {
    return `# ${t("Welcome to Sticho")}

${t("Type to start, or load a .md / .html file via File → Open.")}

${t("Drag md / html / docx / pdf files into the window to open them directly.")}
`;
  }

  // ---- 多标签页（批次六）----
  // 顶层 $state 仍是活跃标签的唯一真源；tabs 只在切换 / 关闭 / 落草稿时被搬运（见 lib/docState.ts）。
  let tabSeq = 0;
  function createTab(): DocTab {
    tabSeq += 1;
    return newDocTab(tabSeq, welcomeText());
  }

  let tabs = $state<DocTab[]>([createTab()]);
  let activeIndex = $state(0);
  /** 编辑器就绪前不要去读 getEditorValue（会抛错），标签搬运整体延后到 whenEditorReady 之后 */
  let tabsReady = false;
  /** 上次写入的会话 JSON：内容没变就不重复写 settings.json */
  let lastSessionJson = "";
  /** 标签栏右键菜单：屏幕坐标 + 被右键的标签下标（null = 未打开） */
  let tabMenu = $state<{ x: number; y: number; index: number } | null>(null);
  /** 文档区右键菜单：屏幕坐标（null = 未打开）。仅代码 / Markdown 文档自绘 */
  let docMenu = $state<{ x: number; y: number } | null>(null);

  /** 某标签的本地磁盘路径（活跃标签读全局，其余读快照；云端专属标签为 null） */
  function tabPathAt(index: number): string | null {
    return index === activeIndex ? currentPath : (tabs[index]?.path ?? null);
  }

  /** 活跃标签 */
  function activeTab(): DocTab | undefined {
    return tabs[activeIndex];
  }

  /** 标签栏显示名 / 未保存圆点：活跃项读全局（未及时搬运时也始终是最新的），其余读快照 */
  function tabTitle(index: number): string {
    const tab = tabs[index];
    const path = index === activeIndex ? currentPath : (tab?.path ?? null);
    if (path) return fileName(path);
    // 无本地文件但绑定了云端路径的文档：用远端文件名做标签标题
    const remote = index === activeIndex ? currentRemote : (tab?.remote ?? null);
    if (remote) return fileName(remote);
    return t("Untitled");
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
    tab.remote = currentRemote;
    tab.encoding = encoding;
    tab.eol = docEol;
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
    if (docKind === "code") tab.bookmarks.code = codeLargeText === null ? getCodeBookmarkPositions() : [];
    tab.loaded = true;
  }

  /**
   * 把某个标签的快照投影回全局状态，并让编辑器显示它的正文。
   *
   * 切换期间全程置 `busy`（并保存/恢复调用方原有的 busy）：本函数会**先同步**改写
   * 全局身份（docKind / currentPath / encoding），随后才 await 换正文。若此时放行
   * Ctrl+S，`currentText()` 会拿到尚未换好的正文（见 codeText 的注释），把空串或
   * 上一个标签的内容写进新文件路径。busy 一置，saveFile / 其它写入口的 `if (busy) return`
   * 就能挡住这段窗口。
   */
  async function activateTab(index: number): Promise<void> {
    const tab = tabs[index];
    if (!tab) return;
    const wasBusy = busy;
    busy = true;
    try {
      await activateTabInner(tab, index);
    } finally {
      busy = wasBusy;
    }
  }

  /** 真正的切换实现（由 activateTab 包一层 busy 保护） */
  async function activateTabInner(tab: DocTab, index: number): Promise<void> {
    if (!tab.loaded) await loadTabContent(tab); // 会话恢复出来的标签：正文此刻才读盘
    activeIndex = index;
    diskMtime = null; // 先清掉基准：读盘 / 重建 iframe 期间不能让轮询拿着旧时间误报「外部变更」

    docKind = tab.kind;
    currentPath = tab.path;
    currentRemote = tab.remote ?? null;
    encoding = tab.encoding;
    docEol = tab.eol;
    dirty = tab.dirty;
    htmlView = tab.htmlView;
    // 「执行文档脚本」不再在此重置：它已按标签各自保存在 htmlScriptsByTab 里，
    // 切换标签时 htmlScripts（$derived）会自动读回该标签的值，不该被统统清成关。
    // 上一个标签若在预览里直接改过 DOM（尚未重建），切换后必须重建 iframe，否则会看到它的 DOM：
    // 要在把 previewMutated 投影成目标标签的值之前先把上一份记下来。
    const priorPreviewMutated = previewMutated;
    previewMutated = tab.previewMutated;
    if (tab.path) treeRoot = parentDir(tab.path);
    setDocumentPath(tab.path); // 图片落盘目录 / 相对路径换算都跟随各自文档

    // 离开超大代码文件标签时必须清掉 codeLargeText：它只在代码文档通路上被赋值
    // （showCodeEditor 置 null、showCodePlain 置值），markdown 与 html 分支若不清理，
    // 这台 markdown 文档会继续被当成超大代码文件——Ctrl+E 被挡下、新开文档强制阅读模式、
    // 文本工具与三种模式切换的菜单整组置灰。
    if (tab.kind !== "code") codeLargeText = null;

    if (tab.kind === "html") {
      htmlSource = tab.content;
      previewDoc = tab.content;
      // 正文或沙箱模式真的变了才重建，否则沿用现有 iframe（srcdoc 变化 Svelte 会自动重载）
      rebuildPreview(tab.content, priorPreviewMutated);
    } else if (tab.kind === "code") {
      htmlSource = "";
      previewDoc = "";
      await showCodeDoc(tab.content, tab.path);
    } else {
      htmlSource = "";
      previewDoc = "";
      setEditorValue(tab.content);
    }

    bookmarkCursor = -1;
    if (tab.kind === "code") {
      if (codeLargeText === null) setCodeBookmarks(tab.bookmarks.code);
      else clearCodeBookmarks();
      codeBookmarkInfo = getCodeBookmarks();
    } else {
      codeBookmarkInfo = [];
    }
    // 书签以磁盘（配置目录 bookmarks/）为准：先把内存快照投影上去，再读回覆盖
    if (shouldLoadBookmarks(tab)) await loadStoredBookmarks(tab);

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
      await messageDialog(t("Very large code files open as read-only sections and cannot be switched to edit mode."), {
        title: "Sticho",
        kind: "info",
      });
      return;
    }
    if (!on && isLargeDocMode()) {
      const ok = await confirmDialog(
        t("This is a large document, opened with section-by-section rendering for smooth reading (the text is not directly editable).\nSwitching to edit mode re-renders the entire document at once and may lag noticeably.\nContinue?",
        ),
        { title: "Sticho", kind: "info", okLabel: t("Switch to Edit Mode"), cancelLabel: t("Cancel") },
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
      // 取值必须在清标记之前：它是当前（代码）模式的正文
      const text = currentText();
      // 离开代码模式时清掉超大规模标记（同 activateTabInner），
      // 否则 markdown / html 模式会继承超大代码文件的那套守卫
      if (mode !== "code") codeLargeText = null;
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
        htmlView = "preview";
        setCurrentHtmlScripts(false); // 脚本执行按文档逐个开启，不跨模式沿用
        rebuildPreview(text); // 切模式后正文或沙箱变化才重建 iframe
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
    const pristine = currentPath === null && currentRemote === null && docKind === "markdown" && !dirty;
    if (!pristine) {
      captureActiveTab();
      tabs.push(createTab());
      activeIndex = tabs.length - 1;
      await updateTitle();
    }
    // 新标签默认不绑定云端：打开逻辑若需要（openCloudContent）会自行重建绑定。
    // 必须放在 captureActiveTab 之后——上一个标签要把它的远端绑定先搬回快照。
    currentRemote = null;
    // 本函数直接改 activeIndex、不走 activateTab（因此不经过 activateTabInner 的复位），
    // 而来源可能是「刚从一个超大代码标签切过来」——不在这里清掉超大规模标记，
    // 新文档会被下面的 resetToBrowseMode 当成大文档强制只读、Ctrl+E 也会被挡下。
    // 目标本身若是代码文件，稍后的 showCodeDoc 会按新正文重新赋值。
    codeLargeText = null;
    await run();
    // 刚打开的文档也要把磁盘上的书签装回来：本函数是「直填全局状态」的落点，
    // 不走 activateTab，不在这里补一次，重开后书签就会像「没保存」一样消失。
    const openedTab = tabs[activeIndex];
    if (openedTab && shouldLoadBookmarks(openedTab)) await loadStoredBookmarks(openedTab);
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
    // 与 closeOtherTabs / closeTabsAt 同口径：整个流程置 busy。
    // 否则确认框挂着时再按一次 Ctrl+W，第二个 askChoice 会覆盖 choiceResolve，
    // 第一个 Promise 永不结算，那次关闭静默作废。
    busy = true;
    try {
      if (index === activeIndex) captureActiveTab();

      if (tabDirty(index)) {
        const choice = await askChoice(
          t("“{name}” has unsaved changes.", { name: tabTitle(index) }),
          [
            { label: t("Save"), value: "save", primary: true },
            { label: t("Don't Save"), value: "discard" },
            { label: t("Cancel"), value: "cancel" },
          ],
          t("Close Tab"),
        );
        if (choice === null || choice === "cancel") return;
        if (choice === "save") {
          if (index !== activeIndex) await activateTab(index);
          await saveFile(true); // 外层已置 busy：强制保存，否则会被守卫拦下
          if (dirty) return; // 没保存成功：不关
        }
      }

      void deleteRecovery(tab.draftId).catch(() => {}); // 标签没了，它的草稿也该清掉
      delete htmlScriptsByTab[tab.id]; // 「执行文档脚本」的开关也按标签存的，一并回收
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
    } finally {
      busy = false;
    }
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
          t("{n} other tab(s) have unsaved changes that will be discarded. Continue?", { n: dirtyOthers }),
          [
            { label: t("Save All"), value: "save", primary: true },
            { label: t("Don't Save"), value: "discard" },
            { label: t("Cancel"), value: "cancel" },
          ],
          t("Close Other Tabs"),
        );
        if (choice === null || choice === "cancel") return;
        if (choice === "save") {
          // 逐个切过去保存：下标在保存期间不变（此时还没删标签）
          for (let i = 0; i < tabs.length; i++) {
            if (i === keepIndex || !tabDirty(i)) continue;
            await activateTab(i);
            await saveFile(true); // 外层已置 busy：强制保存，否则会被守卫拦下
            if (dirty) return; // 没保存成功：不关
          }
        }
      }

      // 从后往前删，跳过保留项，避免下标漂移
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (i === keepIndex) continue;
        const tab = tabs[i]!;
        void deleteRecovery(tab.draftId).catch(() => {}); // 标签没了，它的草稿也该清掉
        delete htmlScriptsByTab[tab.id]; // 「执行文档脚本」的开关随标签一起回收
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

  /**
   * 批量关闭给定下标集合（标签右键「关闭右侧/左侧标签」）。
   *
   * 与 closeOtherTabs 守同样的底线：
   * 1. 逐个检测每个待关闭标签的保存状态（tabDirty），有任一未保存就先弹一次确认
   *    （全部保存 / 不保存 / 取消）；
   * 2. 「全部保存」中途失败（取消了另存为、或写盘报错）就整体放弃，一个标签都不关。
   */
  async function closeTabsAt(indices: number[], title: string): Promise<void> {
    if (busy) return;
    const targets = [...new Set(indices)]
      .filter((i) => i >= 0 && i < tabs.length)
      .sort((a, b) => a - b);
    if (targets.length === 0) return;
    busy = true;
    try {
      captureActiveTab();
      const keepId = tabs[activeIndex]?.id; // 记住用户原本停留的标签，关完后尽量回到它

      const dirtyTargets = targets.filter((i) => tabDirty(i));
      if (dirtyTargets.length > 0) {
        const choice = await askChoice(
          t("{n} tab(s) have unsaved changes that will be discarded. Continue?", { n: dirtyTargets.length }),
          [
            { label: t("Save All"), value: "save", primary: true },
            { label: t("Don't Save"), value: "discard" },
            { label: t("Cancel"), value: "cancel" },
          ],
          title,
        );
        if (choice === null || choice === "cancel") return;
        if (choice === "save") {
          // 逐个切过去保存：下标在保存期间不变（此时还没删标签）
          for (const i of dirtyTargets) {
            await activateTab(i);
            await saveFile(true); // 外层已置 busy：强制保存，否则会被守卫拦下
            if (dirty) return; // 没保存成功：不关
          }
        }
      }

      // 从后往前删，避免下标漂移
      const remove = new Set(targets);
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (!remove.has(i)) continue;
        const tab = tabs[i]!;
        void deleteRecovery(tab.draftId).catch(() => {}); // 标签没了，它的草稿也该清掉
        delete htmlScriptsByTab[tab.id]; // 「执行文档脚本」的开关随标签一起回收
        tabs.splice(i, 1);
      }

      const keptIndex = keepId === undefined ? -1 : tabs.findIndex((tab) => tab.id === keepId);
      if (tabs.length === 0) {
        tabs.push(createTab());
        await activateTab(0);
      } else if (keptIndex >= 0) {
        await activateTab(keptIndex);
      } else {
        // 原本停留的标签也被关掉了：落到最靠近的一个（优先被关集合的右邻，越界则最左）
        await activateTab(Math.min(targets[0]!, tabs.length - 1));
      }
      void saveSession();
    } finally {
      busy = false;
    }
  }

  /** 标签右键：关闭某标签右侧的全部标签（集合为空时不执行） */
  function closeTabsRight(index: number): void {
    const indices: number[] = [];
    for (let i = index + 1; i < tabs.length; i++) indices.push(i);
    if (indices.length === 0) return;
    void closeTabsAt(indices, t("Close Tabs to the Right"));
  }

  /** 标签右键：关闭某标签左侧的全部标签（集合为空时不执行） */
  function closeTabsLeft(index: number): void {
    const indices: number[] = [];
    for (let i = 0; i < index; i++) indices.push(i);
    if (indices.length === 0) return;
    void closeTabsAt(indices, t("Close Tabs to the Left"));
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

  /**
   * 标签右键菜单的动作：先收浮层再执行，免得确认对话框被浮层压住。
   *
   * 关闭类动作作用于被右键的那个标签、无需切换；其余都是「文档级」操作（打开文件位置 /
   * 保存 / 另存为 / 文件属性），先把该标签切为活跃再执行，让上下文与操作对象一致。
   */
  async function runTabMenu(
    action: "close" | "closeOther" | "closeRight" | "closeLeft" | "reveal" | "save" | "saveAs" | "properties",
  ): Promise<void> {
    const menu = tabMenu;
    tabMenu = null;
    if (!menu) return;
    if (action === "close") return void closeTab(menu.index);
    if (action === "closeOther") return void closeOtherTabs(menu.index);
    if (action === "closeRight") return closeTabsRight(menu.index);
    if (action === "closeLeft") return closeTabsLeft(menu.index);

    // 文档级操作：先切到被右键的标签（避免对错误的文档下手）
    if (menu.index !== activeIndex) await activateTab(menu.index);
    if (action === "reveal") return void revealInExplorer();
    if (action === "save") return void saveFile();
    if (action === "saveAs") return void saveFileAs();
    if (action === "properties") return void showFileInfo();
  }

  /**
   * 文档区右键菜单：文档自身支持书签（代码 / Markdown）时自绘一套「标准编辑项 + 添加为书签」。
   * HTML 模式保留原生菜单（iframe / 源码 textarea 有自己的交互），不接管。
   */
  function openDocMenu(e: MouseEvent): void {
    if (docKind === "html") return;
    e.preventDefault();
    // 贴边时往回缩，免得菜单被窗口边缘截掉
    docMenu = {
      x: Math.min(e.clientX, window.innerWidth - 170),
      y: Math.min(e.clientY, window.innerHeight - 190),
    };
  }

  /** 当前（含代码模式）选中文字，供右键菜单「复制 / 剪切」判断有无可选内容 */
  function docSelectionText(): string {
    return docKind === "code" ? getCodeSelectionText() : getEditorSelection();
  }

  /** 文档区右键菜单的动作：收浮层后按当前文档类型分发到对应编辑器 */
  async function runDocMenu(action: "cut" | "copy" | "paste" | "selectAll" | "bookmark"): Promise<void> {
    docMenu = null;
    if (action === "bookmark") return void addBookmark();
    if (action === "selectAll") {
      if (docKind === "code") selectAllCode();
      else selectAllEditorContent();
      return;
    }
    // 阅读模式下不允许改写正文（剪切 / 粘贴）
    if (browseMode && (action === "cut" || action === "paste")) return;
    if (docKind === "code") {
      if (action === "copy" || action === "cut") {
        const sel = getCodeSelectionText();
        if (!sel) return;
        try {
          await writeClipboardText(sel);
          if (action === "cut") deleteCodeSelection();
        } catch (e) {
          await showError(t(action === "cut" ? "Failed to cut: " : "Failed to copy: "), e);
        }
        return;
      }
      try {
        insertCodeText(await readClipboardText());
      } catch (e) {
        await showError(t("Failed to paste: "), e);
      }
      return;
    }
    // Markdown：复用编辑菜单既有剪贴板通路
    if (action === "cut") return void cutSelection();
    if (action === "copy") return void copySelection();
    return void pasteClipboard();
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
    try {
      await saveSetting("session", JSON.parse(json));
      // 只在写成功后才记下：先记再写的话，一次失败会让此后内容相同的会话
      // 永远走不进这个函数（早退），会话文件就停在更早的状态上，下次启动恢复不全
      lastSessionJson = json;
    } catch {
      // 会话是兜底机制，失败不打扰用户；内容下次变化时会重新尝试写入
    }
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
    return ms === null ? t("Unknown") : new Date(ms).toLocaleString("zh-CN", { hour12: false });
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
   * 写盘 / 上云专用的正文：在 currentText() 的基础上按当前文档的行尾风格还原 EOL。
   *
   * Markdown 走 Vditor，取值由 DOM 反推（Lute 的 VditorIRDOM2Md），行尾恒为 LF；
   * HTML 源码、CodeMirror 也各有自己的行尾习惯。统一在这里还原成文档原有的 CRLF / LF，
   * 打开一份 CRLF 文件再保存就不会被悄悄改成 LF。
   */
  function textForDisk(): string {
    return applyEol(currentText(), docEol);
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
      [t("File name"), currentPath ? fileName(currentPath) : currentRemote ? fileName(currentRemote) : t("Untitled")],
      // 云端文档没有本地路径：位置直接显示远端路径，便于确认编辑的是哪份云端文件
      [t("Location"), currentPath ?? currentRemote ?? t("Not saved to disk yet")],
    ];

    if (currentPath) {
      try {
        const info = await invoke<{ size: number; created: number | null; modified: number | null }>("get_file_info", { path: currentPath });
        rows.push([t("Size"), t("{size} ({bytes} bytes)", { size: formatSize(info.size), bytes: info.size.toLocaleString() })]);
        rows.push([t("Created"), formatTime(info.created)]);
        rows.push([t("Modified"), formatTime(info.modified)]);
      } catch (e) {
        rows.push([t("Disk info"), e instanceof Error ? e.message : String(e)]);
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
        rows.push([t("Front matter field {field}", { field }), text || t("(empty)")]);
      }
    }
    rows.push(
      [t("Words"), wordCount.toLocaleString()],
      [t("Characters"), charCount.toLocaleString()],
      [t("Lines"), lineCount.toLocaleString()],
      [t("Encoding"), t(encodingLabel(encoding))],
      [t("Format"), `${format}${dirty ? t("(unsaved changes)") : ""}`],
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
    setCurrentHtmlScripts(!htmlScripts); // 按标签保存：只改当前标签的开关
    // 执行脚本时父窗口读不到文档，预览也就无法可编辑——previewEditable 里已含这一条
    rebuildPreview(previewDoc); // 沙箱模式变了，必然重建 iframe（顺带复位 previewMutated）
    void refreshFileProps();
  }

  // ---- 窗口标题 ----
  async function updateTitle(): Promise<void> {
    // 云端文档没有本地路径，用远端文件名做标题；两者都没有才是「未命名」
    const name = currentPath ? fileName(currentPath) : currentRemote ? fileName(currentRemote) : t("Untitled");
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
      t("Overwrite the current editor content with this version? The version currently on disk will be archived first, so you can roll back again."),
      { title: "Sticho", kind: "warning", okLabel: t("Restore"), cancelLabel: t("Cancel") },
    );
    if (!ok) return;
    try {
      const { content, encoding: histEncoding } = await restoreHistory(currentPath, file);
      if (docKind === "html") {
        htmlSource = content;
        previewDoc = content;
        rebuildPreview(content); // 正文变了才重建 iframe
      } else if (docKind === "code") {
        // 代码文档同样要把恢复的内容写回编辑器（此前漏了这条分支，恢复对代码文件不生效）
        await showCodeDoc(content, currentPath);
      } else {
        setEditorValue(content);
      }
      // 历史正文按其原文件的行尾解码返回，而 Markdown 经 Vditor 取值一律是 LF：
      // 必须把行尾风格同步过来，否则保存时会用「恢复前」的风格把这份版本写回去。
      docEol = detectEol(content);
      // 同理，编码也要同步：快照存的是原始字节，不刷新编码，保存时会按恢复前的编码写回。
      encoding = histEncoding || "utf-8";
      dirty = true; // 恢复结果需要保存才写回磁盘，避免误覆盖
      // 重置外部变更比对基准：留档 / 读取历史版本会触碰磁盘，若不刷新基准，
      // 5 秒轮询会把这次恢复当成「文件被外部修改」立刻误报（且此时 dirty=true 会弹三选框）。
      await syncDiskMtime(currentPath);
      await refreshHistory();
      await updateTitle();
    } catch (e) {
      await showError(t("Failed to restore the version: "), e);
    }
  }

  /**
   * 点某个历史版本后的二级选择：「查看差异」或「恢复此版本」。
   *
   * 菜单渲染只支持两级，历史版本项本身已是「文件历史」的子项，无法再挂二级子菜单，
   * 因此这里用一个二选一对话框承接（复用 askChoice），不改动菜单渲染逻辑。
   */
  async function historyVersionMenu(file: string): Promise<void> {
    const pick = await askChoice(t("Actions for this version"), [
      { label: t("Compare with current content"), value: "diff", primary: true },
      { label: t("Overwrite current editor content with this version"), value: "restore" },
    ], t("File History"));
    if (pick === "diff") await openHistoryDiff(file);
    else if (pick === "restore") await restoreHistoryVersion(file);
  }

  /** 打开某历史版本与当前内容的差异视图（旧 = 历史版本，新 = 当前内容） */
  async function openHistoryDiff(file: string): Promise<void> {
    if (!currentPath) return;
    try {
      const { content: oldText } = await readHistory(currentPath, file);
      const newText = currentText();
      diffView = {
        title: t("Version Comparison"),
        leftLabel: t("History"),
        rightLabel: t("Current Content"),
        lines: diffLines(oldText, newText),
      };
    } catch (e) {
      await showError(t("Failed to read the version: "), e);
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
    /** 历史版本正文的原始行尾（草稿不带：草稿正文来自编辑器，行尾未知） */
    eol?: Eol;
  }): Promise<void> {
    const { content, kind, path } = payload;
    // 取回草稿前先查一次原文件：若它在本草稿保存之后又被外部改过，明确提示一次，
    // 免得用户以为恢复出来的就是磁盘上的最新内容（disk 是毫秒，草稿 saved_at 是 Unix 秒）。
    if (path) {
      const [meta, disk] = await Promise.all([
        listRecovery()
          .then((list) => list.find((d) => d.path === path && d.kind === kind))
          .catch(() => undefined),
        readDiskMtime(path).catch(() => null),
      ]);
      if (meta && disk !== null && disk > meta.saved_at * 1000) {
        await messageDialog(
          t("The original file has been updated externally since this draft was saved. The recovered content may not include those changes."),
          { title: "Sticho", kind: "warning" },
        );
      }
    }
    await loadIntoFreshTab(async () => {
      docKind = kind === "html" ? "html" : kind === "code" ? "code" : "markdown";
      currentPath = path;
      setDocumentPath(path);
      dirty = true; // 恢复出来的是历史内容，必须手动保存才写回磁盘
      encoding = payload.encoding || "utf-8";
      // 历史版本正文保留着它的原始行尾；草稿不带 eol（正文来自编辑器），保持当前风格不变
      if (payload.eol === "\r\n" || payload.eol === "\n") docEol = payload.eol;
      diskMtime = null;
      if (docKind === "html") {
        htmlSource = content;
        previewDoc = content;
        htmlView = "preview";
        setCurrentHtmlScripts(false);
        rebuildPreview(content);
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
      title: t("Export Diagnostics"),
      defaultPath: `Sticho-diagnostics-${stamp}.txt`,
      filters: [{ name: t("Text File"), extensions: ["txt"] }],
    });
    if (!path) return;
    try {
      await exportDiagnostics(path);
      await messageDialog(t("Diagnostics exported to:\n{path}", { path }), { title: "Sticho", kind: "info" });
    } catch (e) {
      await showError(t("Failed to export diagnostics: "), e);
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
      await showError(t("Failed to open (removed from the recent list): "), e);
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
    // 持久化语言覆盖：此前只存内存、重启就丢，用户设过的语言每次都要重设。
    // 存整份快照（展开成普通对象再序列化），避免把响应式代理写进配置。
    await saveSetting("codeLangOverrides", { ...codeLangOverrides });
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
      wrap: autoWrap,
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

  /**
   * 阅读排版落到代码视图：只取字号 / 行距 / 背景。
   *
   * 字体固定等宽栈、文字色由语法高亮决定，所以用户设的「字体」「文字颜色」在代码视图
   * 里不生效（需求约定）；「页面背景」则与 Markdown / 纯文本一致地生效。
   */
  function applyCodeReaderStyle(): void {
    const style: CodeReaderStyle = {};
    if (readerStyle.fontSize) style.fontSize = readerStyle.fontSize;
    if (readerStyle.lineHeight) style.lineHeight = readerStyle.lineHeight;
    if (readerStyle.background) style.background = readerStyle.background;
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
      void messageDialog(t(res.error), { title: t("Code tool failed"), kind: "error" });
      return;
    }
    if (selected !== "") replaceCodeSelection(res.text);
    else setCodeValue(res.text);
    syncFromCode();
  }

  /**
   * 执行一个文本工具（批量去空行、行尾空白、中英文混排加/去空格等）。
   *
   * 面向**整篇文档**（这些工具本身就是「批量」语义），三种文档模式都可用；
   * 写入方式按当前内核分派，撤销栈各留一步。超大代码文件是只读分节视图，菜单已置灰。
   */
  function applyTextTool(fn: (src: string) => string): void {
    const src = currentText();
    if (src.trim() === "") return;
    const text = fn(src);
    if (text === src) return; // 无实际变化就不写回，免得平白多一步撤销
    if (docKind === "code") {
      setCodeValue(text);
      syncFromCode();
    } else if (docKind === "html") {
      onHtmlInput(text);
    } else {
      setEditorValue(text);
      syncFromEditor();
    }
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
    currentRemote = null; // 打开本地文件：解除上一个文档的云端绑定
    dirty = false;
    encoding = file.encoding;
    docEol = detectEol(file.content); // 记下原文件的行尾风格，保存时还原
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
    currentRemote = null; // 打开本地文件：解除上一个文档的云端绑定
    setDocumentPath(path); // 正文里的相对路径图片要按文档所在目录换算成 asset URL
    dirty = false;
    encoding = file.encoding;
    docEol = detectEol(file.content); // 记下原文件的行尾风格，保存时还原
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
    htmlView = "preview";
    setCurrentHtmlScripts(false); // 执行脚本按文档逐个开启，不跨文档沿用
    // 正文或沙箱模式真的变了才重建：重新打开同一文件且内容未变时无需无谓重建
    rebuildPreview(file.content);
    currentPath = path;
    currentRemote = null; // 打开本地文件：解除上一个文档的云端绑定
    dirty = false;
    encoding = file.encoding;
    docEol = detectEol(file.content); // 记下原文件的行尾风格，保存时还原
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
      t("Converting to Markdown will lose the document's styling, layout, charts and other HTML formatting, and the original rendering cannot be restored.\n\nThe original .html file will not be modified; the result is a new, unsaved document. Continue?"),
      { title: "Sticho", kind: "warning", okLabel: t("Convert to Markdown"), cancelLabel: t("Cancel") },
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
      docEol = "\n"; // 新生成的文本用 LF
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
        title: t("Import HTML Document"),
        filters: [{ name: t("HTML Document"), extensions: ["html", "htm"] }],
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
        docEol = "\n"; // 新生成的文本用 LF
        setEditorValue(md);
        await updateTitle();
        await pushRecentFile(picked);
        refreshSideNow();
      });
    } catch (e) {
      await showError(t("Failed to import HTML: "), e);
    } finally {
      busy = false;
    }
  }

  /** Pandoc 官方安装页（自动下载不可用时的兜底出口） */
  const PANDOC_PAGE = "https://pandoc.org/installing.html";

  /** Microsoft Edge WebView2 Runtime 官方下载页（本软件运行所依赖的渲染内核） */
  const WEBVIEW2_PAGE = "https://developer.microsoft.com/microsoft-edge/webview2/";

  /**
   * 帮助菜单「下载支持组件…」：按需前往官网页下载 / 更新本软件的两个可选支持组件。
   * pandoc 负责 Word / LaTeX / Epub 转换，WebView2 是本软件运行依赖的渲染内核。
   */
  async function downloadSupportComponents(): Promise<void> {
    const choice = await askChoice(
      t("Sticho uses two optional support components. Choose one to open its official download page:"),
      [
        { label: t("Pandoc (Word / LaTeX / Epub conversion)"), value: "pandoc", primary: true },
        { label: t("Microsoft Edge WebView2 Runtime"), value: "webview" },
      ],
      t("Download Support Components"),
    );
    if (choice === "pandoc") await openUrl(PANDOC_PAGE);
    else if (choice === "webview") await openUrl(WEBVIEW2_PAGE);
  }

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
        t("Automatic installation failed:\n{detail}\n\nOpen the official download page to install manually?", { detail }),
        { title: "Sticho", kind: "warning", okLabel: t("Visit Website"), cancelLabel: t("Cancel") },
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
      t("Pandoc conversion engine not found.\n\nIt is used by “Import Word” and “Export LaTeX / Epub” (about 35 MB, one-time install). Skipping it does not affect other features."),
      [
        { label: t("Download & Install"), value: "install", primary: true },
        { label: t("Visit Website"), value: "page" },
        { label: t("Maybe Later"), value: "later" },
      ],
      t("Environment Check"),
    );

    if (choice === "install") {
      if (await installPandoc()) {
        await messageDialog(t("Pandoc is installed. You can now use “Import Word” and “Export LaTeX / Epub”."), {
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
      t("“{reason}” requires the Pandoc conversion engine (about 35 MB, downloaded from the official source to this machine, one time only).\nDownload it now?", { reason }),
      { title: "Sticho", kind: "info", okLabel: t("Download"), cancelLabel: t("Cancel") },
    );
    if (!ok) return false;
    return installPandoc(); // 失败时自动给出官网兜底
  }

  async function importWordPath(path: string): Promise<void> {
    if (!(await ensurePandoc(t("Import Word")))) return;
    const md = await invoke<string>("import_docx", { path });
    await loadIntoFreshTab(async () => {
      docKind = "markdown";
      currentPath = null;
      setDocumentPath(null);
      dirty = true;
      encoding = "utf-8";
      docEol = "\n"; // 新生成的文本用 LF
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
      docEol = "\n"; // 新生成的文本用 LF
      setEditorValue(markdown);
      await updateTitle();
      refreshSideNow();
    });
    await messageDialog(t("Imported {n} page(s). The conversion is best-effort; please check the heading levels and paragraph breaks and correct them if needed.", { n: pageCount }), {
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
        title: t("Open Document"),
        filters: [
          // 默认筛选器要能看见所有能打开的文件，代码扩展名统一读 codeLang 的白名单，
          // 免得出现「能拖进来但在这个对话框里选不到」
          // .txt 已归入代码白名单、按代码视图打开，所以这里不再单列
          { name: t("All Supported Documents"), extensions: ["md", "markdown", "html", "htm", ...CODE_EXTS_SORTED] },
          { name: "Markdown", extensions: ["md", "markdown"] },
          { name: "HTML", extensions: ["html", "htm"] },
          { name: t("Code File"), extensions: [...CODE_EXTS_SORTED] },
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
      await showError(t("Failed to open: "), e);
    } finally {
      busy = false;
    }
  }

  /**
   * 保存当前文档（Ctrl+S）。
   *
   * `force` 专供「关闭其他/左侧/右侧标签 → 全部保存」这类**已经在 busy 临界区内**
   * 的批量流程调用：它们本就需要串行保存，外层已置 busy，若再被这里的 busy 守卫
   * 拦下，保存会静默失败（旧行为即如此：Save All 实际一个都没保存、随后整体放弃）。
   * force=true 时绕过守卫，但仍保存/恢复外层 busy，不破坏临界区。
   */
  async function saveFile(force = false): Promise<void> {
    if (busy && !force) return;
    // 云端文档：没有本地文件，按记录的远端路径直接写回云端
    if (currentPath === null && currentRemote !== null) return saveCloudBound();
    if (currentPath === null) return saveFileAs(force);
    const wasBusy = busy;
    busy = true;
    try {
      syncHtmlFromPreview(); // 预览里直接编辑的改动先落回源码
      // 正文统一走 currentText()：markdown / html / code 三种内核都能写对
      await writeTextFile(currentPath, textForDisk(), encoding);
      dirty = false;
      await updateTitle();
      refreshSideNow();
      await syncDiskMtime(currentPath); // 自己刚写的文件，别让轮询误判成「外部变更」
      clearRecoveryDraftsForDoc(currentPath); // 磁盘已是最新，该文档的自动保存草稿一并清空
      if (davEnabled && davVerified) syncToCloud(currentPath); // 云同步：不 await，不拖慢本地保存
    } catch (e) {
      await showError(t("Failed to save: "), e);
    } finally {
      busy = wasBusy;
    }
  }

  async function saveFileAs(force = false): Promise<void> {
    if (busy && !force) return;
    const wasBusy = busy;
    busy = true;
    try {
      const isHtml = docKind === "html";
      const isCode = docKind === "code";
      syncHtmlFromPreview(); // 同上：另存也要带上预览里的改动
      const picked = await saveDialog({
        title: isHtml ? t("Save HTML File") : isCode ? t("Save Code File") : t("Save Markdown File"),
        defaultPath: currentPath
          ? fileName(currentPath)
          : isHtml
            ? `${t("Untitled")}.html`
            : isCode
              ? `${t("Untitled")}.${codeExt || "txt"}`
              : `${t("Untitled")}.md`,
        filters: isHtml
          ? [{ name: "HTML", extensions: ["html", "htm"] }]
          : isCode
            ? [{ name: t("Code File"), extensions: codeExt ? [codeExt] : [...CODE_EXTS_SORTED] }]
            : [{ name: "Markdown", extensions: ["md"] }],
      });
      if (typeof picked !== "string") return; // 用户取消
      // 另存可能换扩展名（.txt → .py），而语言覆盖是按路径查的，
      // 所以「变更前」的生效语言必须在改写 currentPath 之前先取出来
      const langBefore = isCode ? effectiveCodeLangId(codeExt, currentPath) : null;
      // 另存为会换掉文档身份（未命名 → 路径 / 云端 → 本地）：先记下旧身份，
      // 好把书签从旧 owner 迁到新路径，否则按新路径重开时书签会读不到。
      const active = tabs[activeIndex];
      const ownerBefore = active ? bookmarkOwner(active) : "";
      await writeTextFile(picked, textForDisk(), encoding);
      currentPath = picked;
      currentRemote = null; // 另存为落到本地文件：解除云端绑定，后续保存写本地
      setDocumentPath(picked); // 另存后图片落盘目录随之改变
      dirty = false;
      treeRoot = parentDir(picked);
      // 同步刷新当前标签快照的路径与未保存状态：否则后续再保存仍会写回旧路径，
      // 标签栏也还显示旧文件名 / 未保存圆点（与已落盘的事实不符）。
      if (active) {
        active.path = picked;
        active.remote = null; // 另存为落到本地：快照里的云端绑定一并解除
        active.dirty = false;
      }
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
      clearRecoveryDraftsForDoc(picked); // 另存后：该文档（含未命名时期的草稿）一律清空
      // 书签改挂到新身份下，并清掉旧身份遗留的文件（内存里的书签此刻已是权威）。
      // 顺序必须是「先写新键、写成功再删旧键」：反过来先删后写，一旦中途失败书签就丢了。
      if (active) {
        const ownerAfter = bookmarkOwner(active);
        if (ownerBefore && ownerBefore !== ownerAfter) {
          void persistBookmarks(active).then(() => bookmarksDelete(ownerBefore)).catch(() => {});
        } else {
          void persistBookmarks(active);
        }
      }
      if (davEnabled && davVerified) syncToCloud(picked); // 云同步同 saveFile
    } catch (e) {
      await showError(t("Failed to save: "), e);
    } finally {
      busy = wasBusy;
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
   * 判定逻辑已抽到 lib/autoSave.ts（批次 3.3），这里只注入组件状态与回调。
   */
  async function checkExternalChange(): Promise<void> {
    await runExternalChangeCheck({
      getBusy: () => busy,
      getChecking: () => externalChecking,
      getCurrentPath: () => currentPath,
      getDiskMtime: () => diskMtime,
      getDirty: () => dirty,
      // 窗口不可见（最小化 / 切到后台）时跳过：既省掉无谓的 IPC + 文件 stat，
      // 也避免在用户看不到窗口时弹出「文件已被外部修改」的模态框。
      isVisible: () => document.visibilityState === "visible",
      readDiskMtime,
      reloadFromDisk,
      saveFileAs,
      ask: askChoice,
      setChecking: (v) => {
        externalChecking = v;
      },
      setDiskMtime: (v) => {
        diskMtime = v;
      },
      labels: {
        message: t("The file was modified externally and this document has unsaved changes. Reloading will discard them."),
        reload: t("Reload"),
        keep: t("Keep Mine"),
        saveAs: t("Save As…"),
        title: t("File Changed Externally"),
      },
    });
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
      const ok = await confirmDialog(t("Re-reading the file from disk with the new encoding will discard current unsaved changes. Continue?"), {
        title: "Sticho",
        kind: "warning",
        okLabel: t("Continue"),
        cancelLabel: t("Cancel"),
      });
      if (!ok) return;
    }

    busy = true;
    try {
      const file = await readTextFile(currentPath, id ?? undefined);
      encoding = file.encoding;
      docEol = detectEol(file.content); // 换编码重读后，行尾风格随之刷新
      dirty = false;
      if (docKind === "html") {
        htmlSource = file.content;
        previewDoc = file.content; // 重新渲染预览
        setCurrentHtmlScripts(false);
        // 编码可能没变（正文串相同）也需重建：previewMutated 为真时会强制重建，否则按需跳过
        rebuildPreview(file.content);
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
          t("Unrecognized bytes were encountered while decoding as “{enc}” (shown as a replacement character). This encoding may not be the file's real encoding; use auto-detect or another encoding.", { enc: t(encodingLabel(encoding)) }),
          { title: "Sticho", kind: "warning" },
        );
      }
    } catch (e) {
      await showError(t("Failed to re-read with that encoding: "), e);
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

  /**
   * 显示 / 隐藏侧边栏。
   *
   * 侧边栏的可见性由「启用侧边栏」这一开关独立掌控，与下面各面板是否勾选无关：
   * 勾选即显示、取消即隐藏（哪怕下面还勾着面板；反之哪怕一个面板都没勾也能打开）。
   * 展开时若确实一个面板都没勾选，自动补开文件树，避免出现一片空白的侧边栏。
   */
  const toggleSidebar = () => {
    if (!sidebarVisible && enabledSidebarViews.length === 0) {
      const next = { ...sidebarPanels, tree: true };
      sidebarPanels = next;
      void saveSetting("sidebarPanels", next);
    }
    return setSidebarVisible(!sidebarVisible);
  };

  async function setSidebarView(view: SidebarView): Promise<void> {
    sidebarView = view;
    sidebarVisible = true;
    refreshSideNow();
    await saveSetting("sidebarView", view);
    await saveSetting("sidebarVisible", true);
  }

  /** 侧边栏面板的固定排列顺序：文件树 → 大纲 → 书签 → 属性 → 搜索 → 云端 */
  const SIDEBAR_ORDER: SidebarView[] = ["tree", "outline", "bookmarks", "props", "search", "cloud"];
  /** 允许同时开启的面板数上限（超出则提示，见 sidebarLimitReached） */
  const MAX_SIDEBAR_PANELS = 5;
  /** 当前开启的面板（供菜单勾选态与「是否还有内容可显示」判断）。
   *  纯文本模式（code）没有大纲，临时把 outline 从可用集合里剔除（不改用户偏好，切回 markdown 恢复）。 */
  const enabledSidebarViews = $derived(
    SIDEBAR_ORDER.filter((v) => sidebarPanels[v] && !(v === "outline" && docKind === "code")),
  );

  /**
   * 开启新面板前的上限检查：已达上限则弹提示并返回 true（调用方据此中止）。
   *
   * 只数用户偏好（sidebarPanels 里 true 的项），不扣掉「当前文档模式下暂不可用」的大纲——
   * 上限约束的是偏好配置本身，与当前正看哪个文档无关。
   */
  async function sidebarLimitReached(): Promise<boolean> {
    const on = SIDEBAR_ORDER.filter((v) => sidebarPanels[v]).length;
    if (on < MAX_SIDEBAR_PANELS) return false;
    await messageDialog(
      t("Up to {n} sidebar panels can be shown at once. Turn one off before enabling another.", { n: MAX_SIDEBAR_PANELS }),
      { title: "Sticho", kind: "warning" },
    );
    return true;
  }

  /** 确保某面板处于开启状态并切到它，同时把侧边栏显示出来 */
  async function showSidebarView(view: SidebarView): Promise<void> {
    if (!sidebarPanels[view]) {
      if (await sidebarLimitReached()) return;
      const next = { ...sidebarPanels, [view]: true };
      sidebarPanels = next;
      await saveSetting("sidebarPanels", next);
    }
    await setSidebarView(view);
  }

  /**
   * 侧边栏面板开关（视图 → 侧边栏 的各项）。
   * - 侧边栏收起、或该项尚未勾选：显示侧边栏并切到该面板（已达上限时先弹提示）；
   * - 取消一项后若还有别的面板开启，且当前正显示它，则切到剩下的第一个；
   * - 全部取消则侧边栏自动收起。
   */
  async function toggleSidebarPanel(view: SidebarView): Promise<void> {
    // 纯文本模式没有大纲：入口临时不可用，点了不生效（偏好不变，切回 markdown 自动恢复）
    if (view === "outline" && docKind === "code") return;
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

  // 纯文本模式没有大纲：切到 code 时若正停在大纲面板，自动落到其它可用面板；都不可用则收起侧边栏。
  // 只调整「当前视图」，不动 sidebarPanels 里的用户偏好——切回 markdown 后大纲自然恢复。
  $effect(() => {
    if (docKind !== "code" || sidebarView !== "outline") return;
    if (enabledSidebarViews.length === 0) void setSidebarVisible(false);
    else void setSidebarView(enabledSidebarViews[0]!);
  });

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
        await messageDialog(t("The tree only supports opening Markdown / HTML / plain-text / code files (a .{ext} file must be converted first).", { ext }), {
          title: "Sticho",
          kind: "info",
        });
    } catch (e) {
      await showError(t("Failed to open: "), e);
    } finally {
      busy = false;
    }
  }

  /** 手动指定目录树根目录（未打开文档时也能浏览） */
  async function pickTreeRoot(): Promise<void> {
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: t("Choose Folder as Tree Root") });
      if (typeof picked === "string") treeRoot = picked;
    } catch (e) {
      await showError(t("Failed to choose folder: "), e);
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
      await showError(t("Failed to set file association: "), e);
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
      await showError(t("Failed to set file association: "), e);
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
      // 传入当前界面语言：系统语言取不到时，Rust 侧据此决定菜单文案的中 / 英
      await setContextMenu(next, locale);
      contextMenu = next;
    } catch (e) {
      await showError(t("Failed to set context menu: "), e);
    } finally {
      assocBusy = false;
    }
  }

  /** 打开系统「默认应用」设置页 */
  async function openDefaultApps(): Promise<void> {
    try {
      await openDefaultAppsSettings();
    } catch (e) {
      await showError(t("Failed to open system settings: "), e);
    }
  }

  /**
   * 清理系统写入：撤销全部文件关联（含「替代系统记事本」覆盖的格式）+ 删除右键菜单项，
   * 使程序恢复到便携状态。先弹确认框告知影响范围，确认后执行并回读真实的关联/菜单状态。
   */
  async function clearSystemWrites(): Promise<void> {
    const answer = await askChoice(
      t(
        "This removes all changes Sticho made to the system: it reverts every file association (including the “replace Notepad” formats) and removes the “Open with Sticho” file context-menu item. Your documents and settings are not affected. Continue?",
      ),
      [
        { label: t("Clean Up"), value: "clear", primary: true },
        { label: t("Cancel"), value: "cancel" },
      ],
    );
    if (answer !== "clear") return;
    try {
      const warnings = await clearSystemIntegration();
      await loadAssocState(); // 成功后回读真实状态，勾选态随之复位
      if (warnings.length > 0) {
        await showError(t("Cleanup incomplete: "), new Error(warnings.join("\n")));
        return;
      }
      await askChoice(t("System integration has been cleaned up — Sticho is now portable again."), [
        { label: t("OK"), value: "ok", primary: true },
      ]);
    } catch (e) {
      await showError(t("Cleanup failed: "), e);
    }
  }

  /**
   * 一键清理全部配置文件：两次确认（第二次为后果最终警示），确认后删除配置根下的所有
   * 用户数据（位置标记保留，位置选择不丢），随后提示重启。
   * 内置包（内置主题 / 自带语言包 / 说明 / 欢迎页）下次启动会自动重新释放。
   */
  async function clearConfigFiles(): Promise<void> {
    const first = await askChoice(
      t(
        "This will delete all Sticho configuration files: settings, custom themes and language packs, bookmarks, recovery drafts and version history. This cannot be undone. Continue?",
      ),
      [
        { label: t("Continue"), value: "next", primary: true },
        { label: t("Cancel"), value: "cancel" },
      ],
    );
    if (first !== "next") return;
    const second = await confirmDialog(
      t(
        "Final confirmation: all configuration files will be permanently deleted and cannot be recovered. Built-in themes and language packs will be restored automatically on the next launch. Delete now?",
      ),
      {
        title: "Sticho",
        kind: "warning",
        okLabel: t("Delete All"),
        cancelLabel: t("Cancel"),
      },
    );
    if (!second) return;
    try {
      const warnings = await clearAllData();
      if (warnings.length > 0) {
        await showError(t("Cleanup incomplete: "), new Error(warnings.join("\n")));
      }
      const ok = await confirmDialog(
        t("Configuration files have been cleared. The app needs to restart to rebuild them. Restart now?"),
        {
          title: "Sticho",
          kind: "info",
          okLabel: t("Restart Now"),
          cancelLabel: t("Later"),
        },
      );
      if (ok) await restartWithSaveCheck();
    } catch (e) {
      await showError(t("Cleanup failed: "), e);
    }
  }

  /** 当前文档主名（导出对话框的默认文件名） */
  function docBaseName(): string {
    if (!currentPath) return t("Untitled");
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
      await showError(t("{title} failed: ", { title }), e);
    } finally {
      busy = false;
    }
  }

  // exportDocx / importPdf 走调用点动态加载：docx 与 pdfjs-dist 体积可观，
  // 却只有导出 Word / 导入 PDF 时才用得上，静态打进主包白白拖慢首帧
  const exportWord = () =>
    exportAs(t("Export as Word Document"), "docx", t("Word Document"), async (path, source) => {
      const [{ exportDocx }, { renderMermaidToPng }] = await Promise.all([
        import("./lib/export-docx"),
        import("./lib/mermaidImage"),
      ]);
      const { embedded, skipped } = await exportDocx(path, source, {
        baseDir: docDirPath(),
        renderMermaid: renderMermaidToPng,
        t,
      });
      // 有图片没能嵌入时给一次汇总说明（远端图、不支持格式、相对路径解析失败等）
      if (skipped.length) {
        const list = skipped.slice(0, 8).join("\n");
        const more = skipped.length > 8 ? t("\n…and {n} more", { n: skipped.length - 8 }) : "";
        await messageDialog(
          t("Embedded {n} image(s). The following images could not be embedded and fell back to placeholder text:\n{list}{more}", {
            n: embedded,
            list,
            more,
          }),
          { title: t("Export as Word Document"), kind: "warning" },
        );
      }
    });
  const exportPdfFile = () =>
    exportAs(t("Export as PDF Document"), "pdf", t("PDF Document"), (path, source) =>
      import("./lib/export-pdf").then((m) => m.exportPdf(path, source, docBaseName(), locale, docKind)),
    );
  // HTML 文档导出 HTML：源码原样写出（走 markdown-it 会把标签转义成文本）
  const exportHtmlFile = () =>
    docKind === "html"
      ? exportAs(t("Export as HTML Document"), "html", t("HTML Document"), (path, source) => writeTextFile(path, source, encoding))
      : exportAs(t("Export as HTML Document"), "html", t("HTML Document"), (path, source) =>
          import("./lib/export-html").then((m) =>
            // 代码 / 纯文本按 <pre> 原样出，只有 Markdown 走渲染（与 exportPdf 同口径）
            m.exportHtml(path, source, locale, activeEntries, docKind === "code" ? "code" : "markdown"),
          ),
        );
  const exportTxtFile = () =>
    exportAs(t("Export as Plain Text File"), "txt", t("Plain Text"), (path, source) =>
      import("./lib/export-txt").then((m) =>
        // 代码 / 纯文本 / HTML 源码原样导出，只有 Markdown 走「渲染再抽正文」
        m.exportTxt(path, source, docKind === "markdown" ? "markdown" : "code"),
      ),
    );

  /** 通过 Pandoc 导出（批次八）：LaTeX / Epub，未装 Pandoc 时先引导下载 */
  function exportViaPandoc(title: string, ext: string, filterName: string, kind: "latex" | "epub") {
    return exportAs(title, ext, filterName, async (path, source) => {
      if (!(await ensurePandoc(title.replace(/^导出为/, "导出")))) return;
      await exportPandoc(path, source, kind, docDirPath());
    });
  }

  const exportLatexFile = () => exportViaPandoc(t("Export as LaTeX Document"), "tex", t("LaTeX Document"), "latex");
  const exportEpubFile = () => exportViaPandoc(t("Export as Epub E-book"), "epub", t("Epub E-book"), "epub");

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
      locale,
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
        title: t("Import Word Document"),
        filters: [{ name: t("Word Document"), extensions: ["docx"] }],
      });
      if (typeof picked !== "string") return; // 用户取消
      await importWordPath(picked);
    } catch (e) {
      await showError(t("Failed to import Word: "), e);
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
        title: t("Import PDF Document"),
        filters: [{ name: t("PDF Document"), extensions: ["pdf"] }],
      });
      if (typeof picked !== "string") return; // 用户取消

      // 事前告知局限性（任务书阶段 6：明确说明扫描件不可用）
      const ok = await confirmDialog(
        t("PDF import is best-effort: only text-based PDFs are supported; scanned (image-only) PDFs cannot be extracted. Tables, columns and other complex layouts may need manual correction.\nContinue?"),
        { title: "Sticho", kind: "info", okLabel: t("Continue"), cancelLabel: t("Cancel") },
      );
      if (!ok) return;

      await importPdfPath(picked);
    } catch (e) {
      await showError(t("Failed to import PDF: "), e);
    } finally {
      busy = false;
    }
  }

  /** 标签右键：在资源管理器中定位当前文件（无本地路径时不动作） */
  async function revealInExplorer(): Promise<void> {
    const p = currentPath;
    if (!p) return;
    try {
      await revealFile(p);
    } catch (e) {
      await showError(t("Failed to open file location: "), e);
    }
  }

  /** 文件属性（阶段 10；阶段 11 起与侧边栏「属性」视图共用同一份数据） */
  async function showFileInfo(): Promise<void> {
    await refreshFileProps();
    await messageDialog(
      fileProps.map(([label, value]) => t("{label}: {value}", { label, value })).join("\n"),
      {
        title: t("File Properties"),
        kind: "info",
      },
    );
  }

  async function exitApp(): Promise<void> {
    if (busy) return;
    captureActiveTab();
    if (anyTabDirty()) {
      const count = tabs.filter((_t, i) => tabDirty(i)).length;
      const ok = await confirmDialog(
        count > 1
          ? t("{n} tabs have unsaved changes that will be discarded on exit. Exit anyway?", { n: count })
          : t("The current document has unsaved changes that will be discarded on exit. Exit anyway?"),
        { title: "Sticho", kind: "warning", okLabel: t("Exit"), cancelLabel: t("Cancel") },
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
      await showError(t("Failed to cut: "), e);
    }
  }

  async function copySelection(): Promise<void> {
    const sel = getEditorSelection();
    if (!sel) return;
    try {
      await writeClipboardText(sel);
    } catch (e) {
      await showError(t("Failed to copy: "), e);
    }
  }

  async function pasteClipboard(): Promise<void> {
    try {
      insertEditorText(await readClipboardText());
    } catch (e) {
      await showError(t("Failed to paste: "), e);
    }
  }

  // ---- 查找 / 替换（阶段 10；批次五增强为 大小写 / 全词 / 正则 + 计数 + 高亮）----
  // 纯逻辑（正则编译 / 命中收集 / 替换展开 / 高亮）已抽到 lib/findReplace.ts（批次 3.3），
  // 这里只保留读组件状态的薄适配，调用点与行为均不变。

  /** 按当前三个开关编译查找正则（转发给纯函数） */
  function buildFindRegex(): RegExp | null {
    return compileFindRegex(findText, { caseSensitive: findCase, wholeWord: findWord, regex: findRegex });
  }

  /** 用当前查找正则在给定根节点内收集命中 */
  function domHits(root: Node | null, doc: Document): DomHit[] | null {
    return collectDomHits(root, doc, buildFindRegex());
  }

  /** 编辑器正文内的命中（Markdown 模式） */
  function editorHits(): DomHit[] | null {
    return domHits(getEditorContentElement(), document);
  }

  // 命中高亮（setHighlightRanges / applyFindHighlights / clearFindHighlights）见 lib/findReplace.ts：
  // 用的是 CSS Custom Highlight API，零 DOM 侵入，与组件状态无关。

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
      findStatus = n === null ? t("Invalid regular expression") : `0 / ${n}`;
      return;
    }

    if (!findOpen || !findText) {
      findStatus = "0 / 0";
      return;
    }

    if (docKind === "html") {
      if (htmlView === "source") {
        const hits = stringHits(htmlSource);
        findStatus = hits === null ? t("Invalid regular expression") : `0 / ${hits.length}`;
        return;
      }
      // 预览视图沿用「选中 + 滚动」的方案（iframe 里没有应用样式，登记高亮也看不见）
      if (!previewReachable()) {
        findStatus = t("Preview search is unavailable while scripts are enabled");
        return;
      }
      const hits = previewHits();
      findStatus = hits === null ? t("Invalid regular expression") : `0 / ${hits.length}`;
      return;
    }

    // 大文档分节通路：命中按整篇源码算，不受已渲染分节的限制
    if (isLargeDocMode()) {
      const largeHits = largeSourceHits();
      if (largeHits === null) {
        findStatus = t("Invalid regular expression");
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
      findStatus = t("Invalid regular expression");
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

  /** 字符串内的命中（HTML 源码视图的 textarea 走这条；用当前查找正则） */
  function stringHits(hay: string): StringHit[] | null {
    return collectStringHits(hay, buildFindRegex());
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
      findStatus = t("Invalid regular expression");
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

  /** 替换文本里的 `$1` / `$&` / `$$` 展开（转发给纯函数，字面量模式不展开） */
  function expandReplacement(template: string, full: string, groups: string[]): string {
    return applyReplacement(template, full, groups, findRegex);
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
      findStatus = t("Invalid regular expression");
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
      findStatus = t("Invalid regular expression");
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
      findStatus = t("Invalid regular expression");
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
    findStatus = t("Replaced {n} occurrence(s)", { n });
    if (n > 0) syncFromCode();
  }

  /** HTML 源码视图下的查找：直接在 textarea 文本中定位并选中（靠选中呈现，无高亮） */
  function findNextInSource(backwards: boolean): void {
    const el = sourceArea;
    if (!el) return;
    const hits = stringHits(htmlSource);
    if (hits === null) {
      findStatus = t("Invalid regular expression");
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
      findStatus = t("Preview search is unavailable while scripts are enabled");
      return;
    }
    const hits = previewHits();
    if (hits === null) {
      findIdx = -1;
      findStatus = t("Invalid regular expression");
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
      findStatus = t("Preview replace is unavailable while scripts are enabled");
      return;
    }
    const hits = previewHits();
    if (hits === null) {
      findIdx = -1;
      findStatus = t("Invalid regular expression");
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
      findStatus = t("Preview replace is unavailable while scripts are enabled");
      return;
    }
    const hits = previewHits();
    if (hits === null) {
      findIdx = -1;
      findStatus = t("Invalid regular expression");
      return;
    }
    if (hits.length === 0) {
      findIdx = -1;
      findStatus = "0 / 0";
      return;
    }
    replaceInPreview(hits);
    findIdx = -1;
    findStatus = t("Replaced {n} occurrence(s)", { n: hits.length });
  }

  /** 编辑器常规通路（Markdown / 纯文本）的「下一个 / 上一个」：在正文 Range 上定位并居中 */
  function findNextInEditor(backwards: boolean): void {
    const hits = editorHits();
    if (hits === null) {
      findIdx = -1;
      findStatus = t("Invalid regular expression");
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
        findStatus = t("Invalid regular expression");
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
      findStatus = t("Invalid regular expression");
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
        findStatus = t("Invalid regular expression");
        return;
      }
      if (hits.length === 0) {
        findStatus = "0 / 0";
        return;
      }
      htmlSource = findRegex
        ? htmlSource.replace(buildFindRegex()!, replaceText) // 正则模式用原生 replace：$1 / $& 展开由它负责
        : htmlSource.split(findText).join(replaceText);
      findStatus = t("Replaced {n} occurrence(s)", { n: hits.length });
      syncFromHtmlSource();
      return;
    }

    const value = getEditorValue();
    const hits = stringHits(value);
    if (hits === null) {
      findStatus = t("Invalid regular expression");
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
    findStatus = t("Replaced {n} occurrence(s)", { n: hits.length });
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

  // ---- 外观（阶段 7 的明 / 暗档位已并入「主题」，见下方 refreshThemes）----
  function applyAppTheme(dark: boolean): void {
    theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    setEditorTheme(dark); // 编辑器未初始化时为 no-op
    setCodeTheme(dark); // 代码视图未挂载时为 no-op
  }

  /**
   * 主题是否为深色：看它 CSS 里声明的 `color-scheme`（主题文件夹 README 有这条约定）。
   * 声明 dark → 深色主题；声明 light 或两者都没写 → 按浅色处理。
   */
  function themeIsDark(css: string): boolean {
    return /color-scheme\s*:\s*dark/i.test(css);
  }

  /** 明 / 暗档位真的变化时才切换（避免重复设置编辑器与代码高亮主题） */
  function applyThemeMode(dark: boolean): void {
    if (dark !== (theme === "dark")) applyAppTheme(dark);
  }

  // ---- 阅读排版（字体 / 字号 / 行距 / 文字色 / 护眼底色）----

  /** 字体档位：value 为空串表示不覆盖，沿用 Vditor 自带字体栈 */
  // 内置字体 + 字体包目录里的字体（批次十二）：后者经 @font-face 注册后可在此直接选用
  const READER_FONTS: { id: string; label: string; value: string }[] = $derived([
    { id: "default", label: t("Sans-serif (default)"), value: "" },
    { id: "yahei", label: t("Microsoft YaHei"), value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
    { id: "song", label: t("SimSun"), value: '"SimSun", "Songti SC", serif' },
    { id: "hei", label: t("SimHei"), value: '"SimHei", "Heiti SC", sans-serif' },
    { id: "kai", label: t("KaiTi"), value: '"KaiTi", "Kaiti SC", serif' },
    { id: "mono", label: t("Monospace"), value: '"Cascadia Mono", Consolas, "Courier New", monospace' },
    ...fontPacks.map((f) => ({
      id: `pack:${f.name}`,
      label: f.name,
      value: `${cssString(fontPackFamily(f.name))}, sans-serif`,
    })),
  ]);

  const READER_SIZES = ["12px", "13px", "14px", "15px", "16px", "17px", "18px", "20px", "22px", "24px"];
  const READER_LINES = ["1.2", "1.4", "1.6", "1.8", "2", "2.4"];

  /** 文字颜色预设（护眼阅读常用：深灰而非纯黑，长时间看更柔和；另备一深一浅两档常用色） */
  const READER_TEXT_COLORS = $derived([
    { label: t("Dark Brown"), value: "#5b4636" },
    { label: t("Black"), value: "#1a1a1a" },
    { label: t("Deep Blue"), value: "#1e3a5f" },
    { label: t("Night"), value: "#e8e8e8" },
    { label: t("Silver"), value: "#c9c9c9" },
  ]);

  /** 页面背景预设：米黄 / 护眼绿 / 淡蓝 / 淡灰 / 夜间 */
  const READER_BACKGROUNDS = $derived([
    { label: t("Cream"), value: "#f6efdc" },
    { label: t("Eye-care Green"), value: "#c9e7cb" },
    { label: t("Light Blue"), value: "#e3edf7" },
    { label: t("Light Gray"), value: "#f0f0f0" },
    { label: t("Night"), value: "#2b2b2b" },
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
  // 主题文件放在配置目录的主题目录下，内容整体注入一个 style 节点。
  // 主题同时决定「整份配色」与「明 / 暗档位」（由 CSS 里的 color-scheme 判定），
  // 因此外观只需选主题，不再单独切明 / 暗。

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

  /**
   * 读取主题目录并把选中主题应用到界面；已选主题文件被删掉时回落默认并清掉设置。
   * 明 / 暗档位也在这一处统一决定：未选主题 = 内置浅色默认；选中主题按其 color-scheme 定深浅。
   */
  async function refreshThemes(): Promise<void> {
    try {
      themeFiles = await loadThemes();
    } catch {
      themeFiles = [];
    }
    const hit = userTheme ? themeFiles.find((f) => f.name === userTheme) : undefined;
    applyUserThemeCss(hit?.css ?? "");
    if (userTheme && !hit) {
      userTheme = null;
      await saveSetting("userTheme", null);
    }
    applyThemeMode(userTheme !== null && themeIsDark(hit?.css ?? ""));
  }

  /** 选用 / 清除主题：整份配色与明暗档位一并切换并记忆 */
  async function selectUserTheme(name: string | null): Promise<void> {
    userTheme = name;
    const css = name ? themeFiles.find((f) => f.name === name)?.css ?? "" : "";
    applyUserThemeCss(css);
    applyThemeMode(name !== null && themeIsDark(css));
    await saveSetting("userTheme", name);
  }

  /** 打开主题目录（顺带刷新列表：用户常先打开文件夹放文件，再回来选） */
  async function openThemesFolder(): Promise<void> {
    try {
      await openThemeDir();
      await refreshThemes();
    } catch (e) {
      await showError(t("Failed to open themes folder: "), e);
    }
  }

  function toggleSkin(): void {
    skinOpen = !skinOpen;
    if (skinOpen) void refreshThemes();
  }

  // ---- 自定义浮窗说明（替代原生 title）----
  //
  // 原生 tooltip 的框线偏生硬、且只在贴近屏幕右缘时才换行，长句很难读。改用自绘浮窗：
  // 圆角柔和描边 + 限宽（提前换行），悬停在带 data-tip / 原生 title 的元素上时显示在其下方。
  // 用 mouseover 事件委托，元素动态增删都能覆盖；沿用原生 title 的元素会临时摘掉 title 以压住系统气泡。

  /** 浮窗最大宽度（px）：与 CSS 的 .app-tip max-width 对应，测量不到时用它兜底 */
  const TIP_MAX_WIDTH = 320;
  /** 悬停多久后才弹出浮窗（ms）：鼠标在按钮上停留一会才出现 */
  const TIP_SHOW_DELAY = 450;
  /** 浮窗与光标之间的间距（px） */
  const TIP_GAP = 16;
  let tipText = $state("");
  let tipLeft = $state(0);
  let tipTop = $state(0);
  /** 浮窗 DOM：弹出后测量实际尺寸，把浮窗夹进视口 */
  let tipEl = $state<HTMLElement | null>(null);
  /** 当前已弹出的浮窗归属元素：换元素才更新内容，同一元素内移动不闪烁 */
  let tipAnchor: HTMLElement | null = null;
  /** 已排队、尚未弹出的目标元素（正等 TIP_SHOW_DELAY） */
  let tipPending: HTMLElement | null = null;
  /** 沿用原生 title 的元素在悬停时被临时摘除 title，这里记住原文以便还原 */
  let tipAnchorTitle: string | null = null;
  /** 延迟隐藏的定时器：在相邻按钮之间快速移动时不至于闪一下 */
  let tipHideTimer = 0;
  /** 延迟弹出的定时器 */
  let tipShowTimer = 0;
  /** 最近一次鼠标位置：浮窗跟随光标定位，而不是挂在元素上 */
  let tipMouseX = 0;
  let tipMouseY = 0;

  // 既覆盖显式的 data-tip，也覆盖沿用原生 title 的按钮——统一换成自绘浮窗
  const TIP_SELECTOR = "[data-tip],[title]";

  // 挂在 document 上而不是模板属性：事件委托同样覆盖动态增删的元素，
  // 又不给根节点引入无意义的 ARIA 角色 / 键盘事件
  onMount(() => {
    document.addEventListener("mousemove", onTipMove);
    document.addEventListener("mouseover", onTipOver);
    document.addEventListener("mouseout", onTipOut);
    // 滚动 / 缩放 / 失焦后锚点位置会变，浮窗留在原地会显得「飘」——直接收起来，避免错位
    window.addEventListener("scroll", hideTip, true);
    window.addEventListener("resize", hideTip);
    window.addEventListener("blur", hideTip);
    return () => {
      document.removeEventListener("mousemove", onTipMove);
      document.removeEventListener("mouseover", onTipOver);
      document.removeEventListener("mouseout", onTipOut);
      window.removeEventListener("scroll", hideTip, true);
      window.removeEventListener("resize", hideTip);
      window.removeEventListener("blur", hideTip);
    };
  });

  function onTipMove(e: MouseEvent): void {
    tipMouseX = e.clientX;
    tipMouseY = e.clientY;
  }

  /** 还原被临时摘除的原生 title（若属性已被重新赋值则不再覆盖） */
  function restoreTipTitle(): void {
    if (tipAnchor && tipAnchorTitle !== null && !tipAnchor.hasAttribute("title")) {
      tipAnchor.setAttribute("title", tipAnchorTitle);
    }
    tipAnchorTitle = null;
  }

  /** 取消排队中的弹出 */
  function cancelShow(): void {
    if (tipShowTimer !== 0) {
      clearTimeout(tipShowTimer);
      tipShowTimer = 0;
    }
    tipPending = null;
  }

  /** 立即收起浮窗并还原 title */
  function hideTip(): void {
    cancelShow();
    if (tipHideTimer !== 0) {
      clearTimeout(tipHideTimer);
      tipHideTimer = 0;
    }
    restoreTipTitle();
    tipAnchor = null;
    tipText = "";
  }

  /** 把浮窗摆到光标附近，并按实际尺寸贴边收进视口（右下不够就翻到左上） */
  function placeTip(): void {
    const pad = 12;
    const w = tipEl?.offsetWidth || TIP_MAX_WIDTH;
    const h = tipEl?.offsetHeight || 0;
    let left = tipMouseX + TIP_GAP;
    let top = tipMouseY + TIP_GAP;
    if (left + w > window.innerWidth - pad) left = tipMouseX - w - TIP_GAP;
    if (top + h > window.innerHeight - pad) top = tipMouseY - h - TIP_GAP;
    tipLeft = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    tipTop = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
  }

  /** 到点后真正弹出浮窗 */
  function presentTip(anchor: HTMLElement, text: string): void {
    if (!document.contains(anchor)) return; // 等待期间目标已被移除
    tipAnchor = anchor;
    tipText = text;
    // data-tip 之外沿用的原生 title：先摘掉，免得系统气泡同时冒出来
    if (anchor.dataset.tip) {
      tipAnchorTitle = null;
    } else {
      tipAnchorTitle = anchor.getAttribute("title");
      anchor.removeAttribute("title");
    }
    // 先给个「光标右下」的初值，渲染后按实测尺寸收进视口
    tipLeft = tipMouseX + TIP_GAP;
    tipTop = tipMouseY + TIP_GAP;
    void tick().then(placeTip);
  }

  function onTipOver(e: MouseEvent): void {
    const anchor = (e.target as HTMLElement | null)?.closest?.(TIP_SELECTOR) as HTMLElement | null;
    if (!anchor) return;
    if (anchor === tipAnchor) {
      // 仍停在同一元素上：取消一次「即将隐藏」，避免移动途中闪一下
      if (tipHideTimer !== 0) {
        clearTimeout(tipHideTimer);
        tipHideTimer = 0;
      }
      return;
    }
    if (anchor === tipPending) return; // 已在排队等待，别把计时重置
    cancelShow();
    // 上一个锚点已被移出文档（菜单关闭 / 标签关闭等）：先清掉残留浮窗
    if (tipAnchor && !document.contains(tipAnchor)) hideTip();
    else restoreTipTitle();
    const text = anchor.dataset.tip || anchor.getAttribute("title") || "";
    if (!text.trim()) return;
    tipPending = anchor;
    tipShowTimer = window.setTimeout(() => {
      tipShowTimer = 0;
      const pending = tipPending;
      tipPending = null;
      if (pending) presentTip(pending, text);
    }, TIP_SHOW_DELAY);
  }

  function onTipOut(e: MouseEvent): void {
    const from = (e.target as HTMLElement | null)?.closest?.(TIP_SELECTOR) as HTMLElement | null;
    const current = tipAnchor ?? tipPending;
    if (!current || from !== current) return;
    const next = e.relatedTarget as HTMLElement | null;
    if (next && current.contains(next)) return; // 仍在同一元素内部移动，不算离开
    if (current === tipPending) {
      cancelShow(); // 还没弹出来就离开了：直接取消
      return;
    }
    // 已弹出的：轻微延迟再隐藏，相邻按钮之间移动时不至于闪一下
    if (tipHideTimer !== 0) clearTimeout(tipHideTimer);
    tipHideTimer = window.setTimeout(() => {
      tipHideTimer = 0;
      hideTip();
    }, 60);
  }

  // ---- 语言包 / 字体包（批次十二）----

  /** 字体包在 CSS 里的 family 名：统一加前缀，避免与系统字体同名冲突 */
  function fontPackFamily(name: string): string {
    return `Sticho Pack ${name}`;
  }

  /** 组装 CSS 字符串字面量（font-family / url 都要用），转义反斜杠与双引号 */
  function cssString(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  /** 把字体包注册成 @font-face：family 名与 READER_FONTS 用同一套命名 */
  function applyFontPacks(fonts: FontPack[]): void {
    const id = "md-studio-font-packs";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (fonts.length === 0) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = fonts
      .map(
        (f) =>
          `@font-face { font-family: ${cssString(fontPackFamily(f.name))}; src: url(${cssString(
            convertFileSrc(f.path),
          )}); }`,
      )
      .join("\n");
  }

  /** 读取字体包目录并注册；读不到就保持现状（别把用户选用的字体误清掉） */
  async function refreshFonts(): Promise<void> {
    let fonts: FontPack[];
    try {
      fonts = await loadFonts();
    } catch {
      return;
    }
    fontPacks = fonts;
    applyFontPacks(fonts);
    // 选用的字体包被移走后回落默认，避免下拉框里查无此项
    if (readerStyle.fontFamily && !READER_FONTS.some((f) => f.value === readerStyle.fontFamily)) {
      await setReaderOption("fontFamily", "");
    }
  }

  /**
   * 启动时的包目录初始化：先释放默认语言包 / 主题包，再加载语言包与字体包。
   *
   * 释放只在文件缺失时发生（Rust 侧 ensure_packs 不覆盖已有文件），所以用户改过的语言包、
   * 自己写的主题与放进去的字体都不会被冲掉；任何一步失败都降级为「无外部包」，不影响启动。
   */
  async function initPacks(): Promise<void> {
    try {
      await ensurePacks(DEFAULT_PACK_FILES);
    } catch (e) {
      console.error("[sticho] 释放默认包文件失败：", e);
    }
    // 欢迎正文 / 语言包 / 字体包：三者互不依赖（都只依赖上面已释放的默认包），并行读取。
    // 欢迎正文（docs/Welcome.<locale>.md）在 initPacks 返回前一定就绪，
    // 首个标签的正文随后才写进编辑器（见 boot 段）。
    await Promise.all([
      loadWelcomeDocs(),
      (async () => {
        try {
          localePacks = await loadLocales();
        } catch {
          localePacks = [];
        }
      })(),
      refreshFonts(),
    ]);
  }

  /** 打开语言包目录（顺带刷新列表：用户常先放文件，再回来选） */
  async function openLocalesFolder(): Promise<void> {
    try {
      await openPackDir("locales");
    } catch (e) {
      await showError(t("Failed to open locales folder: "), e);
    }
    try {
      localePacks = await loadLocales();
    } catch {
      /* 打不开就维持原列表 */
    }
  }

  /** 打开字体包目录（顺带刷新：新放入的字体立即出现在字体下拉里） */
  async function openFontsFolder(): Promise<void> {
    try {
      await openPackDir("fonts");
    } catch (e) {
      await showError(t("Failed to open fonts folder: "), e);
    }
    await refreshFonts();
  }

  // ---- 界面语言（批次八）----

  /** 切换界面语言：立即改 App 文案，并同步 Vditor 的语言与其工具栏提示 */
  async function selectLocale(next: Locale): Promise<void> {
    locale = next;
    void setEditorLocale(vditorLang(next));
    document.documentElement.lang = next;
    await saveSetting("locale", next);
  }

  /**
   * 切换渲染模式（状态栏图标组 / 视图菜单共用）。
   *
   * 关键：判断「是否已在目标模式」必须拿**我们自己的 editorMode** 比，不能拿 Vditor 的当前模式比
   * ——「不渲染」在 Vditor 里也是 `sv`（只是再用 CSS 把预览栏藏起来），所以从「不渲染」点回
   * 「分屏预览」时 `getEditorMode()` 已经是 `"sv"`，按旧写法会直接 return，editorMode 停在
   * `"none"`，预览栏继续藏着，两个模式就长得一模一样。同理，此时 Vditor 无需再切一次 sv。
   */
  function switchEditorMode(mode: "ir" | "wysiwyg" | "sv" | "none"): void {
    if (mode === editorMode) return;
    if (mode === "none") {
      setEditorMode("sv"); // Vditor 切到 SV；预览栏由 CSS 隐藏（.md-source-only）
      editorMode = "none";
      return;
    }
    // 从「不渲染」退回来时 Vditor 已经是 sv，setEditorMode 是空操作，只落值即可
    if (getEditorMode() !== mode) setEditorMode(mode);
    // 立即同步状态栏图标与菜单复选：靠编辑器的模式回调要等一拍，且回调只为兜住
    // 「工具栏下拉」那条路径，这里直接落值，反馈更跟手（回调稍后会再确认一次）。
    editorMode = mode;
  }

  /** 视图菜单：切到 Markdown 模式并用指定渲染模式（含 none=不渲染） */
  async function applyMarkdownRender(mode: "ir" | "wysiwyg" | "sv" | "none"): Promise<void> {
    if (docKind !== "markdown") await setDocMode("markdown");
    switchEditorMode(mode);
  }

  /** 视图菜单：切到 HTML 模式；给了 view 就同时设置预览/源码 */
  async function applyHtmlMode(view?: "preview" | "source"): Promise<void> {
    if (docKind !== "html") await setDocMode("html");
    if (view) setHtmlView(view);
  }

  /** 视图菜单：切到 HTML 模式并切换「执行文档脚本」 */
  async function applyHtmlScriptToggle(): Promise<void> {
    if (docKind !== "html") await setDocMode("html");
    toggleHtmlScripts();
  }

  /** 纯文本模式的三级子菜单：先确保处于纯文本模式，再设置语法高亮语言 */
  async function applyCodeLang(input: string | null | undefined): Promise<void> {
    if (docKind !== "code") await setDocMode("code");
    await setCodeLang(input);
  }

  function toggleEditorToolbar(): void {
    showToolbar = !showToolbar;
    setEditorToolbarVisible(showToolbar);
    void saveSetting("showToolbar", showToolbar); // 与行号 / 自动换行一致：记住选择
  }

  /** 表格整列对齐（批次七）。光标不在单元格内时 Vditor 无从判断列，给出提示 */
  async function alignTable(type: "left" | "center" | "right"): Promise<void> {
    if (alignTableColumn(type)) return;
    await messageDialog(t("Place the cursor inside a table cell before setting column alignment."), {
      title: "Sticho",
      kind: "info",
    });
  }

  /** 书签：当前是否可用（HTML 文档 / 超大代码只读分节视图下不可用）。
   *  阅读模式（浏览）也允许：书签只记位置、不改文档，正合「浏览时标记一下」的用法。
   *  判据用 docKind 而非全局 codeLargeText：后者在切到 Markdown 后可能是上一份大代码
   *  文件遗留的旧值，会让 Markdown 文档被误判为「书签不可用」。 */
  function bookmarksAllowed(): boolean {
    return docKind !== "html" && !(docKind === "code" && codeLargeText !== null);
  }

  /** 书签：某标签是否应从磁盘装载（HTML 与超大代码只读分节视图不适用）。
   *  判据按该标签自身：全局 codeLargeText 在切换到别的标签后可能还留着上一份大代码文件的旧值，
   *  用它判断会让 Markdown / 普通代码标签被误判为「不可用」。 */
  function shouldLoadBookmarks(tab: DocTab): boolean {
    if (tab.kind === "html") return false;
    // 代码标签按自身正文长度判是否超大：超大走只读分节视图，没有可落书签的行内编辑态
    if (tab.kind === "code") return tab.content.length < CODE_LARGE_BYTES;
    return true;
  }

  /**
   * 书签持久化用的「文档身份」：已保存的文档用本地路径（云端文档用远端路径），
   * 未命名文档退回草稿 id——草稿 id 在会话恢复后保持不变，所以未命名文档的书签
   * 也能跨重启保留。
   *
   * 活跃标签一律以**全局状态**（currentPath / currentRemote）为准：标签快照里的
   * path 只在切换 / 关闭时同步，刚打开还没 capture 过的标签快照仍是 null，若照它
   * 取 owner 会退回 draftId，导致书签存错文件、重开读不到（本次修复的缺陷根因）。
   */
  function bookmarkOwner(tab: DocTab): string {
    if (tab === tabs[activeIndex]) return currentRemote ?? currentPath ?? tab.draftId;
    return tab.remote ?? tab.path ?? tab.draftId;
  }

  /** 书签：把某标签的书签写盘（两边都空则删掉文件，免得配置目录里留一堆空档）。
   *  返回写入 Promise，供「先写新身份、成功后再删旧身份」的迁移顺序使用。 */
  function persistBookmarks(tab: DocTab): Promise<void> {
    const owner = bookmarkOwner(tab);
    const { code, md } = tab.bookmarks;
    const task =
      code.length === 0 && md.length === 0
        ? bookmarksDelete(owner)
        : bookmarksSave(owner, JSON.stringify({ code, md }));
    return task.catch(() => {
      /* 存书签失败不打扰用户：书签是辅助信息，内存里仍在 */
    });
  }

  /** 书签：把磁盘上的书签装回某标签，并投影到当前编辑器 */
  async function loadStoredBookmarks(tab: DocTab): Promise<void> {
    let raw: string | null;
    try {
      raw = await bookmarksLoad(bookmarkOwner(tab));
    } catch {
      return;
    }
    if (!raw) return;
    let parsed: { code?: unknown; md?: unknown };
    try {
      parsed = JSON.parse(raw) as { code?: unknown; md?: unknown };
    } catch {
      return; // 文件损坏就当没有
    }
    if (!Array.isArray(parsed.code) || !Array.isArray(parsed.md)) return;
    tab.bookmarks = { code: parsed.code as number[], md: parsed.md as MdBookmarkAnchor[] };
    if (tab.kind === "code" && codeLargeText === null) {
      setCodeBookmarks(tab.bookmarks.code);
      codeBookmarkInfo = getCodeBookmarks();
    }
  }

  /** 书签：在光标处添加；无光标（未聚焦 / 阅读模式）则落在文档最上方起始位置 */
  function addBookmark(): void {
    if (!bookmarksAllowed()) return;
    const tab = tabs[activeIndex];
    if (!tab) return;
    if (docKind === "code") {
      if (!addCodeBookmark()) return;
      tab.bookmarks.code = getCodeBookmarkPositions();
      codeBookmarkInfo = getCodeBookmarks();
    } else if (docKind === "markdown") {
      const anchor = getMdBookmarkAnchor() ?? getMdTopBookmarkAnchor();
      if (!anchor) return;
      const list = tab.bookmarks.md;
      const exists = list.some((a) => a.text === anchor.text && a.occ === anchor.occ);
      if (!exists) {
        list.push(anchor);
        tab.bookmarks.md = [...list]; // 重新赋值以触发响应
      }
    }
    void persistBookmarks(tab);
  }

  /** 书签：删除某一条（侧边栏「书签」面板的单条删除） */
  function removeBookmarkAt(index: number): void {
    const tab = tabs[activeIndex];
    if (!tab) return;
    if (docKind === "code") {
      const pos = tab.bookmarks.code[index];
      if (pos === undefined) return;
      removeCodeBookmark(pos);
      tab.bookmarks.code = getCodeBookmarkPositions();
      codeBookmarkInfo = getCodeBookmarks();
    } else if (docKind === "markdown") {
      const list = [...tab.bookmarks.md];
      if (index < 0 || index >= list.length) return;
      list.splice(index, 1);
      tab.bookmarks.md = list;
    }
    void persistBookmarks(tab);
  }

  /** 书签：切换（Ctrl+F2）。代码走 CM 的 StateField，Markdown 走块锚点 */
  function toggleBookmark(): void {
    if (!bookmarksAllowed()) return;
    const tab = tabs[activeIndex];
    if (!tab) return;
    if (docKind === "code") {
      toggleCodeBookmark();
      tab.bookmarks.code = getCodeBookmarkPositions();
      codeBookmarkInfo = getCodeBookmarks();
    } else if (docKind === "markdown") {
      const anchor = getMdBookmarkAnchor();
      if (!anchor) return;
      const list = tab.bookmarks.md;
      const same = (a: MdBookmarkAnchor): boolean => a.text === anchor.text && a.occ === anchor.occ;
      const at = list.findIndex(same);
      if (at >= 0) list.splice(at, 1);
      else list.push(anchor);
      tab.bookmarks.md = [...list]; // 重新赋值以触发响应
    }
    void persistBookmarks(tab);
  }

  /** 书签：下一个 / 上一个（F4 / Shift+F4），环绕 */
  function nextBookmark(dir: 1 | -1): void {
    if (!bookmarksAllowed()) return;
    const tab = tabs[activeIndex];
    if (!tab) return;
    if (docKind === "code") {
      nextCodeBookmark(dir);
      tab.bookmarks.code = getCodeBookmarkPositions();
      codeBookmarkInfo = getCodeBookmarks();
      return;
    }
    if (docKind === "markdown") {
      const list = tab.bookmarks.md;
      if (list.length === 0) return;
      const next = bookmarkCursor < 0 ? (dir > 0 ? 0 : list.length - 1) : (bookmarkCursor + dir + list.length) % list.length;
      if (revealMdBookmark(list[next]!)) bookmarkCursor = next;
    }
  }

  /** 书签：清除全部 */
  function clearBookmarks(): void {
    if (!bookmarksAllowed()) return;
    const tab = tabs[activeIndex];
    if (!tab) return;
    if (docKind === "code") {
      clearCodeBookmarks();
      codeBookmarkInfo = getCodeBookmarks();
    }
    tab.bookmarks = { code: [], md: [] };
    bookmarkCursor = -1;
    void persistBookmarks(tab);
  }

  /** 侧边栏「书签」面板要显示的行清单（与侧边栏冻结的接口） */
  const bookmarkItems = $derived.by(
    (): { label: string; detail?: string; onClick: () => void; onRemove: () => void }[] => {
      const tab = tabs[activeIndex];
      if (!tab) return [];
      if (docKind === "code") {
        if (codeLargeText !== null) return [];
        const positions = tab.bookmarks.code;
        return positions.map((pos, i) => {
          const info = codeBookmarkInfo[i];
          return {
            label: info ? `L${info.line}` : `#${i + 1}`,
            detail: info?.text,
            onClick: () => {
              scrollToCodeOffset(pos);
              focusCodeEditor();
            },
            onRemove: () => removeBookmarkAt(i),
          };
        });
      }
      if (docKind === "markdown") {
        return tab.bookmarks.md.map((anchor, i) => ({
          label: `#${i + 1}`,
          detail: anchor.text,
          onClick: () => revealMdBookmark(anchor),
          onRemove: () => removeBookmarkAt(i),
        }));
      }
      return [];
    },
  );

  async function toggleLineNumbers(): Promise<void> {
    showLineNumbers = !showLineNumbers;
    setLineNumbersVisible(showLineNumbers);
    await saveSetting("lineNumbers", showLineNumbers);
  }

  async function toggleAutoWrap(): Promise<void> {
    autoWrap = !autoWrap;
    setCodeLineWrapping(autoWrap); // CodeMirror：未挂载时 no-op
    setLargeReaderWrap(autoWrap); // 大文档纯文本阅读器
    await saveSetting("wrapLongLines", autoWrap);
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
   * 落盘逻辑已抽到 lib/autoSave.ts（批次 3.3），这里只注入当前标签与回调。
   */
  async function tickAutoSave(): Promise<void> {
    await runAutoSave({
      enabled: autoSaveEnabled,
      busy,
      ready: tabsReady,
      tabs,
      captureActiveTab,
      writeRecovery,
      deleteRecovery,
      saveSession,
      fileNameOf: fileName,
      unnamedLabel: t("Untitled document"),
    });
  }

  async function toggleAutoSave(): Promise<void> {
    autoSaveEnabled = !autoSaveEnabled;
    await saveSetting("autoSave", autoSaveEnabled);
    // 开启后立刻补跑一次：轮询按间隔计时，不补跑的话最坏要等一整个间隔才首次自动保存
    if (autoSaveEnabled) void tickAutoSave();
  }

  // 自动保存定时器：间隔取自设置项（默认 1 分钟），设置一变本 effect 自动重建定时器
  $effect(() => {
    const ms = Math.max(30_000, autoSaveIntervalMin * 60_000);
    return startPolling(ms, () => void tickAutoSave());
  });

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
      saveSetting("davUseHttps", davUseHttps),
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

  /**
   * 静默验证连接：不起「Testing…」提示、不置「测试中」标记，供启动时后台调用。
   * 返回是否通过；结论 / 失败原因同时写进 davTip 与 davVerified（设置面板据此展示）。
   */
  async function verifyDavSilently(): Promise<boolean> {
    const cfg = davConfig;
    if (cfg.url === "") return false;
    try {
      davTip = t(await webdavTest(cfg)); // Rust 侧给的是英文结论，这里按当前语言再翻一层
      davVerified = true;
      return true;
    } catch (e) {
      davVerified = false;
      davTip = t(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** 测试连接（设置面板按钮）。成功才置 davVerified，从而放开同步开关，并把参数落盘 */
  async function testDav(): Promise<void> {
    if (davTesting) return;
    if (davUrl.trim() === "") {
      davTip = t("Enter the server URL first");
      return;
    }
    davTesting = true;
    davTip = t("Testing…");
    const ok = await verifyDavSilently();
    if (ok) {
      await persistDavConfig();
      await checkCloudUpdates(); // 连接刚验证通过：顺带做一次云端变更检查
    }
    davTesting = false;
  }

  async function toggleDavEnabled(): Promise<void> {
    if (!davReady) return;
    davEnabled = !davEnabled;
    davSyncState = "idle";
    davSyncTip = "";
    await saveSetting("davEnabled", davEnabled);
  }

  /** 切换云同步的冲突处理策略（copy = 另存副本，overwrite = 直接覆盖） */
  async function setDavConflictPolicy(p: "copy" | "overwrite"): Promise<void> {
    davConflictPolicy = p;
    await saveSetting("davConflictPolicy", p);
  }

  // ---- 云端变更检测（跨设备冲突预警）----

  /** 一次检查里最多探测的文档数：已同步文档可能很多，避免一轮探测把请求拖得过长 */
  const CLOUD_CHECK_MAX = 10;
  /** 云端变更检查间隔（10 分钟） */
  const CLOUD_CHECK_INTERVAL_MS = 10 * 60_000;
  /** 与 Rust 侧 CONFLICT_TOLERANCE_SECS 一致：远端修改时间抖动 2 秒内不算「被改过」 */
  const CLOUD_MODIFIED_TOLERANCE_SECS = 2;
  /** 上一轮已提示过的变更集合（远端路径拼接）：内容不变就不重复弹提示 */
  let cloudPromptedKey = "";

  /** 远端路径的显示名（取末段） */
  function remoteBaseName(remote: string): string {
    const parts = remote.split("/").filter((s) => s !== "");
    return parts.length > 0 ? parts[parts.length - 1] : remote;
  }

  /** 比对基准：远端路径 → 上次同步后记录的 (size, modified) */
  function cloudBaseline(): Record<string, { size: number; modified: number }> {
    const out: Record<string, { size: number; modified: number }> = {};
    for (const record of Object.values(davSyncIndex)) {
      out[record.remote] = { size: record.size, modified: record.modified };
    }
    return out;
  }

  /**
   * 检查云端是否被别的设备改过：逐份探测已同步文档的远端状态，与本机上次同步记录比对。
   *
   * 只提示、不改动任何内容：本地继续编辑，覆盖风险仍由上传时的冲突判定兜底。
   * 任何探测失败都忽略——离线或服务不可达时不该反复打扰用户。
   */
  async function checkCloudUpdates(): Promise<void> {
    if (!davReady) return;
    const conn = { url: davUrl.trim(), user: davUser, password: davPass };
    const baseline = cloudBaseline();
    const remotes = Object.keys(baseline).slice(0, CLOUD_CHECK_MAX);
    const found: { remote: string; name: string }[] = [];
    await Promise.all(
      remotes.map(async (remote) => {
        const base = baseline[remote];
        try {
          const stat = await webdavStat(conn, remote);
          if (!stat.exists) return; // 云端已无此文件：交给上传时的判定处理
          const changed =
            stat.size !== base.size ||
            Math.abs(stat.modified - base.modified) > CLOUD_MODIFIED_TOLERANCE_SECS;
          if (changed) found.push({ remote, name: remoteBaseName(remote) });
        } catch {
          /* 探测失败：本轮忽略 */
        }
      }),
    );
    cloudUpdates = found;
    const key = found.map((f) => f.remote).sort().join("\n");
    if (found.length === 0) {
      cloudPromptedKey = "";
    } else if (key !== cloudPromptedKey) {
      cloudPromptedKey = key;
      await promptCloudUpdates();
    }
  }

  /** 提示云端变更：列出被别的设备改过的文档，可选择打开云端版本对比（打开后不写回云端） */
  async function promptCloudUpdates(): Promise<void> {
    const items = cloudUpdates;
    if (items.length === 0) return;
    const names = items.map((i) => i.name).join("、");
    const pick = await askChoice(
      t("The cloud copy of the following file(s) was updated by another device. Open the cloud version to compare?\n{names}", { names }),
      [
        { label: t("Open Cloud Version"), value: "open", primary: true },
        { label: t("Later"), value: "later" },
      ],
    );
    if (pick === "open") await openCloudUpdates();
  }

  /** 打开云端版本：一律作为未命名文档打开（不绑定远端路径），绝不误写云端 */
  async function openCloudUpdates(): Promise<void> {
    const conn = { url: davUrl.trim(), user: davUser, password: davPass };
    for (const item of cloudUpdates) {
      try {
        const content = await webdavDownload(conn, item.remote);
        await openCloudDoc(item.remote, content);
      } catch (e) {
        await showError(t("Failed to open the cloud file: "), e);
      }
    }
  }

  /**
   * 启动时的云同步初始化：配置齐了就在后台静默测一次连接——成功即视为本会话已通过，
   * 于是已开启的云同步无需手动再点「测试连接」即可继续；随后立刻做一次云端变更检查。
   *
   * 刻意不 await（见 boot 段）：网络慢不该拖住启动；失败只落状态栏与设置面板提示，
   * 并置「同步失败」以免静默失效。
   */
  async function initCloud(): Promise<void> {
    if (davUrl.trim() === "") return;
    if (!(await verifyDavSilently())) {
      davSyncState = "error";
      davSyncTip = davTip;
      return;
    }
    await checkCloudUpdates();
  }

  // 定时做云端变更检查（未配置或未验证时 checkCloudUpdates 自行返回）
  $effect(() => startPolling(CLOUD_CHECK_INTERVAL_MS, () => void checkCloudUpdates()));

  // ---- 本地多版本控制：三类上限的设置项 ----
  // 上限一改动就立刻裁剪一次全量历史（Rust 侧 prune_history），让「调小上限」马上释放空间。

  /** 保存上限设置后统一触发一次全量裁剪，并刷新当前文档的可回滚范围 */
  async function applyHistoryLimits(): Promise<void> {
    await pruneHistory();
    await refreshHistory();
  }

  async function setHistoryCountLimitOn(on: boolean): Promise<void> {
    historyCountLimitOn = on;
    await saveSetting("historyCountLimitOn", on);
    await applyHistoryLimits();
  }

  async function setHistoryKeep(n: number): Promise<void> {
    historyKeep = Math.min(200, Math.max(1, Math.round(n)));
    await saveSetting("historyKeep", historyKeep);
    await applyHistoryLimits();
  }

  async function setHistorySizeLimitOn(on: boolean): Promise<void> {
    historySizeLimitOn = on;
    await saveSetting("historySizeLimitOn", on);
    await applyHistoryLimits();
  }

  async function setHistoryMaxSizeMb(n: number): Promise<void> {
    historyMaxSizeMb = Math.min(10_240, Math.max(1, Math.round(n)));
    await saveSetting("historyMaxSizeMb", historyMaxSizeMb);
    await applyHistoryLimits();
  }

  async function setHistoryAgeLimitOn(on: boolean): Promise<void> {
    historyAgeLimitOn = on;
    await saveSetting("historyAgeLimitOn", on);
    await applyHistoryLimits();
  }

  async function setHistoryMaxAgeDays(n: number): Promise<void> {
    historyMaxAgeDays = Math.min(3_650, Math.max(1, Math.round(n)));
    await saveSetting("historyMaxAgeDays", historyMaxAgeDays);
    await applyHistoryLimits();
  }

  /** 切换自动保存间隔（分钟，0.5 = 30 秒）并持久化；定时器随 $effect 自动重建 */
  async function setAutoSaveInterval(min: number): Promise<void> {
    autoSaveIntervalMin = min > 0 ? min : 1;
    await saveSetting("autoSaveIntervalMin", autoSaveIntervalMin);
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
   * 切换配置文件保存位置（系统目录 / 当前程序目录）。
   *
   * 流程：预检目标目录可读写 →（失败即提示并回退）→ 询问是否迁移数据 → 提交切换。
   * 预检与提交失败都不会改动当前配置，界面保持在修改前的状态。
   */
  async function changeDataLocation(mode: DataLocationMode): Promise<void> {
    if (locationBusy) return;
    // 已在该位置直接返回（避免重复迁移）
    if (mode === dataLocation) return;

    locationBusy = true;
    locationTip = "";

    // 1. 预检目标目录可读写；失败：提示 + 回退（不改任何配置）
    try {
      await checkDataLocation(mode);
    } catch (e) {
      locationBusy = false;
      locationTipOk = false;
      locationTip = t(e instanceof Error ? e.message : String(e));
      await showError(t("The target folder is unavailable; the previous config was kept: "), e);
      return;
    }

    let switched = false;
    try {
      // 2. 询问是否迁移数据（取消则整体放弃）
      const answer = await askChoice(
        t("Migrate existing config data to the new location? Choosing \"Migrate\" copies settings, recovery drafts, themes and Pandoc to the new folder, then cleans up the old folder after a complete copy."),
        [
          { label: t("Migrate"), value: "migrate", primary: true },
          { label: t("Don't Migrate"), value: "keep" },
        ],
      );
      if (answer === null) return;

      // 3. 提交切换
      const result = await setDataLocation(mode, answer === "migrate");
      dataRootPath = result.root;
      dataLocation = mode;
      locationTipOk = true;
      locationTip =
        result.migrated && !result.complete
          ? t("Switched, but the migration was incomplete — the original folder was kept as a backup. Takes effect after restart")
          : t("Switched — takes effect after restart");
      switched = true;
    } catch (e) {
      locationTipOk = false;
      locationTip = t(e instanceof Error ? e.message : String(e));
      await showError(t("Switch failed: "), e);
    } finally {
      locationBusy = false;
    }

    // 4. 成功切换后提示重启（确认后先检查未保存文档，再重启）
    if (switched) await promptRestartAfterSwitch();
  }

  // ---- 首次运行：配置位置引导（批次十三）----

  /** 首次运行引导模态是否可见 */
  let configSetupOpen = $state(false);
  /** 引导提交中（禁用按钮，避免重复点击） */
  let configSetupBusy = $state(false);
  /** 引导失败提示（成功时为空） */
  let configSetupTip = $state("");
  /** 引导完成后的唤醒回调（不参与响应式；启动流程在此等待用户选定位置） */
  let configSetupResolve: (() => void) | null = null;

  /**
   * 确保配置位置已确定，必要时等待用户在引导中选定。
   *
   * 启动时探测：程序目录 / 系统目录已有配置则直接返回；两处都没有（首次运行）则亮窗并
   * 弹出引导模态，**阻塞等待**用户选定（`setup_config_location` 写入标记与初始配置并
   * 立即生效、无需重启），之后启动流程再继续加载设置 / 主题 / 语言包。
   */
  async function ensureConfigReady(): Promise<void> {
    let state: ConfigState;
    try {
      state = await getConfigState();
    } catch {
      return; // 探测失败（极罕见）：退回默认流程，由后续命令自行兜底
    }
    if (state !== "unset") return;

    // 未初始化：亮出窗口让用户看到引导（正常亮窗在设置加载之后，这里提前）
    try {
      await getCurrentWindow().show();
    } catch {
      // 无窗口环境（测试/无头）忽略
    }
    configSetupOpen = true;
    await new Promise<void>((resolve) => {
      configSetupResolve = resolve;
    });
  }

  /**
   * 引导里切换界面语言。
   *
   * 此刻数据根尚未确定，写设置会被 Rust 拒绝，所以这里只改内存状态（界面与 Vditor
   * 立即跟随）；真正的持久化放在 chooseConfigLocation 里、位置落地成功之后。
   */
  function selectSetupLocale(next: Locale): void {
    locale = next;
    document.documentElement.lang = next;
    void setEditorLocale(vditorLang(next));
  }

  /** 用户在引导中选定位置：写入初始配置后关闭模态、放行启动流程 */
  async function chooseConfigLocation(mode: DataLocationMode): Promise<void> {
    if (configSetupBusy) return;
    configSetupBusy = true;
    configSetupTip = "";
    try {
      const root = await setupConfigLocation(mode);
      dataRootPath = root;
      dataLocation = mode;
      // 语言选择此刻才能落盘：数据根未定之前设置写入会被 Rust 拒绝
      await saveSetting("locale", locale);
      configSetupOpen = false;
      configSetupResolve?.();
      configSetupResolve = null;
    } catch (e) {
      configSetupTip = t(e instanceof Error ? e.message : String(e));
    } finally {
      configSetupBusy = false;
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
          t("{n} document(s) have unsaved changes. Save before restarting?", { n: dirtyCount }),
          [
            { label: t("Save and Restart"), value: "save", primary: true },
            { label: t("Restart Without Saving"), value: "discard" },
          ],
        );
        if (answer === null) return; // 取消重启
        if (answer === "save" && !(await saveAllDirtyTabs())) return; // 保存未完成：不重启
      }
      await restartApp();
    } catch (e) {
      locationTipOk = false;
      locationTip = t(e instanceof Error ? e.message : String(e));
      await showError(t("Restart failed: "), e);
    } finally {
      locationBusy = false;
    }
  }

  /** 切换配置位置后的「重启后生效」提示：确认即进入保存检查并重启 */
  async function promptRestartAfterSwitch(): Promise<void> {
    const ok = await confirmDialog(t("The config location was updated and takes effect after a restart. Restart now?"), {
      title: "Sticho",
      kind: "info",
      okLabel: t("Restart Now"),
      cancelLabel: t("Later"),
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
    const policy = davConflictPolicy;
    const record = davSyncIndex[local];
    const prev = record ? { size: record.size, modified: record.modified } : null;
    davSyncState = "busy";
    davSyncTip = "";
    davChain = davChain
      .then(async () => {
        try {
          const result = await webdavUpload(cfg, local, policy, prev);
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
            // 该文档的云端内容已与本机对齐，撤销「云端有更新」的提示
            cloudUpdates = cloudUpdates.filter((u) => u.remote !== result.remote);
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
   * 打开云端文档 / 某个历史版本。
   *
   * `bind` 决定是否把文档绑定到远端路径：
   * - 侧边栏「云端」视图打开（bind=true）→ 绑定 remote，保存时按此路径就地写回云端；
   * - 云端浏览模态打开 / 恢复历史版本（bind=false）→ 只取正文，作为未命名文档打开，
   *   用户保存时走既有「另存为」流程落回本地，绝不误写云端。
   */
  async function openCloudContent(remote: string, content: string, bind: boolean): Promise<void> {
    const isHtml = /\.html?$/i.test(remote);
    await loadIntoFreshTab(async () => {
      currentPath = null;
      currentRemote = bind ? remote : null; // 未绑定时置空：避免沿用上一个文档的云端路径
      setDocumentPath(null);
      dirty = false;
      encoding = "utf-8"; // 云端正文按 UTF-8 取回（非 UTF-8 已由 Rust 侧挡下）
      docEol = detectEol(content); // 云端原文的行尾风格一并保留
      if (isHtml) {
        docKind = "html";
        htmlSource = content;
        previewDoc = content;
        htmlView = "preview";
        setCurrentHtmlScripts(false);
        rebuildPreview(content);
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

  /** 云端浏览模态 / 历史版本：作为未命名文档打开（不绑定远端路径） */
  async function openCloudDoc(remote: string, content: string): Promise<void> {
    await openCloudContent(remote, content, false);
  }

  /** 侧边栏「云端」视图：打开并绑定远端路径，保存时就地写回云端 */
  async function openCloudBound(remote: string, content: string): Promise<void> {
    await openCloudContent(remote, content, true);
  }

  /**
   * 保存绑定云端的文档（无本地文件）：按记录的远端路径直接写回。
   *
   * 与 syncToCloud 的差别：那里是本地保存的附带动作（不 await、不阻塞），
   * 这里「写云端」本身就是保存动作，需要 await 并负责 dirty / 标题 / 提示；
   * 版本留档与冲突策略与本地同步完全一致。
   */
  async function saveCloudBound(): Promise<void> {
    const remote = currentRemote;
    if (remote === null) return;
    if (!davReady) {
      await messageDialog(
        t("WebDAV is not configured or the connection has not been tested, so the file cannot be saved to the cloud. Configure and test the connection under Settings → WebDAV."),
        { title: "Sticho", kind: "info" },
      );
      return;
    }
    const wasBusy = busy;
    busy = true;
    try {
      syncHtmlFromPreview(); // 预览里直接编辑的改动先落回源码
      const cfg = davConfig;
      const record = davSyncIndex[remote];
      const prev = record ? { size: record.size, modified: record.modified } : null;
      davSyncState = "busy";
      davSyncTip = "";
      const result = await webdavPut(cfg, remote, textForDisk(), davConflictPolicy, prev);
      davSyncTip = result.message;
      davSyncState = "idle";
      dirty = false;
      await updateTitle();
      refreshSideNow();
      clearRecoveryDraftsForDoc(null, remote); // 云端文档无本地路径：按远端路径清该文档全部草稿
      if (result.status === "conflict") {
        // 冲突：已在同目录另存副本，原远端文件（含对方的改动）完好；不回填索引，
        // 下次保存仍会判定冲突并另存，直到用户自行合并。
        void messageDialog(result.message, { title: "Sticho", kind: "warning" });
      } else {
        davSyncIndex = {
          ...davSyncIndex,
          [remote]: { remote: result.remote, size: result.size, modified: result.modified },
        };
        void saveSetting("davSyncIndex", davSyncIndex);
        // 云端内容已与本机对齐，撤销「云端有更新」的提示
        cloudUpdates = cloudUpdates.filter((u) => u.remote !== result.remote);
      }
    } catch (e) {
      davSyncState = "error";
      davSyncTip = e instanceof Error ? e.message : String(e);
      await showError(t("Failed to save: "), e);
    } finally {
      busy = wasBusy;
    }
  }

  /**
   * 保存成功后清掉该文档的**全部**自动保存草稿（磁盘文件已是最新，草稿没意义了）。
   *
   * 需求：多版本控制只统计用户主动保存产生的版本，定时自动保存的草稿在保存后一律清空。
   * 同一文件可能开在多个标签里（各有各的 draftId），故按 path / 远端路径 / 当前标签
   * 三路命中标签，再用「已知 draftId」与「草稿元信息里的 path」删掉对应草稿。
   */
  function clearRecoveryDraftsForDoc(path: string | null, remote: string | null = null): void {
    const active = activeTab();
    // 命中的标签：当前标签必然算；本地文档按 path 匹配，云端文档按远端路径匹配
    // （同一文件可能开在多个标签里，各有各的 draftId）
    const hitTabs = tabs.filter(
      (tb) => tb === active || (path !== null && tb.path === path) || (remote !== null && tb.remote === remote),
    );
    const ids = new Set(hitTabs.map((tb) => tb.draftId));
    for (const tb of hitTabs) tb.draftHash = "";
    void (async () => {
      try {
        const metas = await listRecovery();
        for (const m of metas) {
          // 草稿元信息记了原文件 path（无 remote 字段），故这里用「已知 draftId」+
          // 「path」两条命中规则：前者覆盖仍在标签栏的同一文档，后者覆盖已关闭标签的残留草稿。
          const hit = ids.has(m.id) || (path !== null && m.path === path);
          if (hit) await deleteRecovery(m.id);
        }
      } catch {
        // 静默：清草稿属收尾动作，失败不能影响保存本身
      }
    })();
  }

  /**
   * 会话恢复出来的标签只带元信息，正文第一次被激活时才取回（本地读盘 / 云端下载）。
   *
   * 不在此处吞掉「文件已被删除」的异常：直接把路径清掉降级为未命名文档，
   * 用户至少能看到这个标签是空的，而不是启动时弹一串错误框。
   */
  async function loadTabContent(tab: DocTab): Promise<void> {
    tab.loaded = true;
    if (tab.path) {
      try {
        const file = await readTextFile(tab.path);
        tab.content = file.content;
        tab.encoding = file.encoding;
        tab.eol = detectEol(file.content);
      } catch {
        // 文件已被删除 / 读不到：降级为未命名文档，别让标签停在会误导的空内容上
        tab.content = "";
        tab.path = null;
      }
      return;
    }
    // 绑定云端的文档（无本地文件）：正文不在本地，从远端重新取回。
    // 取回失败则解除绑定：宁可降级为未命名文档，也不能让用户对着空正文保存、
    // 把云端原内容覆盖成空。
    if (tab.remote) {
      try {
        tab.content = await webdavDownload(
          { url: davUrl.trim(), user: davUser, password: davPass },
          tab.remote,
        );
        tab.eol = detectEol(tab.content);
      } catch {
        tab.content = "";
        tab.remote = null;
      }
    }
  }

  /**
   * 启动时恢复上次退出时的标签集（批次六）。
   *
   * 标签集与各标签的未保存正文是分开存的：元信息在 settings 的 "session" 键，
   * 正文在各自的恢复草稿里。恢复**全部**标签（含已保存的干净标签）——正常关闭后再启动
   * 应当还原上次打开的标签集；只有「存在未保存内容」时才弹框确认（那是需要用户担责的操作），
   * 全是干净标签时静默恢复，免得每次启动都被一张「要不要恢复上次的窗口」打扰。
   * 返回 true 表示本次启动已按会话处理过（不再走单草稿的兜底提示）。
   */
  async function tryRestoreSession(): Promise<boolean> {
    const session = await loadSetting<SessionState>("session").catch(() => undefined);
    const list = session?.tabs ?? [];
    if (list.length === 0) return false;
    const dirtyCount = list.filter((item) => item.dirty).length;

    // 有未保存内容才弹确认框；否则直接静默恢复全部标签
    if (dirtyCount > 0) {
      const ok = await confirmDialog(
        t("Found {n} unsaved tab(s) from your last session (out of {total} tabs). Restore them?", { n: dirtyCount, total: list.length }),
        { title: "Sticho", kind: "warning", okLabel: t("Restore"), cancelLabel: t("Discard") },
      );
      if (!ok) {
        for (const item of list) void deleteRecovery(item.draftId).catch(() => {});
        await saveSetting("session", { tabs: [], active: 0 });
        lastSessionJson = "";
        return true;
      }
    }

    const built: DocTab[] = [];
    for (const item of list) {
      tabSeq += 1;
      const tab = newDocTab(tabSeq, "");
      tab.draftId = item.draftId; // 沿用旧草稿 id：恢复出来的标签继续往同一份草稿上写
      tab.kind = item.kind === "html" ? "html" : item.kind === "code" ? "code" : "markdown";
      tab.path = item.path;
      tab.remote = item.remote ?? null;
      tab.encoding = item.encoding || "utf-8";
      if (item.eol === "\r\n" || item.eol === "\n") tab.eol = item.eol;
      tab.htmlView = item.htmlView === "source" ? "source" : "preview";
      tab.dirty = !!item.dirty;
      tab.loaded = false; // 正文先不读：会话恢复只带元信息，等这个标签被激活时再读盘
      const draft = item.dirty ? await readRecovery(item.draftId).catch(() => null) : null;
      if (draft !== null) {
        tab.content = draft;
        tab.loaded = true;
        if (item.eol === undefined) tab.eol = detectEol(draft); // 老会话无行尾字段：按草稿探测
      } else if (restoredTabNeedsWelcome(item, tab.remote)) {
        // 干净、未命名、无云端绑定：这是上次那个「欢迎文档」标签。正文只来自 createTab 注入的
        // 欢迎文案，从未变脏，所以既没有路径也没有草稿——不补回来，下面 activateTab 投影到
        // 编辑器里的就是空正文（实测现象：关掉再打开，文档是空白）。
        tab.content = welcomeText();
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
      t("Found unsaved content from an abnormal exit ({title}, {when}). Restore it?", { title: latest.title, when }),
      { title: "Sticho", kind: "warning", okLabel: t("Restore"), cancelLabel: t("Discard") },
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
        currentRemote = null;
        setDocumentPath(null);
        diskMtime = null;
      }
    } else {
      currentPath = null;
      currentRemote = null;
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
    docEol = detectEol(content); // 恢复草稿的行尾风格
    dirty = true; // 恢复的是未保存内容，必须标记未保存
    // 接管这份草稿：否则下一轮会另写一份新 id 的草稿，旧的从此成了再也无人认领的孤儿
    const tab = activeTab();
    if (tab) {
      tab.draftId = latest.id;
      tab.draftHash = recoveryFingerprint(content);
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
    const gutter =
      (md && (editorMode === "sv" || editorMode === "none" || largeReading)) || codeLargeText !== null;
    setLineNumbersVisible(showLineNumbers && gutter);
    setTypewriterMode(typewriterOn && md);
    setParagraphFocusVisible(paragraphFocus && md);
    setCodeTypewriter(typewriterOn && code);
    setCodeParagraphFocus(paragraphFocus && code);
    setCodeLineNumbers(showLineNumbers && code); // 未挂载时是 no-op
    setCodeLineWrapping(autoWrap && code && codeLargeText === null);
    setLargeReaderWrap(autoWrap);
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

  // 阅读排版按文档模式分流（需求约定）：
  // - Markdown / 纯文本：字体、字号、行距、文字颜色、页面背景全部生效；
  // - 代码视图：只字号、行距、页面背景生效（文字色交给语法高亮，字体固定等宽栈）；
  // - HTML：自带样式，全部不生效（显式传空设置，等价于移除样式节点）。
  $effect(() => {
    if (docKind === "markdown") setReaderStyle(readerStyle);
    else if (docKind === "code") setReaderStyle({ background: readerStyle.background });
    else setReaderStyle({});
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
   * 按键本身不翻译（键位跨语言一致），功能描述与分组名走 t()（英文原文即键）。
   */
  const SHORTCUT_GROUPS: { group: string; items: { keys: string; desc: string }[] }[] = [
    {
      group: "File",
      items: [
        { keys: "Ctrl+N", desc: "New Tab" },
        { keys: "Ctrl+O", desc: "Open…" },
        { keys: "Ctrl+P", desc: "Command Palette…" },
        { keys: "Ctrl+S", desc: "Save" },
        { keys: "Ctrl+Shift+S", desc: "Save As…" },
        { keys: "Ctrl+,", desc: "Settings" },
        { keys: "Ctrl+Q", desc: "Exit" },
      ],
    },
    {
      group: "Tabs",
      items: [
        { keys: "Ctrl+W", desc: "Close Tab" },
        { keys: "Ctrl+Tab", desc: "Next Tab" },
        { keys: "Ctrl+Shift+Tab", desc: "Previous Tab" },
        { keys: "Middle Click", desc: "Middle-clicking a tab also closes it" },
      ],
    },
    {
      group: "Export",
      items: [
        { keys: "Ctrl+Shift+E", desc: "Export as Word Document" },
        { keys: "Ctrl+Shift+P", desc: "Export as PDF Document" },
        { keys: "Ctrl+Shift+H", desc: "Export as HTML Document" },
        { keys: "Ctrl+Shift+T", desc: "Export as Plain Text File" },
      ],
    },
    {
      group: "Edit",
      items: [
        { keys: "Ctrl+Z", desc: "Undo" },
        { keys: "Ctrl+Y", desc: "Redo" },
        { keys: "Ctrl+X", desc: "Cut" },
        { keys: "Ctrl+C", desc: "Copy" },
        { keys: "Ctrl+V", desc: "Paste" },
        { keys: "Ctrl+F2", desc: "Toggle Bookmark" },
        { keys: "F4", desc: "Next Bookmark" },
        { keys: "Shift+F4", desc: "Previous Bookmark" },
      ],
    },
    {
      group: "Find / Replace",
      items: [
        { keys: "Ctrl+F", desc: "Find…" },
        { keys: "F3", desc: "Find Next" },
        { keys: "Shift+F3", desc: "Find Previous" },
        { keys: "Ctrl+H", desc: "Replace" },
      ],
    },
    {
      group: "Paragraph",
      items: [
        { keys: "Ctrl+1~6", desc: "Heading 1-6" },
        { keys: "Ctrl+0", desc: "Paragraph" },
        { keys: "Ctrl+Shift+[", desc: "Ordered List" },
        { keys: "Ctrl+Shift+]", desc: "Unordered List" },
        { keys: "Ctrl+[", desc: "Increase Indent" },
        { keys: "Ctrl+]", desc: "Decrease Indent" },
        { keys: "Ctrl+Shift+Q", desc: "Blockquote" },
      ],
    },
    {
      group: "Format",
      items: [
        { keys: "Ctrl+B", desc: "Bold" },
        { keys: "Ctrl+I", desc: "Italic" },
        { keys: "Ctrl+K", desc: "Link" },
        { keys: "Ctrl+Shift+K", desc: "Code Block" },
        { keys: "Ctrl+Shift+`", desc: "Inline Code" },
        { keys: "Ctrl+Shift+M", desc: "Math Block" },
        { keys: "Ctrl+Shift+I", desc: "Insert Image" },
        { keys: "Alt+Shift+5", desc: "Strikethrough" },
      ],
    },
    {
      group: "View",
      items: [
        { keys: "Ctrl+Shift+L", desc: "Sidebar" },
        { keys: "Ctrl+Shift+1", desc: "Document Outline" },
        { keys: "Ctrl+Shift+3", desc: "File Tree" },
        { keys: "F8", desc: "Paragraph Focus" },
        { keys: "F9", desc: "Typewriter Mode" },
        { keys: "F11", desc: "Immersive Fullscreen Editing" },
        { keys: "Ctrl+E", desc: "Reading Mode" },
      ],
    },
    {
      group: "Other",
      items: [
        { keys: "Alt+F/E/P/O/V/H", desc: "Open the corresponding menu" },
        { keys: "Esc", desc: "Close the menu and the find bar" },
      ],
    },
  ];

  function showShortcuts(): void {
    shortcutsOpen = true;
  }

  // 用自绘模态替代原生消息框：原生弹窗无法放图片，应用图标只能自己画
  function showAbout(): void {
    aboutOpen = true;
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
   * 「视图 → 纯文本模式」三级子菜单的子菜单项：自动（按扩展名）/ 纯文本 / 各语言，单选。
   *
   * 只在代码文件下有意义：Markdown 走 Lute、HTML 走文档模式，高亮与语言跟格式绑定。
   * 选中态与动作都在渲染/点击时求值（不在这里缓存路径），否则切换标签后圆点会指错文档。
   * 动作统一走 applyCodeLang：先确保切到纯文本模式，再设置高亮语言。
   */
  function codeLangSubmenu(): MenuItem[] {
    const items: MenuItem[] = [
      {
        label: t("Auto (by Extension)"),
        radio: true,
        checked: () => codeLangOverrides[codeLangKey(currentPath)] === undefined,
        action: () => void applyCodeLang(undefined),
      },
      {
        label: t("Plain Text"),
        radio: true,
        checked: () => codeLangOverrides[codeLangKey(currentPath)] === null,
        action: () => void applyCodeLang(null),
      },
      { sep: true },
    ];
    for (const { id, name } of LANG_LIST) {
      items.push({
        label: name,
        radio: true,
        checked: () => codeLangOverrides[codeLangKey(currentPath)] === id,
        action: () => void applyCodeLang(id),
      });
    }
    return items;
  }

  /**
   * 「文件 → 编码」子菜单：常表 + 当前编码。
   *
   * 自动检测可能给出常表之外的编码（windows-1251 / euc-jp / ISO-8859-x …），
   * 不把它补进列表的话，用户既看不到当前选中态、也没法把编码切回这一项。
   * 这里读 `encoding`，故本函数在 $derived 的 MENUS 里被调用时会注册依赖，
   * 编码一变就自动重建菜单（按原样只用 ✓ 勾选，与其余子菜单保持一致）。
   */
  function encodingSubmenu(): MenuItem[] {
    const items: MenuItem[] = [
      { label: t("Auto-detect"), action: () => applyEncoding(null) },
      { sep: true },
    ];
    const list = ENCODINGS.some((e) => e.id === encoding)
      ? ENCODINGS
      : [...ENCODINGS, { id: encoding, label: encoding }];
    for (const enc of list) {
      items.push({
        label: t(enc.label),
        checked: () => encoding === enc.id,
        action: () => applyEncoding(enc.id),
      });
    }
    return items;
  }

  // 菜单文案随语言切换重建（$derived 读取 locale，切换后自动重渲染）
  const MENUS: MenuDef[] = $derived([
    {
      id: "file",
      label: t("File"),
      key: "f",
      items: [
        { label: t("New Tab"), shortcut: "Ctrl+N", disabled: () => busy, action: newTab },
        { label: t("Open…"), shortcut: "Ctrl+O", disabled: () => busy, action: openFile },
        // 命令面板对齐 Typora 的「快速打开」（Ctrl+P）：同一处肌肉记忆，也顺手挡住 WebView2 的打印弹窗
        { label: t("Command Palette…"), shortcut: "Ctrl+P", action: openCommandPalette },
        {
          label: t("Open Recent"),
          disabled: () => recentFiles.length === 0,
          dynamic: () => [
            ...recentFiles.map((p) => ({ label: fileName(p), action: () => openRecent(p) })),
            { sep: true },
            { label: t("Clear Recent Files"), action: clearRecentFiles },
          ],
        },
        { sep: true },
        { label: t("Save"), shortcut: "Ctrl+S", disabled: () => busy, action: saveFile },
        { label: t("Save As…"), shortcut: "Ctrl+Shift+S", disabled: () => busy, action: saveFileAs },
        { sep: true },
        // 标签操作归入子菜单，避免「文件」一级菜单过长；各项快捷键保持不变
        {
          label: t("Tabs"),
          sub: [
            { label: t("Close Tab"), shortcut: "Ctrl+W", disabled: () => busy, action: () => closeTab(activeIndex) },
            { label: t("Close Other Tabs"), disabled: () => busy || tabs.length < 2, action: () => closeOtherTabs() },
            { sep: true },
            { label: t("Next Tab"), shortcut: "Ctrl+Tab", disabled: () => tabs.length < 2, action: () => cycleTab(1) },
            { label: t("Previous Tab"), shortcut: "Ctrl+Shift+Tab", disabled: () => tabs.length < 2, action: () => cycleTab(-1) },
          ],
        },
        { sep: true },
        {
          label: t("Import"),
          disabled: () => busy,
          sub: [
            { label: t("Import Word…"), action: importWord },
            { label: t("Import PDF…"), action: importPdfFile },
            { label: t("Import HTML as Markdown…"), action: importHtml },
            { label: t("Convert to Markdown to Edit"), disabled: () => docKind !== "html", action: () => void convertToMarkdown() },
          ],
        },
        {
          label: t("Export"),
          disabled: () => busy,
          sub: [
            { label: t("Export as Word"), shortcut: "Ctrl+Shift+E", disabled: () => docKind !== "markdown", action: exportWord },
            { label: t("Export as PDF"), shortcut: "Ctrl+Shift+P", action: exportPdfFile },
            { label: t("Export as HTML"), shortcut: "Ctrl+Shift+H", action: exportHtmlFile },
            { label: t("Export as Plain Text"), shortcut: "Ctrl+Shift+T", action: exportTxtFile },
            { sep: true },
            // LaTeX / Epub 经 Pandoc 转 Markdown，对代码与 HTML 文档语义不成立，置灰
            { label: t("Export as LaTeX (.tex)"), disabled: () => docKind !== "markdown", action: exportLatexFile },
            { label: t("Export as Epub (.epub)"), disabled: () => docKind !== "markdown", action: exportEpubFile },
          ],
        },
        { label: t("Print…"), action: () => void printDoc() },
        { sep: true },
        {
          label: t("Encoding"),
          disabled: () => busy,
          sub: encodingSubmenu(),
        },
        { label: t("File Properties…"), action: showFileInfo },
        {
          // 本地版本历史：保存覆盖前自动留档，误改可就地回滚（离线、无需配置）
          label: t("File History"),
          disabled: () => busy || !currentPath || docKind === "code",
          dynamic: () =>
            historyEntries.length === 0
              ? [{ label: t("(No version history yet)"), disabled: () => true }]
              : historyEntries.map((h) => ({
                  label: `${formatStamp(h.saved_at)} · ${formatSize(h.size)}`,
                  action: () => void historyVersionMenu(h.file),
                })),
        },
        {
          // 恢复中心：统一浏览恢复草稿与全部文档的本地版本历史，可预览后恢复 / 另存 / 删除
          label: t("Recovery Center…"),
          action: () => {
            recoveryOpen = true;
          },
        },
        { sep: true },
        // 偏好设置对齐 Typora：放在「文件」菜单末尾、Ctrl+,
        { label: t("Settings…"), shortcut: "Ctrl+,", action: () => { settingsOpen = true; } },
        { sep: true },
        { label: t("Quit"), shortcut: "Ctrl+Q", action: exitApp },
      ],
    },
    {
      id: "edit",
      label: t("Edit"),
      key: "e",
      items: [
        { label: t("Undo"), shortcut: "Ctrl+Z", disabled: () => docKind === "html" || browseMode, action: undoEditor },
        { label: t("Redo"), shortcut: "Ctrl+Y", disabled: () => docKind === "html" || browseMode, action: redoEditor },
        { sep: true },
        { label: t("Cut"), shortcut: "Ctrl+X", disabled: () => docKind === "html" || browseMode, action: cutSelection },
        { label: t("Copy"), shortcut: "Ctrl+C", disabled: () => docKind === "html", action: copySelection },
        { label: t("Paste"), shortcut: "Ctrl+V", disabled: () => docKind === "html" || browseMode, action: pasteClipboard },
        { sep: true },
        // HTML 文档模式下这几项由 textarea / 预览原生行为承担，查找替换三种视图均可用
        { label: t("Find…"), shortcut: "Ctrl+F", action: openFind },
        { label: t("Find Next"), shortcut: "F3", action: () => findNext(false) },
        { label: t("Find Previous"), shortcut: "Shift+F3", action: () => findNext(true) },
        { label: t("Replace…"), shortcut: "Ctrl+H", action: openFind },
        { sep: true },
        { label: t("Toggle Bookmark"), shortcut: "Ctrl+F2", disabled: () => !bookmarksAllowed(), action: toggleBookmark },
        { label: t("Next Bookmark"), shortcut: "F4", disabled: () => !bookmarksAllowed(), action: () => void nextBookmark(1) },
        { label: t("Previous Bookmark"), shortcut: "Shift+F4", disabled: () => !bookmarksAllowed(), action: () => void nextBookmark(-1) },
        { label: t("Clear Bookmarks"), disabled: () => !bookmarksAllowed(), action: clearBookmarks },
        { sep: true },
        {
          // 只服务代码视图：美化 / 压缩按扩展名选工具，小工具面板与语言无关
          label: t("Code Tools"),
          // 超大代码文件走只读分节纯文本，没有 CodeMirror 可改写，整组置灰
          disabled: () => browseMode || docKind !== "code" || codeLargeText !== null,
          sub: [
            { label: t("Beautify JSON"), action: () => applyCodeTool(prettyJson) },
            { label: t("Minify JSON"), action: () => applyCodeTool(minifyJson) },
            { sep: true },
            { label: t("Beautify CSS"), action: () => applyCodeTool(prettyCss) },
            { label: t("Minify CSS"), action: () => applyCodeTool(minifyCss) },
            { sep: true },
            // JS 走安全子集：只重排缩进 / 只删空行，绝不合并行（见 lib/codeTools.ts）
            { label: t("Beautify JS (safe subset)"), action: () => applyCodeTool(prettyJs) },
            { label: t("Minify JS (safe subset)"), action: () => applyCodeTool(minifyJs) },
            { sep: true },
            { label: t("Utilities…"), action: () => (codeToolsOpen = true) },
          ],
        },
        {
          // 文本工具：面向整篇文档的排版清洗，三种文档模式都可用
          // （超大代码文件是只读分节视图，无可改写，整组置灰）
          label: t("Text Tools"),
          disabled: () => browseMode || busy || codeLargeText !== null,
          sub: [
            { label: t("Remove Blank Lines"), action: () => applyTextTool(removeBlankLines) },
            { label: t("Trim Trailing Spaces"), action: () => applyTextTool(removeTrailingSpaces) },
            { label: t("Collapse Inner Spaces"), action: () => applyTextTool(collapseInnerSpaces) },
            { sep: true },
            { label: t("Add Space Between CJK and Latin"), action: () => applyTextTool(cjkLatinAddSpace) },
            { label: t("Remove Space Between CJK and Latin"), action: () => applyTextTool(cjkLatinRemoveSpace) },
          ],
        },
      ],
    },
    {
      id: "paragraph",
      label: t("Paragraph"),
      key: "p",
      readonlyLocked: true,
      items: [
        {
          label: t("Heading"),
          sub: [1, 2, 3, 4, 5, 6].map((n) => ({
            label: t("Heading {n}", { n }),
            shortcut: `Ctrl+${n}`,
            action: () => applyHeading(n),
          })),
        },
        // 正文对齐 Typora 的 Ctrl+0：清掉当前行的标题，回到普通段落
        { label: t("Paragraph"), shortcut: "Ctrl+0", action: clearHeading },
        { sep: true },
        { label: t("Unordered List"), shortcut: "Ctrl+Shift+]", action: () => applyFormat("list") },
        { label: t("Ordered List"), shortcut: "Ctrl+Shift+[", action: () => applyFormat("ordered-list") },
        { label: t("Task List"), action: () => applyFormat("check") },
        { sep: true },
        { label: t("Increase Indent"), shortcut: "Ctrl+[", action: () => applyFormat("indent") },
        { label: t("Decrease Indent"), shortcut: "Ctrl+]", action: () => applyFormat("outdent") },
        { sep: true },
        { label: t("Blockquote"), shortcut: "Ctrl+Shift+Q", action: () => applyFormat("quote") },
        { label: t("Horizontal Rule"), action: () => applyFormat("line") },
        {
          // 批次七：Vditor 只在 IR 模式的快捷键里提供整列对齐，这里提到菜单中
          label: t("Align Column"),
          disabled: () => docKind !== "markdown",
          sub: [
            { label: t("Align Left"), action: () => void alignTable("left") },
            { label: t("Align Center"), action: () => void alignTable("center") },
            { label: t("Align Right"), action: () => void alignTable("right") },
          ],
        },
      ],
    },
    {
      id: "format",
      label: t("Format"),
      key: "o",
      readonlyLocked: true,
      items: [
        { label: t("Bold"), shortcut: "Ctrl+B", action: () => applyFormat("bold") },
        { label: t("Italic"), shortcut: "Ctrl+I", action: () => applyFormat("italic") },
        { label: t("Strikethrough"), shortcut: "Alt+Shift+5", action: () => applyFormat("strike") },
        { label: t("Inline Code"), shortcut: "Ctrl+Shift+`", action: () => applyFormat("inline-code") },
        { sep: true },
        { label: t("Link"), shortcut: "Ctrl+K", action: () => applyFormat("link") },
        { label: t("Insert Image"), shortcut: "Ctrl+Shift+I", action: () => insertLocalImage() },
        { label: t("Emoji"), action: () => applyFormat("emoji") },
        { sep: true },
        { label: t("Code Block"), shortcut: "Ctrl+Shift+K", action: () => applyFormat("code") },
        { label: t("Math Block"), shortcut: "Ctrl+Shift+M", action: insertMathBlock },
        { label: t("Mermaid Diagram"), action: insertMermaidBlock },
        { label: t("Table"), action: () => applyFormat("table") },
      ],
    },
    {
      id: "view",
      label: t("View"),
      key: "v",
      items: [
        // 文档模式：纯文本 / Markdown / HTML，三选一（二级项）；各自的下级菜单（三级）
        // 承载该模式特有的渲染/高亮选项。默认由后缀决定（见 openPath/openHtmlPath/openCodePath）；
        // 超大代码文件是只读分节视图，无可切换的渲染器，整组置灰。
        {
          label: t("Plain Text Mode"),
          radio: true,
          disabled: () => busy || codeLargeText !== null,
          checked: () => docKind === "code",
          // 点击父项本身也能选中（切换为纯文本模式），子菜单照常展开
          action: () => void setDocMode("code"),
          sub: [
            // 首行：父项本身只负责展开子菜单，这里给一个直接「启用纯文本模式」的入口
            { label: t("Enable Plain Text Mode"), disabled: () => busy || codeLargeText !== null || docKind === "code", action: () => void setDocMode("code") },
            { sep: true },
            ...codeLangSubmenu(),
          ],
        },
        {
          label: t("Markdown Mode"),
          radio: true,
          disabled: () => busy || codeLargeText !== null,
          checked: () => docKind === "markdown",
          // 点击父项本身也能选中（切换为 Markdown 模式），子菜单照常展开
          action: () => void setDocMode("markdown"),
          sub: [
            // 首行：直接启用 Markdown 模式（保留当前渲染方式，若当前不是 Markdown 则切过来）
            { label: t("Enable Markdown Mode"), disabled: () => busy || codeLargeText !== null || docKind === "markdown", action: () => void setDocMode("markdown") },
            { sep: true },
            { label: t("Instant Rendering (IR)"), radio: true, disabled: () => docKind !== "markdown", checked: () => docKind === "markdown" && editorMode === "ir", action: () => void applyMarkdownRender("ir") },
            { label: t("WYSIWYG"), radio: true, disabled: () => docKind !== "markdown", checked: () => docKind === "markdown" && editorMode === "wysiwyg", action: () => void applyMarkdownRender("wysiwyg") },
            { label: t("Split View (SV)"), radio: true, disabled: () => docKind !== "markdown", checked: () => docKind === "markdown" && editorMode === "sv", action: () => void applyMarkdownRender("sv") },
            { label: t("No Render"), radio: true, disabled: () => docKind !== "markdown", checked: () => docKind === "markdown" && editorMode === "none", action: () => void applyMarkdownRender("none") },
            { sep: true },
            // 排版工具栏是 Markdown 模式独有的功能，故随该模式的二级菜单一起出现
            // （与 HTML 模式的「执行文档脚本」同一层级）
            {
              label: t("Show Formatting Toolbar"),
              checked: () => showToolbar,
              disabled: () => docKind !== "markdown",
              action: toggleEditorToolbar,
            },
          ],
        },
        {
          label: t("HTML Mode"),
          radio: true,
          disabled: () => busy || codeLargeText !== null,
          checked: () => docKind === "html",
          // 点击父项本身也能选中（切换为 HTML 模式），子菜单照常展开
          action: () => void setDocMode("html"),
          sub: [
            // 首行：直接启用 HTML 模式（默认进预览视图）
            { label: t("Enable HTML Mode"), disabled: () => busy || codeLargeText !== null || docKind === "html", action: () => void setDocMode("html") },
            { sep: true },
            { label: t("Preview"), radio: true, disabled: () => docKind !== "html", checked: () => docKind === "html" && htmlView === "preview", action: () => void applyHtmlMode("preview") },
            { label: t("Source"), radio: true, disabled: () => docKind !== "html", checked: () => docKind === "html" && htmlView === "source", action: () => void applyHtmlMode("source") },
            { sep: true },
            { label: t("Run Document Scripts (JavaScript)"), checked: () => htmlScripts, disabled: () => docKind !== "html", action: () => void applyHtmlScriptToggle() },
          ],
        },
        { sep: true },
        // 侧边栏：六个面板各自的勾选开关——点击即勾选 / 取消，勾选即把侧边栏显示出来并切到该面板；
        // 全部取消则侧边栏自动收起。显示 / 隐藏侧边栏仍可用 Ctrl+Shift+L 或侧边栏上的关闭按钮。
        {
          label: t("Sidebar"),
          // 点击父项本身也能切换侧边栏显隐，子菜单照常展开
          action: toggleSidebar,
          sub: [
            // 首行：侧边栏总开关——勾选=显示侧边栏、取消=隐藏（与下面各面板是否勾选无关）
            { label: t("Enable Sidebar"), shortcut: "Ctrl+Shift+L", checked: () => sidebarVisible, action: toggleSidebar },
            { sep: true },
            { label: t("File Tree"), shortcut: "Ctrl+Shift+3", checked: () => sidebarPanels.tree, action: () => void toggleSidebarPanel("tree") },
            { label: t("Document Outline"), shortcut: "Ctrl+Shift+1", checked: () => sidebarPanels.outline, disabled: () => docKind === "code", action: () => void toggleSidebarPanel("outline") },
            { label: t("Bookmarks"), checked: () => sidebarPanels.bookmarks, action: () => void toggleSidebarPanel("bookmarks") },
            { label: t("File Properties"), checked: () => sidebarPanels.props, action: () => void toggleSidebarPanel("props") },
            { label: t("Search in Files"), checked: () => sidebarPanels.search, action: () => void toggleSidebarPanel("search") },
            { label: t("Cloud Folder"), checked: () => sidebarPanels.cloud, action: () => void toggleSidebarPanel("cloud") },
          ],
        },
        // 阅读 / 编辑：只读开关（打开 / 新建 / 导入后先进阅读模式还是直接编辑，由「设置 → 打开」决定）
        { label: t("Reading Mode"), shortcut: "Ctrl+E", checked: () => browseMode, action: () => void setBrowseMode(!browseMode) },
        {
          label: t("Wrap Long Lines"),
          checked: () => autoWrap,
          action: toggleAutoWrap,
        },
        // 编辑器显示：行号（排版工具栏已移入「Markdown 模式」二级菜单，它是该模式独有的功能）
        {
          label: t("Show Line Numbers"),
          checked: () => showLineNumbers && lineNumbersSupported,
          disabled: () => !lineNumbersSupported,
          action: toggleLineNumbers,
        },
        { sep: true },
        // 专注写作：打字机 / 段落聚焦 / 沉浸式全屏，都是「让注意力回到正文」的显示模式
        {
          label: t("Typewriter Mode"),
          shortcut: "F9",
          checked: () => typewriterOn && docKind !== "html",
          disabled: () => docKind === "html",
          action: toggleTypewriter,
        },
        {
          label: t("Paragraph Focus"),
          shortcut: "F8",
          checked: () => paragraphFocus && docKind !== "html",
          disabled: () => docKind === "html",
          action: toggleParagraphFocus,
        },
        { label: t("Immersive Fullscreen Editing"), shortcut: "F11", checked: () => isEditorFullscreen(), action: toggleEditorFullscreen },
      ],
    },
    {
      id: "help",
      label: t("Help"),
      key: "h",
      items: [
        { label: t("Getting Started…"), action: () => (welcomeOpen = true) },
        { label: t("Keyboard Shortcuts…"), action: showShortcuts },
        { sep: true },
        { label: t("Download Support Components…"), action: downloadSupportComponents },
        { label: t("Export Diagnostics…"), action: exportDiagnosticsReport },
        { sep: true },
        { label: t("About Sticho…"), action: showAbout },
      ],
    },
  ]);

  function toggleMenu(id: string): void {
    const willOpen = menuOpen !== id;
    menuOpen = willOpen ? id : null;
    subOpen = null;
    subOpen2 = null;
    // 展开「文件」菜单时刷新历史版本列表，供「文件历史」动态子菜单使用
    if (willOpen && id === "file") void refreshHistory();
  }

  function runMenuItem(item: MenuItem): void {
    // 菜单项改用 aria-disabled（原生 disabled 会吞掉鼠标事件，悬停说明就看不到了），
    // 因此这里必须自己挡住不可用项的动作。
    if (item.disabled?.()) return;
    menuOpen = null;
    subOpen = null;
    subOpen2 = null;
    void item.action?.();
  }

  // ---- 命令面板（批次四，Ctrl+P）----

  /**
   * 把菜单树拍平成命令列表：展开 sub 与 dynamic 子项，跳过分隔线、无动作项与当前不可用的项。
   * dynamic 在每次打开面板时求值，最近文件 / 文件历史这类动态子菜单才能拿到最新数据。
   */
  function flatMenuItems(): PaletteCommand[] {
    const out: PaletteCommand[] = [];
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
        // 稳定 id：由「分类 + 标签」组成（同一面板内唯一）。此前用自增序号，
        // 每次重建列表 id 都变，keyed each 会把节点全部重建，高亮 / 滚动位置随之丢失。
        out.push({
          id: `${category}|${item.label}`,
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
    subOpen2 = null;
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
      // 提前收场也要推进请求代次：在途请求返回时按代次比对，不推进的话它的旧结果
      // 会把这里的「已清空 / 正则无效」状态覆盖回去（用户会看到结果又冒出来）。
      // 同时把 busy 落下——在途请求的 finally 因代次不符不会再管它，只能在这里收尾。
      searchSeq += 1;
      searchBusy = false;
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
        clear(t("Invalid regular expression."));
        return;
      }
      needle = literalAnchor(query);
      if (needle === "") {
        clear(
          t("This regex contains no searchable literal text (letters / digits / symbols), so the scope cannot be narrowed first. Add a fixed piece of text to the regex."),
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
      await showError(t("Failed to open: "), e);
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
    const prevWord = findWord;
    const prevRegex = findRegex;
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
    // 全词 / 正则是被上面临时改写成「搜索时的语义」的，必须一起还原，
    // 否则用户下次打开查找栏会发现开关被静默改掉了
    findWord = prevWord;
    findRegex = prevRegex;
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
      } else if (cloudOpen) {
        // 云文件模态是从设置面板里打开的独立覆盖层：它必须比设置面板先关，
        // 否则 Esc 会把下层的设置面板关掉，而这个模态还留在屏幕上（✕ 的提示写着 Esc）
        cloudOpen = false;
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
      } else if (docMenu) {
        docMenu = null;
        e.preventDefault();
      } else if (menuOpen) {
        menuOpen = null;
        subOpen = null;
        subOpen2 = null;
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
        // 只有真正命中菜单项才拦截并吞掉事件；未命中时放行，别把所有 Alt 组合键一并吞掉
        e.preventDefault();
        toggleMenu(hit.id);
        return;
      }
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

    if (e.key === "F4") {
      e.preventDefault();
      nextBookmark(e.shiftKey ? -1 : 1);
      return;
    }

    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();

    if (e.key === "F2") {
      e.preventDefault();
      toggleBookmark();
      return;
    }

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
      // Word 只对 Markdown 有意义（与菜单置灰同口径）：其他文档类型下不拦截、不动作
      if (docKind === "markdown") {
        e.preventDefault();
        void exportWord();
      }
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
    hideTip(); // 点击任意处先收起提示浮窗，避免残留在画面上
    if (!(e.target as Element | null)?.closest?.(".menu-root")) {
      menuOpen = null;
      subOpen = null;
      subOpen2 = null;
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
    if (!(e.target as Element | null)?.closest?.(".mode-wrap")) {
      modeOpen = false;
    }
    if (!(e.target as Element | null)?.closest?.(".tab-menu")) {
      tabMenu = null;
      docMenu = null;
    }
  }

  // ---- 拖拽导入（阶段 7）：md/html 直接打开，docx/pdf 走导入管道 ----
  async function handleDroppedFiles(paths: string[]): Promise<void> {
    if (busy || paths.length === 0) return;
    busy = true;
    try {
      // 逐个打开全部路径：拖拽多个文件、以及单实例转发（open-file 回调）传来一批路径时，
      // 此前只处理 paths[0]，其余被静默丢弃。
      // 每个文件各自 try/catch：某个不支持 / 打开失败不会中断其余文件。
      for (const path of paths) {
        const ext = extOf(path);
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
            await messageDialog(t("Unsupported file type (.{ext}); only md / html / docx / pdf / code files are supported.", { ext }), {
              title: "Sticho",
              kind: "info",
            });
          }
        } catch (e) {
          await showError(t("Failed to open: "), e);
        }
      }
    } finally {
      busy = false;
    }
  }

  // ---- 生命周期 ----
  onMount(() => {
    const win = getCurrentWindow();

    void (async () => {
      // 配置位置引导（批次十三）：首次运行时先让用户选定数据根目录，否则后续
      // loadAllSettings / 主题 / 日志等命令都拿不到位置（Rust 侧会拒绝写入）。
      await ensureConfigReady();
      // 启动配置一次性读回：此前二十个键逐个 await 是二十次串行 IPC，整体拖慢首帧
      const s = await loadAllSettings();
      // 启动计时（长期保留）：窗口由前端在首帧后 show()，「感知启动时间」= 页面开始 →
      // 编辑器显示出内容这一刻。各阶段写进应用日志（「帮助 → 导出诊断信息」能看到），
      // 用户机器上启动慢时能直接看出卡在哪一段，不必靠猜。wall 是墙钟，用于与 Rust 侧的
      // 「应用启动」日志对时间线（进程启动 → 页面开始 这一段只能这样才看出来）。
      const startupMark = (stage: string): void =>
        void logEvent("INFO", `[startup] ${stage} +${Math.round(performance.now())}ms (wall ${Date.now()})`).catch(() => {});
      startupMark("settings loaded");
      // 启动配置：外观（主题统一决定）、最近文件、侧边栏、文件关联
      // 外观已并入「主题」：未选主题 = 内置浅色默认；选中主题按自身 color-scheme 定深浅
      // （见 refreshThemes）。这里先落默认浅色，深色主题随后由 refreshThemes 切换。
      userTheme = (s["userTheme"] as string | undefined) ?? null;
      // 旧配置里显式选过「深色」的，迁移到内置深色主题「暗墨」，避免升级后莫名变浅色
      if (userTheme === null && (s["theme"] as string | undefined) === "dark") {
        userTheme = INK_DARK_THEME_FILE;
        void saveSetting("userTheme", userTheme);
        // 旧键 theme 必须一并删除：它是「外观三选（浅/深/跟随系统）」的遗留控制位，
        // 留着的话用户显式清掉主题后，下次启动会被这里再次强制拉回「暗墨」。
        void deleteSetting("theme");
      }
      applyAppTheme(false);
      // 界面语言（批次八；批次十五起默认中文）：先读设置再初始化编辑器，让 Vditor 一次就用对语言
      locale = (s["locale"] as Locale | undefined) ?? "zh-CN";
      void setEditorLocale(vditorLang(locale));
      document.documentElement.lang = locale;
      recentFiles = (s["recentFiles"] as string[] | undefined) ?? [];
      // 代码文件「手动指定语法高亮语言」的覆盖表（键为路径指纹）：setCodeLang 负责写盘，
      // 这里必须读回，否则重启后回退成按扩展名判定，用户设过的语言白设。
      codeLangOverrides = (s["codeLangOverrides"] as Record<string, string | null> | undefined) ?? {};
      sidebarVisible = (s["sidebarVisible"] as boolean | undefined) ?? true;
      sidebarView = (s["sidebarView"] as SidebarView | undefined) ?? "outline";
      // 面板开关：与默认值合并，兼容旧配置（没有该键时只开文件树/大纲/书签，属性/搜索/云端默认关）
      sidebarPanels = { tree: true, outline: true, bookmarks: true, props: false, search: false, cloud: false, ...(s["sidebarPanels"] as Partial<Record<SidebarView, boolean>> | undefined) };
      // 全部面板关闭时侧边栏没有内容可显示，强制收起（旧配置可能存着 sidebarVisible=true）
      if (enabledSidebarViews.length === 0) sidebarVisible = false;
      // 上次停留的面板被关掉时，落回第一个仍开启的面板
      else if (!sidebarPanels[sidebarView]) sidebarView = enabledSidebarViews[0]!;
      // 行号的开合统一由下方按「当前视图是否支持」的门控 $effect 落地，这里只取值，
      // 否则会在 IR / 所见即所得这类不支持行号的视图里把它硬打开
      showLineNumbers = (s["lineNumbers"] as boolean | undefined) ?? true;
      autoWrap = (s["wrapLongLines"] as boolean | undefined) ?? true;
      // 排版工具栏的显示开关（视图菜单）：与行号 / 自动换行同属「视图偏好」，一律持久化。
      // 编辑器此刻多半尚未就绪，setter 会暂存到 after 里回放（见 editor.ts 的 toolbarPending）
      showToolbar = (s["showToolbar"] as boolean | undefined) ?? true;
      setEditorToolbarVisible(showToolbar);
      typewriterOn = (s["typewriterMode"] as boolean | undefined) ?? false;
      paragraphFocus = (s["paragraphFocus"] as boolean | undefined) ?? false;
      setTypewriterMode(typewriterOn);
      setParagraphFocusVisible(paragraphFocus);
      // 阅读排版（字体 / 字号 / 行距 / 文字色 / 护眼底色）：按文档模式分流见下方 $effect
      readerStyle = (s["readerStyle"] as ReaderStyle | undefined) ?? {};
      autoSaveEnabled = (s["autoSave"] as boolean | undefined) ?? true;
      autoSaveIntervalMin = (s["autoSaveIntervalMin"] as number | undefined) ?? 1;
      defaultOpenMode = (s["defaultOpenMode"] as "read" | "edit" | undefined) ?? "edit";
      // 顶栏自定义按钮开关：与默认值（全关）合并，兼容旧配置
      toolbarButtons = { find: false, undo: false, redo: false, save: false, recovery: false, fullscreen: false, ...(s["toolbarButtons"] as Partial<Record<ToolbarButtonId, boolean>> | undefined) };
      findCase = (s["findCase"] as boolean | undefined) ?? false;
      findWord = (s["findWord"] as boolean | undefined) ?? false;
      findRegex = (s["findRegex"] as boolean | undefined) ?? false;
      // WebDAV 云同步（批次九）：连接参数与开关；davVerified 不持久化见状态声明处的说明
      davUrl = (s["davUrl"] as string | undefined) ?? "";
      // HTTPS 开关：旧配置没有该键时，按已存地址的协议推断（http:// 视为关）
      davUseHttps =
        (s["davUseHttps"] as boolean | undefined) ?? !davUrl.trim().toLowerCase().startsWith("http://");
      davUser = (s["davUser"] as string | undefined) ?? "";
      davRoot = (s["davRoot"] as string | undefined) ?? "/Sticho";
      davEnabled = (s["davEnabled"] as boolean | undefined) ?? false;
      historyKeep = (s["historyKeep"] as number | undefined) ?? 20;
      historyCountLimitOn = (s["historyCountLimitOn"] as boolean | undefined) ?? true;
      historySizeLimitOn = (s["historySizeLimitOn"] as boolean | undefined) ?? false;
      historyMaxSizeMb = (s["historyMaxSizeMb"] as number | undefined) ?? 100;
      historyAgeLimitOn = (s["historyAgeLimitOn"] as boolean | undefined) ?? false;
      historyMaxAgeDays = (s["historyMaxAgeDays"] as number | undefined) ?? 30;
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
        startupMark("window shown");
      }, 0);

      // 编辑器运行时（Vditor 本体 + i18n）先预取：与下面几次目录 IPC 并行下载 / 解析，
      // 不必等目录就绪才开始 import，编辑器就绪时间随之提前（失败无妨，initEditor 会重拉）。
      void preloadEditor();

      // 自定义主题（批次八）：读主题目录，已选主题立即注入 head（须在编辑器绘制前完成）；
      // 语言包 / 字体包（批次十二）：释放默认包 → 加载词表与字体，失败也不阻挡启动。
      // 顺序不能并行：内置「暗墨」等主题文件要先由 initPacks 落盘，refreshThemes 才能把
      // 用户选中的主题认出来，否则会被当成「文件已被删除」而回落默认。
      await initPacks();
      startupMark("packs released");
      await refreshThemes();
      startupMark("themes refreshed");

      const host = document.getElementById("editor-host")!;
      // 打开即阅读模式：先把只读意图写进编辑器层（此时正文元素还没建好，
      // 真正的 disabled() 由 editor.ts 在就绪回调里补一次）
      setEditorReadonly(true);
      // 欢迎正文在 initPacks 之后才拿得到（要等 docs/Welcome.<locale>.md 释放并读回），
      // 而初始标签是脚本顶层用内置文案建的：这里把还没被动过的初始标签正文对齐成最终内容，
      // 否则它和编辑器里显示的内容会不一致（后续同步会把旧文案写回去）。
      const initial = welcomeText();
      const firstTab = tabs[activeIndex];
      if (firstTab && firstTab.path === null && !firstTab.dirty) firstTab.content = initial;
      void initEditor(host, initial, theme === "dark");
      startupMark("editor init kicked off");
      onEditorChange(() => syncFromEditor());
      // 渲染模式变化（工具栏下拉或菜单）：同步状态栏图标与视图菜单复选
      onEditorModeChange((mode) => {
        // 「不渲染」是我们主动切到 sv 的结果，不要被同步覆盖回 sv
        if (editorMode === "none" && mode === "sv") return;
        editorMode = mode;
      });
      // 大文档走分节渲染通路时（editor.ts 自动判定），把应用层拉回阅读模式：
      // 那条通路只有只读的分节正文，界面必须如实反映「现在是阅读态」。
      onLargeModeChange((active) => {
        largeReading = active; // 行号适用性判定要用（见 lineNumbersSupported）
        if (active) resetToBrowseMode();
      });
      // 大文档的正文随滚动挂载 / 卸载分节，查找高亮的 Range 会随之失效，重画一次
      onLargeRenderChange(() => scheduleLargeFindRepaint());
      // 与编辑器首屏无关的启动收尾：全部不 await，趁 Vditor 还在加载资源的窗口并行铺开，
      // 不再串行堆在 initEditor 前面（此前是 4 次串行 IPC 才轮到编辑器开始加载）。
      void updateTitle();
      // 密码走加密存储，并顺带把旧版留在 settings.json 里的明文迁移走；云同步其后初始化
      // （后台静默验证连接 + 检查云端变更，网络慢不该拖住启动）
      void restoreDavPassword().finally(() => void initCloud());
      // 配置文件保存位置（批次十）：只读展示当前根目录，位置本身由 Rust 引导文件决定
      void refreshDataLocation();
      void loadAssocState();

      // Vditor 异步加载资源，初始化完成前读写内容会抛错（侧边栏大纲、启动文件都要用到）
      await whenEditorReady();
      startupMark("editor ready (awaited)");
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
          await showError(t("Failed to open the startup file: "), e);
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
      startupMark("startup finished");

      // 入门指南（批次四）：首次启动弹一次，与上面的对话框顺序出现，避免叠在一起
      if (!welcomeShown) welcomeOpen = true;
    })();

    // 外部变更轮询（批次七）：只在有路径且非 busy 时真正发起查询；
    // 窗口不可见时 checkExternalChange 会直接跳过（见其内部注释）
    const stopExternalPoll = startPolling(EXTERNAL_POLL_INTERVAL_MS, () => void checkExternalChange());

    // 恢复可见时立刻补查一次，不必干等下一个 5 秒
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkExternalChange();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Tauri 的事件监听返回解绑函数（异步 resolve），要在卸载时调用，否则监听器会随
    // 组件重建不断累积——旧闭包仍持有已失效的状态。
    // 直接持有各监听的 Promise（而非 resolve 后才赋值的局部变量）：若组件在 resolve
    // 之前就卸载，解绑函数还没拿到，旧写法会漏解绑；统一在 cleanup 里等 Promise 再解绑。
    const unlisteners: Promise<() => void>[] = [];

    // 未保存关闭拦截（preventDefault 必须同步调用，确认框异步进行）
    let closing = false;
    unlisteners.push(
      win.onCloseRequested((event) => {
        captureActiveTab();
        // 第一次请求已弹出确认框。确认框未决期间用户再点一次「×」若直接放行，
        // 窗口会在确认框还在的情况下关掉——未保存内容随之丢失。这里必须继续拦截。
        if (closing) {
          event.preventDefault();
          return;
        }
        closing = true;
        event.preventDefault();
        void (async () => {
          try {
            if (anyTabDirty()) {
              const dirtyCount = tabs.filter((_t, i) => tabDirty(i)).length;
              const ok = await confirmDialog(
                dirtyCount > 1
                  ? t("{n} tabs have unsaved changes that will be discarded on exit. Exit anyway?", { n: dirtyCount })
                  : t("The current document has unsaved changes that will be discarded on exit. Exit anyway?"),
                {
                  title: "Sticho",
                  kind: "warning",
                  okLabel: t("Exit"),
                  cancelLabel: t("Cancel"),
                },
              );
              if (!ok) return; // finally 会复位 closing，用户可以再来一次
            }
            // 退出前最后落一份草稿与会话：定时器可能刚好还没轮到，且关闭自动保存时
            // tickAutoSave 是空转，这里显式 saveSession 保证标签集/顺序/活跃项不丢。
            await tickAutoSave();
            await saveSession();
            await win.destroy();
          } finally {
            closing = false; // 未走 destroy 的路径（取消/异常）复位，避免窗口永远关不掉
          }
        })();
      }),
    );

    // 拖拽文件到窗口（enter/leave 控制高亮，drop 分发到对应处理管道）
    unlisteners.push(
      win.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          dragOver = true;
        } else if (payload.type === "leave") {
          dragOver = false;
        } else if (payload.type === "drop") {
          dragOver = false;
          void handleDroppedFiles(payload.paths);
        }
      }),
    );

    // 单实例转发（文件关联后双击文档时，程序已在运行）：Rust 侧把第二次启动的
    // 文件路径通过 open-file 事件发过来，复用拖拽导入的分发逻辑新开标签页。
    unlisteners.push(
      listen<string[]>("open-file", (event) => {
        const paths = event.payload ?? [];
        if (paths.length > 0) void handleDroppedFiles(paths);
      }),
    );

    return () => {
      stopExternalPoll();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // 定时器也要清掉：否则组件（开发期热重载）重建后旧定时器仍会触发，
      // 闭包持有已失效的状态。只在触发时清零是不够的——挂起中的定时器不会被触发。
      if (outlineTimer !== undefined) clearTimeout(outlineTimer);
      if (largeFindTimer !== null) clearTimeout(largeFindTimer);
      if (tipShowTimer !== 0) clearTimeout(tipShowTimer);
      if (tipHideTimer !== 0) clearTimeout(tipHideTimer);
      // 监听可能还没 resolve 就卸载：统一等 Promise 再解绑，避免漏解绑
      void Promise.all(unlisteners).then((fns) => fns.forEach((fn) => fn()));
    };
  });
</script>

<svelte:window onkeydown={onKeydown} onclick={onWindowClick} />

<div class="app" class:drag-over={dragOver} class:md-source-only={mdSourceOnly} class:read-mode={browseMode}>
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
                  onmouseleave={() => {
                    subOpen = null;
                    subOpen2 = null;
                  }}
                >
                  <button
                    class="menu-item"
                    class:is-disabled={locked || item.disabled?.()}
                    aria-disabled={locked || item.disabled?.()}
                    title={item.tip}
                    onclick={() => {
                      if (locked || item.disabled?.()) return;
                      // 带 action 的父项（纯文本 / Markdown / HTML 模式、侧边栏）：点击即选中并执行，
                      // 同时照常展开子菜单；其余父项仍只负责展开
                      if (item.action) void item.action();
                      subOpen = item.label ?? null;
                    }}
                  >
                    <span class="mark">{item.radio ? (item.checked?.() ? "●" : "") : (item.checked?.() ? "✓" : "")}</span>
                    <span class="label">{item.label}</span>
                    <span class="arrow">›</span>
                  </button>
                  {#if subOpen === item.label}
                    <div class="menu-panel sub-panel">
                      {#each children as child, j (j)}
                        {#if child.sep}
                          <div class="menu-sep"></div>
                        {:else if child.sub || child.dynamic}
                          {@const grandchildren = child.sub ?? child.dynamic?.() ?? []}
                          <div
                            class="menu-sub"
                            role="none"
                            onmouseenter={() => {
                              if (!locked && !child.disabled?.()) subOpen2 = child.label ?? null;
                            }}
                            onmouseleave={() => {
                              subOpen2 = null;
                            }}
                          >
                            <button
                              class="menu-item"
                              class:is-disabled={locked || child.disabled?.()}
                              aria-disabled={locked || child.disabled?.()}
                              title={child.tip}
                              onclick={() => {
                                if (!locked && !child.disabled?.()) {
                                  runMenuItem(child);
                                  subOpen2 = child.label ?? null;
                                }
                              }}
                            >
                              <span class="mark">{child.radio ? (child.checked?.() ? "●" : "") : (child.checked?.() ? "✓" : "")}</span>
                              <span class="label">{child.label}</span>
                              <span class="arrow">›</span>
                            </button>
                            {#if subOpen2 === child.label}
                              <div class="menu-panel sub-panel">
                                {#each grandchildren as g, k (k)}
                                  {#if g.sep}
                                    <div class="menu-sep"></div>
                                  {:else}
                                    <button
                                      class="menu-item"
                                      class:is-disabled={locked || g.disabled?.()}
                                      aria-disabled={locked || g.disabled?.()}
                                      onclick={() => runMenuItem(g)}
                                    >
                                      <span class="mark">{g.radio ? (g.checked?.() ? "●" : "") : (g.checked?.() ? "✓" : "")}</span>
                                      <span class="label" title={g.tip}>{g.label}</span>
                                      {#if g.shortcut}<span class="shortcut">{g.shortcut}</span>{/if}
                                    </button>
                                  {/if}
                                {/each}
                              </div>
                            {/if}
                          </div>
                        {:else}
                          <button
                            class="menu-item"
                            class:is-disabled={locked || child.disabled?.()}
                            aria-disabled={locked || child.disabled?.()}
                            onclick={() => runMenuItem(child)}
                          >
                            <span class="mark">{child.radio ? (child.checked?.() ? "●" : "") : (child.checked?.() ? "✓" : "")}</span>
                            <span class="label" title={child.tip}>{child.label}</span>
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
          title={i === activeIndex ? currentPath ?? t("Not saved to disk yet") : tab.path ?? t("Not saved to disk yet")}
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
          <span class="tab-label">{tabTitle(i)}</span>
          {#if tabDirty(i)}<span class="tab-dot" aria-hidden="true">●</span>{/if}
          <span
            class="tab-close"
            role="none"
            title={t("Close Tab")}
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
      <!-- 工具栏自定义按钮：勾选项按顺序排在皮肤按钮左侧，样式与皮肤按钮一致 -->
      {#each TOOLBAR_BUTTONS as btn (btn.id)}
        {#if toolbarButtons[btn.id]}
          <button
            class="icon-btn"
            title={t(btn.label)}
            aria-label={t(btn.label)}
            disabled={btn.disabled()}
            onclick={btn.run}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              {#if btn.id === "find"}
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              {:else if btn.id === "undo"}
                <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              {:else if btn.id === "redo"}
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              {:else if btn.id === "save"}
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
              {:else if btn.id === "recovery"}
                <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><polyline points="3 3 3 8 8 8" /><polyline points="12 7.5 12 12 15 13.8" />
              {:else}
                <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              {/if}
            </svg>
          </button>
        {/if}
      {/each}
      <div class="menu-root skin-root">
        <button
          class="icon-btn"
          class:open={skinOpen}
          title={t("Skin Settings")}
          aria-label={t("Skin Settings")}
          onclick={toggleSkin}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8.5 3 L4.2 5.1 A1.6 1.6 0 0 0 3.4 6.5 V10 a0.9 0.9 0 0 0 0.9 0.9 H6.2 V20 a1 1 0 0 0 1 1 H16.8 a1 1 0 0 0 1-1 V10.9 H19.7 a0.9 0.9 0 0 0 0.9-0.9 V6.5 a1.6 1.6 0 0 0 -0.8-1.4 L15.5 3" />
            <path d="M8.5 3 a3.5 3.5 0 0 0 7 0" />
          </svg>
        </button>

        {#if skinOpen}
          <div class="menu-panel skin-panel">
            <!-- 工具栏自定义：勾选的按钮以小图标显示在顶栏右侧（皮肤按钮左边） -->
            <section class="set-group">
              <div class="set-head">
                <h3>{t("Toolbar")}</h3>
              </div>
              <div class="set-checks">
                {#each TOOLBAR_BUTTONS as btn (btn.id)}
                  <label class="set-check">
                    <input
                      type="checkbox"
                      checked={toolbarButtons[btn.id]}
                      onchange={() => void toggleToolbarButton(btn.id)}
                    />
                    <span>{t(btn.label)}</span>
                  </label>
                {/each}
              </div>
            </section>

            <!-- 外观（主题统一决定）：选主题即改整份配色，并按其 color-scheme 定编辑器 / 代码高亮深浅 -->
            <section class="set-group">
              <div class="set-head">
                <h3 data-tip={t("Appearance is set here: “Light (Default)” is the built-in light theme; picking a theme applies its colors and switches the editor / code highlighting to match — a theme counts as dark when its CSS declares color-scheme: dark. Put any .css file in the themes folder to use it here.")}>{t("Theme")}</h3>
                <button class="set-action" onclick={() => void openThemesFolder()}>{t("Open Themes Folder")}</button>
              </div>
              <div class="set-row">
                <select
                  class="set-select"
                  value={userTheme ?? ""}
                  onchange={(e) => void selectUserTheme(e.currentTarget.value === "" ? null : e.currentTarget.value)}
                >
                  <option value="">{t("Light (Default)")}</option>
                  {#each themeFiles as file (file.name)}
                    <option value={file.name}>{file.name.replace(/\.css$/i, "")}</option>
                  {/each}
                </select>
              </div>
            </section>

            <!-- 阅读排版：Markdown/纯文本全量生效，代码视图仅字号/行距/背景，HTML 不受影响 -->
            <section class="set-group">
              <div class="set-head">
                <h3 data-tip={t("Scope: font, size, line height and text color apply to Markdown / plain text only; the code view honors only font size, line height and page background (text color is handled by syntax highlighting); HTML documents keep their own styles and are unaffected.")}>{t("Reading Typography")}</h3>
                <button class="set-action" onclick={() => void openFontsFolder()}>{t("Open Fonts Folder")}</button>
              </div>

              <label class="set-row">
                <span class="set-label" data-tip={t("Font packs: put .ttf / .otf / .woff2 files into the “fonts folder” to use them in the font list above.")}>{t("Font")}</span>
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
                <span class="set-label">{t("Font Size")}</span>
                <select
                  class="set-select"
                  value={readerStyle.fontSize ?? ""}
                  onchange={(e) => void setReaderOption("fontSize", e.currentTarget.value)}
                >
                  <option value="">{t("Default")}</option>
                  {#each READER_SIZES as size (size)}
                    <option value={size}>{size}</option>
                  {/each}
                </select>
              </label>

              <label class="set-row">
                <span class="set-label">{t("Line Height")}</span>
                <select
                  class="set-select"
                  value={readerStyle.lineHeight ?? ""}
                  onchange={(e) => void setReaderOption("lineHeight", e.currentTarget.value)}
                >
                  <option value="">{t("Default")}</option>
                  {#each READER_LINES as lh (lh)}
                    <option value={lh}>{lh}</option>
                  {/each}
                </select>
              </label>

              <div class="set-row set-row--stack">
                <span class="set-label">{t("Text Color")}</span>
                <div class="reader-swatches">
                  <button class:active={!readerStyle.textColor} title={t("Default")} onclick={() => void setReaderOption("textColor", "")}>
                    {t("Default")}
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
                    title={t("Custom color")}
                    oninput={(e) => void setReaderOption("textColor", e.currentTarget.value)}
                  />
                </div>
              </div>

              <div class="set-row set-row--stack">
                <span class="set-label">{t("Page Background")}</span>
                <div class="reader-swatches">
                  <button class:active={!readerStyle.background} title={t("Default")} onclick={() => void setReaderOption("background", "")}>
                    {t("Default")}
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
                    title={t("Custom color")}
                    oninput={(e) => void setReaderOption("background", e.currentTarget.value)}
                  />
                </div>
              </div>

              <button class="set-action" onclick={() => void resetReaderStyle()}>{t("Reset Typography")}</button>
            </section>
          </div>
        {/if}
      </div>

      <button class="icon-btn" title={t("Settings")} aria-label={t("Settings")} onclick={() => (settingsOpen = true)}>
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
      i18nEntries={activeEntries}
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
        bookmarks={bookmarkItems}
        onAddBookmark={addBookmark}
        bookmarksAllowed={bookmarksAllowed()}
        onClose={toggleSidebar}
        onOpenFile={openFromTree}
        onPickRoot={pickTreeRoot}
        onGotoHeading={gotoHeading}
        onSearch={(q, cs, re) => void runSearch(q, cs, re)}
        onOpenHit={(hit) => void openSearchHit(hit)}
        dav={davUrl.trim() !== "" ? davConfig : null}
        onOpenCloud={(remote, content) => void openCloudBound(remote, content)}
        t={t}
      />
    {/if}

    <div class="editor-area" role="presentation" oncontextmenu={openDocMenu}>
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
                title={t("HTML Preview")}
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
    i18nEntries={activeEntries}
    {wordCount}
    {charCount}
    {lineCount}
    {currentPath}
    {currentRemote}
    {dirty}
    {docKind}
    onSetDocKind={(kind) => void setDocMode(kind)}
    {editorMode}
    onSetEditorMode={switchEditorMode}
    {htmlView}
    onSetHtmlView={setHtmlView}
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
    onToggleTypewriter={() => void toggleTypewriter()}
    onToggleParagraphFocus={() => void toggleParagraphFocus()}
    {encoding}
    bind:encodingOpen
    bind:modeOpen
    onApplyEncoding={(id) => void applyEncoding(id)}
    {davEnabled}
    {davSyncState}
    {davSyncTip}
    cloudUpdateCount={cloudUpdates.length}
    cloudUpdateTip={cloudUpdates.length === 0
      ? ""
      : `${t("Cloud versions updated: {n}", { n: cloudUpdates.length })}\n${cloudUpdates.map((u) => u.name).join("、")}`}
    onOpenCloudUpdates={() => void promptCloudUpdates()}
  />

  {#if dragOver}
    <div class="drop-overlay">{t("Release to open the file (supports md / html / docx / pdf)")}</div>
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
      <div class="modal modal--shortcuts" role="dialog" aria-label={t("Keyboard Shortcuts")}>
        <div class="modal-head">
          <span>{t("Keyboard Shortcuts")}</span>
          <button class="icon-btn" title={t("Close")} aria-label={t("Close")} onclick={() => (shortcutsOpen = false)}>✕</button>
        </div>
        <div class="modal-body">
          <table class="sc-table">
            <thead>
              <tr><th>{t("Shortcut")}</th><th>{t("Function")}</th></tr>
            </thead>
            {#each SHORTCUT_GROUPS as group (group.group)}
              <tbody>
                <tr class="sc-group"><td colspan="2">{t(group.group)}</td></tr>
                {#each group.items as item (item.desc)}
                  <tr>
                    <td class="sc-keys"><kbd>{t(item.keys)}</kbd></td>
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

  <!-- 关于（帮助菜单）：带应用图标的自绘对话框 -->
  {#if aboutOpen}
    <div
      class="modal-mask"
      role="none"
      onclick={(e) => {
        if (e.target === e.currentTarget) aboutOpen = false;
      }}
    >
      <div class="modal modal--about" role="dialog" aria-label={t("About Sticho")}>
        <div class="modal-head">
          <span>{t("About Sticho")}</span>
          <button class="icon-btn" title={t("Close")} aria-label={t("Close")} onclick={() => (aboutOpen = false)}>✕</button>
        </div>
        <div class="modal-body about-body">
          <img class="about-logo" src="/sticho-icon.png" alt="Sticho" />
          <div class="about-title">{t("Sticho {version}", { version: APP_VERSION })}</div>
          <p class="about-line">{t("A lightweight Markdown / plain text / code / HTML document editor.")}</p>
          <p class="about-line">{t("Converts between Markdown, Word, PDF and HTML, all on your machine.")}</p>
          <p class="about-line about-dim">{t("Built with Tauri + Svelte + Vditor.")}</p>
          <p class="about-line about-dim">
            {t("Word conversion is done by a separate Pandoc process (GPL-2.0, not bundled with this app).")}
          </p>
          <!-- 作者与版权：中英文一致，硬编码即可，不入 i18n 词表（免得撞「中文值 ≠ 英文键」的断言） -->
          <div class="about-author">© 2026 Marvin 翁敏峰</div>
          <!-- GitHub 占位：开源后把这里替换成真实仓库链接（届时改成 <a> 并复用现有外链打开方式） -->
          <div class="about-links">
            <span class="about-link about-link--placeholder">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
                />
              </svg>
              <span>GitHub</span>
            </span>
          </div>
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
          <button class="icon-btn" title={t("Cancel")} aria-label={t("Cancel")} onclick={() => resolveChoice(null)}>✕</button>
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
      i18nEntries={activeEntries}
      appVersion={APP_VERSION}
      bind:settingsTab
      onClose={() => (settingsOpen = false)}
      selectLocale={(id) => void selectLocale(id)}
      {localeOptions}
      onOpenLocalesDir={() => void openLocalesFolder()}
      {autoSaveEnabled}
      onToggleAutoSave={() => void toggleAutoSave()}
      {autoSaveIntervalMin}
      onSetAutoSaveInterval={(n) => void setAutoSaveInterval(n)}
      {defaultOpenMode}
      onSetDefaultOpenMode={(m) => void setDefaultOpenMode(m)}
      {historyKeep}
      onSetHistoryKeep={(n) => void setHistoryKeep(n)}
      {historyCountLimitOn}
      onSetHistoryCountLimitOn={(v) => void setHistoryCountLimitOn(v)}
      {historySizeLimitOn}
      onSetHistorySizeLimitOn={(v) => void setHistorySizeLimitOn(v)}
      {historyMaxSizeMb}
      onSetHistoryMaxSizeMb={(n) => void setHistoryMaxSizeMb(n)}
      {historyAgeLimitOn}
      onSetHistoryAgeLimitOn={(v) => void setHistoryAgeLimitOn(v)}
      {historyMaxAgeDays}
      onSetHistoryMaxAgeDays={(n) => void setHistoryMaxAgeDays(n)}
      {notepadAll}
      {assocBusy}
      onToggleNotepad={() => void toggleNotepad()}
      onOpenDefaultApps={() => void openDefaultApps()}
      {contextMenu}
      onToggleContextMenu={() => void toggleContextMenu()}
      {recentFiles}
      onClearRecentFiles={() => void clearRecentFiles()}
      onClearSystemWrites={() => void clearSystemWrites()}
      onClearConfigFiles={() => void clearConfigFiles()}
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
      bind:davUseHttps
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
      {davConflictPolicy}
      onSetDavConflictPolicy={(p) => void setDavConflictPolicy(p)}
      {dataLocation}
      {locationBusy}
      onChangeDataLocation={(m) => void changeDataLocation(m)}
      {dataRootPath}
      {locationTip}
      {locationTipOk}
    />
  {/if}

  {#if configSetupOpen}
    <ConfigSetupDialog
      {locale}
      i18nEntries={activeEntries}
      {localeOptions}
      onSelectLocale={selectSetupLocale}
      busy={configSetupBusy}
      tip={configSetupTip}
      onChoose={(m) => void chooseConfigLocation(m)}
    />
  {/if}

  {#if codeToolsOpen}
    <CodeTools
      {locale}
      i18nEntries={activeEntries}
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
      i18nEntries={activeEntries}
      dav={davConfig}
      onOpen={(remote, content) => void openCloudDoc(remote, content)}
      onClose={() => (cloudOpen = false)}
    />
  {/if}

  <!-- 恢复中心（文件菜单 →「恢复中心…」）：统一浏览恢复草稿与本地版本历史 -->
  {#if recoveryOpen}
    <RecoveryCenter
      {locale}
      i18nEntries={activeEntries}
      onRestore={(payload) => void restoreFromRecoveryCenter(payload)}
      onClose={() => (recoveryOpen = false)}
    />
  {/if}

  {#if diffView}
    <DiffView
      {locale}
      i18nEntries={activeEntries}
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
      i18nEntries={activeEntries}
      commands={paletteCommands}
      onClose={() => (paletteOpen = false)}
    />
  {/if}

  <!-- 入门指南（批次四）：首次启动弹出，帮助菜单可随时重开 -->
  {#if welcomeOpen}
    <WelcomeDialog {locale} i18nEntries={activeEntries} appVersion={APP_VERSION} onClose={dismissWelcome} />
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
      <button class="menu-item" role="menuitem" onclick={() => runTabMenu("close")}>
        <span class="label">{t("Close Tab")}</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        disabled={tabs.length < 2}
        onclick={() => runTabMenu("closeOther")}
      >
        <span class="label">{t("Close Other Tabs")}</span>
      </button>
      <div class="menu-sep" role="separator"></div>
      <button
        class="menu-item"
        role="menuitem"
        disabled={tabMenu.index === tabs.length - 1}
        onclick={() => runTabMenu("closeRight")}
      >
        <span class="label">{t("Close Tabs to the Right")}</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        disabled={tabMenu.index === 0}
        onclick={() => runTabMenu("closeLeft")}
      >
        <span class="label">{t("Close Tabs to the Left")}</span>
      </button>
      <div class="menu-sep" role="separator"></div>
      <!-- 打开文件位置：未保存到本地（或仅云端）的标签不可用 -->
      <button
        class="menu-item"
        role="menuitem"
        disabled={!tabPathAt(tabMenu.index)}
        onclick={() => runTabMenu("reveal")}
      >
        <span class="label">{t("Open File Location")}</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        disabled={busy}
        onclick={() => runTabMenu("save")}
      >
        <span class="label">{t("Save")}</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        disabled={busy}
        onclick={() => runTabMenu("saveAs")}
      >
        <span class="label">{t("Save As…")}</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        onclick={() => runTabMenu("properties")}
      >
        <span class="label">{t("File Properties")}</span>
      </button>
    </div>
  {/if}

  <!-- 文档区右键菜单：代码 / Markdown 文档自绘（标准编辑项 + 添加为书签），HTML 保留原生菜单 -->
  {#if docMenu}
    <div
      class="tab-menu"
      role="menu"
      tabindex="-1"
      style={`left:${docMenu.x}px; top:${docMenu.y}px`}
      oncontextmenu={(e) => e.preventDefault()}
    >
      <button
        class="menu-item"
        role="menuitem"
        class:is-disabled={browseMode || !docSelectionText()}
        aria-disabled={browseMode || !docSelectionText()}
        onclick={() => void runDocMenu("cut")}
      >
        <span class="label">{t("Cut")}</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        class:is-disabled={!docSelectionText()}
        aria-disabled={!docSelectionText()}
        onclick={() => void runDocMenu("copy")}
      >
        <span class="label">{t("Copy")}</span>
      </button>
      <button
        class="menu-item"
        role="menuitem"
        class:is-disabled={browseMode}
        aria-disabled={browseMode}
        onclick={() => void runDocMenu("paste")}
      >
        <span class="label">{t("Paste")}</span>
      </button>
      <button class="menu-item" role="menuitem" onclick={() => void runDocMenu("selectAll")}>
        <span class="label">{t("Select All")}</span>
      </button>
      {#if bookmarksAllowed()}
        <div class="menu-sep" role="separator"></div>
        <button class="menu-item" role="menuitem" onclick={() => void runDocMenu("bookmark")}>
          <span class="label">{t("Add Bookmark")}</span>
        </button>
      {/if}
    </div>
  {/if}

  <!-- 自绘浮窗说明（data-tip）：固定定位在最外层，不受设置面板滚动裁剪 -->
  {#if tipText}
    <div class="app-tip" bind:this={tipEl} style={`left:${tipLeft}px; top:${tipTop}px`}>{tipText}</div>
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

  /* 阅读模式的选中标签：改用阅读强调色，与编辑模式（强调蓝）区分 */
  .app.read-mode .tab.active {
    border-color: var(--read-accent, #2f9e44);
    box-shadow: inset 0 2px 0 var(--read-accent, #2f9e44);
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 未保存标记：独立节点才能单独染红（拼进标签文案里会跟着文字走同一种颜色） */
  .tab-dot {
    flex: 0 0 auto;
    color: var(--danger, #e5484d);
    font-size: 0.9em;
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
    color: var(--danger-contrast, #fff);
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

  /* 顶栏自定义按钮：当前文档不可用时置灰、不响应点击 */
  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .icon-btn:disabled:hover {
    background: transparent;
  }

  /* 皮肤设置面板：承载外观 / 主题 / 阅读排版三块设置，比一级菜单宽；
     按钮在齿轮左边，面板向左展开避免溢出窗口右侧，内容超高时自身滚动 */
  .skin-panel {
    width: 380px;
    max-height: 74vh;
    overflow-y: auto;
    padding: 0.9rem 0.85rem;
    left: auto;
    right: 0;
  }

  /* 分组标题行：标题在左、可选的「打开…文件夹」动作按钮贴右，下沿一条细线分隔 */
  .skin-panel .set-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border, #ddd);
  }

  .skin-panel .set-head h3 {
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 1;
  }

  /* 面板内控件统一过渡，聚焦时给一圈强调色 */
  .skin-panel .set-action {
    transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
  }

  .skin-panel .set-action:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18);
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

  /* ---- 关于对话框（帮助菜单）：居中展示应用图标与版本信息 ---- */
  .modal--about {
    /* 原 340px；按用户要求加宽到约 1.3 倍，版本信息与说明文字排布更舒展 */
    width: 442px;
  }

  .about-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.35rem;
  }

  .about-logo {
    width: 72px;
    height: 72px;
    border-radius: 16px;
    margin: 0.2rem 0 0.4rem;
  }

  .about-title {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .about-line {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .about-dim {
    opacity: 0.7;
  }

  .about-author {
    margin-top: 0.5rem;
    font-size: 0.75rem;
    opacity: 0.85;
  }

  .about-links {
    margin-top: 0.15rem;
    display: flex;
    justify-content: center;
  }

  /* GitHub 占位：开源后替换为真实链接（届时改成可点的 <a>，复用现有外链打开方式） */
  .about-link--placeholder {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    opacity: 0.45;
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

  /* 皮肤设置面板里的动作按钮（打开主题文件夹 / 恢复默认排版）与上方控件拉开间距 */
  .set-group > .set-action {
    margin-top: 0.5rem;
  }

  /* 自绘浮窗说明（data-tip / 原生 title）：替代系统气泡——限宽提前换行、圆角柔和描边、
     随主题取色的浮面，并带轻微淡入，固定在视口坐标不受面板滚动裁剪影响 */
  .app-tip {
    position: fixed;
    z-index: 900;
    max-width: 320px;
    padding: 0.45rem 0.7rem;
    font-size: 0.75rem;
    line-height: 1.6;
    white-space: pre-line;
    overflow-wrap: anywhere;
    color: var(--tip-fg, #1f2328);
    background: var(--tip-bg, #fff);
    border: 1px solid var(--tip-border, rgba(120, 120, 130, 0.28));
    border-radius: 8px;
    box-shadow: var(--tip-shadow, 0 8px 22px rgba(0, 0, 0, 0.14));
    backdrop-filter: blur(2px);
    pointer-events: none;
    transform-origin: top left;
    animation: app-tip-in 0.12s ease-out;
  }

  @keyframes app-tip-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .set-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.8125rem;
    padding: 0.25rem 0;
    cursor: pointer;
  }

  /* 工具栏自定义的多选框：固定三列排布，兼顾横向空间与阅读顺序 */
  .set-checks {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.2rem 0.9rem;
  }

  .set-check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    font-size: 0.8125rem;
    padding: 0.2rem 0;
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
