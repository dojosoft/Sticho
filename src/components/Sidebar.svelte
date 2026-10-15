<script lang="ts">
  /**
   * 左侧侧边栏（任务书阶段 11）
   *
   * 多个视图互相切换：文件目录树 / 文档大纲 / 文件属性 / 跨文件搜索 / 文档内书签。
   * 目录树按需加载（展开时才读目录），大纲、文件属性与搜索结果的数据由 App 侧提供，
   * 本组件只负责渲染与交互，避免把文件状态逻辑散落到两个文件里。
   */
  import { onDestroy, untrack } from "svelte";
  import { listDir, type DavConfig, type DirEntry } from "../lib/tauri-api";
  import type { OutlineItem, SidebarView } from "../lib/sidebar";
  import { highlightSegments, highlightRegexSegments, type SearchGroup, type SearchHit, type TextSegment } from "../lib/fileSearch";
  import CloudTree from "./CloudTree.svelte";
  import BookmarksPanel from "./BookmarksPanel.svelte";

  type Props = {
    view: SidebarView;
    /** 四个面板各自的开关（视图 → 侧边栏 的勾选项）：关闭的面板不出现、也不渲染 */
    panels: Record<SidebarView, boolean>;
    /** 目录树根目录（跟随当前文档所在文件夹，也可手动选择） */
    root: string | null;
    currentPath: string | null;
    outline: OutlineItem[];
    fileProps: [string, string][];
    /** 当前是代码文件：大纲模板不适用，提示语要换成「代码文件无大纲」 */
    codeFile?: boolean;
    /** 跨文件搜索：按文件分组的命中、进行中/错误状态与统计（由应用层持有并传入） */
    searchGroups?: SearchGroup[];
    searchBusy?: boolean;
    searchError?: string;
    /** 实际扫描的文件数 */
    searchFiles?: number;
    /** 命中是否因达到上限被截断 */
    searchTruncated?: boolean;
    onView: (view: SidebarView) => void;
    onClose: () => void;
    onOpenFile: (path: string) => void;
    onPickRoot: () => void;
    onGotoHeading: (index: number) => void;
    /** 发起跨文件搜索（查询词 + 是否区分大小写 + 是否按正则解释） */
    onSearch?: (query: string, caseSensitive: boolean, regex: boolean) => void;
    /** 点击某条命中：打开对应文件并定位 */
    onOpenHit?: (hit: SearchHit) => void;
    /** 界面翻译函数（以英文原文为键）；未传入时原样返回，便于单独渲染 / 测试 */
    t?: (key: string, vars?: Record<string, string | number>) => string;
    /** 云端视图：WebDAV 连接参数（null = 尚未配置） */
    dav?: DavConfig | null;
    /** 文档内书签清单（label = 序号/行号，detail = 片段文本），点击跳转、可单条删除；由应用层持有 */
    bookmarks?: { label: string; detail?: string; onClick: () => void; onRemove?: () => void }[];
    /** 在光标处（无光标则本页最上方起始位置）添加一条书签 */
    onAddBookmark?: () => void;
    /** 当前文档是否支持书签（HTML / 大文档阅读通路为 false） */
    bookmarksAllowed?: boolean;
    /** 打开云端文件（远端路径 + 正文），由应用层落成标签页并绑定远端路径 */
    onOpenCloud?: (remote: string, content: string) => void;
  };

  let {
    view,
    panels,
    root,
    currentPath,
    outline,
    fileProps,
    codeFile = false,
    searchGroups = [],
    searchBusy = false,
    searchError = "",
    searchFiles = 0,
    searchTruncated = false,
    onView,
    onClose,
    onOpenFile,
    onPickRoot,
    onGotoHeading,
    onSearch = () => {},
    onOpenHit = () => {},
    t = (s: string) => s,
    dav = null,
    bookmarks = [],
    onAddBookmark,
    bookmarksAllowed = false,
    onOpenCloud = () => {},
  }: Props = $props();

  // ---- 跨文件搜索的本地输入状态（结果本身由应用层持有） ----
  let query = $state("");
  let caseSensitive = $state(false);
  let regexMode = $state(false); // 按正则解释查询词（粗筛在后端，二次匹配在前端）
  let debounce = 0;

  // 本组件是条件渲染的（关掉侧栏即销毁）：挂起的防抖定时器必须随组件一起撤掉，
  // 否则关闭侧栏后它仍会触发一次 onSearch，对已不可见的输入跑一遍整目录扫描
  onDestroy(() => {
    if (debounce !== 0) clearTimeout(debounce);
    debounce = 0;
  });

  /** 输入防抖：停顿后再发起遍历，避免逐字触发整目录扫描 */
  function scheduleSearch(): void {
    if (debounce !== 0) clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      debounce = 0;
      onSearch(query.trim(), caseSensitive, regexMode);
    }, 250);
  }

  /** 立即搜索（回车、切换大小写 / 正则时） */
  function runSearchNow(): void {
    if (debounce !== 0) {
      clearTimeout(debounce);
      debounce = 0;
    }
    onSearch(query.trim(), caseSensitive, regexMode);
  }

  /** 命中行的高亮切片：正则模式按正则切，否则按字面量切 */
  function segmentsFor(text: string): TextSegment[] {
    return regexMode
      ? highlightRegexSegments(text, query, caseSensitive)
      : highlightSegments(text, query, caseSensitive);
  }

  /** 已展示的命中总数（用于统计行） */
  const totalHits = $derived(searchGroups.reduce((n, g) => n + g.hits.length, 0));

  /** 路径末段文件名（结果分组标题用） */
  function baseName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  }

  // ---- 目录树状态：已加载的子项缓存 + 展开集合（均重新赋值以触发响应） ----
  let cache = $state<Record<string, DirEntry[]>>({});
  let expanded = $state<string[]>([]);
  let loading = $state<string[]>([]);
  let treeError = $state("");

  // 根切换的世代号：根一变就自增，旧根在途的请求返回时据此作废，避免竞态写入新根缓存
  let generation = 0;

  async function load(dir: string): Promise<void> {
    if (cache[dir] || loading.includes(dir)) return;
    const myGen = generation;
    loading = [...loading, dir];
    try {
      const entries = await listDir(dir);
      if (myGen !== generation) return; // 根已切换，本次结果作废
      cache = { ...cache, [dir]: entries };
      treeError = "";
    } catch (e) {
      if (myGen !== generation) return;
      treeError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = loading.filter((d) => d !== dir);
    }
  }

  function toggleDir(dir: string): void {
    if (expanded.includes(dir)) {
      expanded = expanded.filter((d) => d !== dir);
      return;
    }
    expanded = [...expanded, dir];
    void load(dir);
  }

  function activate(entry: DirEntry): void {
    if (entry.isDir) toggleDir(entry.path);
    else onOpenFile(entry.path);
  }

  // 根目录变化（打开/另存文档、手动选目录）时清空缓存重新加载。
  // untrack：cache/loading 的读取只是加载前的判重，若被当作依赖会导致
  // 「加载完成 → 写入缓存 → 效应重跑 → 清空缓存」的死循环。
  $effect(() => {
    const current = root;
    untrack(() => {
      generation += 1; // 旧根在途请求作废
      cache = {};
      expanded = [];
      treeError = "";
      if (current) {
        expanded = [current];
        void load(current);
      }
    });
  });

  function rootName(): string {
    return root ? (root.split(/[\\/]/).filter(Boolean).pop() ?? root) : "";
  }
</script>

{#snippet nodes(entries: DirEntry[], depth: number)}
  {#each entries as entry (entry.path)}
    <div
      class="node"
      class:current={entry.path === currentPath}
      class:dir={entry.isDir}
      style="padding-left: {0.5 + depth * 0.7}rem"
      title={`${entry.path}\n${entry.isDir ? t("Click to expand / collapse") : t("Click to open in editor")}`}
      role="button"
      tabindex="0"
      onclick={() => activate(entry)}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate(entry);
        }
      }}
    >
      <span class="icon">{entry.isDir ? (expanded.includes(entry.path) ? "▾" : "▸") : "·"}</span>
      <span class="name">{entry.name}</span>
    </div>
    {#if entry.isDir && expanded.includes(entry.path)}
      {#if cache[entry.path]}
        {@render nodes(cache[entry.path]!, depth + 1)}
      {:else}
        <div class="hint" style="padding-left: {0.5 + (depth + 1) * 0.7}rem">{t("Loading…")}</div>
      {/if}
    {/if}
  {/each}
{/snippet}

<aside class="sidebar">
  <div class="side-head">
    <div class="tabs">
      {#if panels.tree}
        <button class:active={view === "tree"} onclick={() => onView("tree")} title={t("Browse files by folder")}>{t("File")}</button>
      {/if}
      <!-- 大纲：纯文本 / 代码文件没有标题大纲，与「视图 → 侧边栏」的置灰一致，此处不出现 -->
      {#if panels.outline && !codeFile}
        <button class:active={view === "outline"} onclick={() => onView("outline")} title={t("Jump by heading level")}>{t("Outline")}</button>
      {/if}
      {#if panels.bookmarks}
        <button class:active={view === "bookmarks"} onclick={() => onView("bookmarks")} title={t("Jump to bookmarks in the current document")}>{t("Bookmarks")}</button>
      {/if}
      {#if panels.props}
        <button class:active={view === "props"} onclick={() => onView("props")} title={t("Current file properties")}>{t("Properties")}</button>
      {/if}
      {#if panels.search}
        <button class:active={view === "search"} onclick={() => onView("search")} title={t("Full-text search in the current folder")}>{t("Search")}</button>
      {/if}
      {#if panels.cloud}
        <button class:active={view === "cloud"} onclick={() => onView("cloud")} title={t("Browse and edit cloud (WebDAV) files")}>{t("Cloud")}</button>
      {/if}
    </div>
    <button class="close" onclick={onClose} title={t("Close sidebar (Ctrl+Shift+L)")}>✕</button>
  </div>

  <div class="side-body">
    {#if view === "tree" && panels.tree}
      <div class="tree-head">
        <span class="tree-root" title={root ?? t("No folder selected yet")}>{root ? rootName() : t("No folder selected")}</span>
        <button onclick={onPickRoot} title={t("Choose Folder")}>{t("Choose…")}</button>
      </div>

      {#if treeError}
        <div class="hint error">{treeError}</div>
      {/if}

      {#if root === null}
        <div class="hint">{t("With no document open, click “Choose…” to pick a folder as the tree root.")}</div>
      {:else if !cache[root]}
        <div class="hint">{t("Loading…")}</div>
      {:else if cache[root]!.length === 0}
        <div class="hint">{t("This folder is empty")}</div>
      {:else}
        {@render nodes(cache[root]!, 0)}
      {/if}
    {:else if view === "outline" && panels.outline}
      {#if outline.length === 0}
        <div class="hint">
          {codeFile
            ? t("Code files have no heading outline (use the editor for highlighting and folding)")
            : t("This document has no headings (headings set with # or the underline style will appear here)")}
        </div>
      {:else}
        {#each outline as item, i (i)}
          <button
            class="outline-item"
            style="padding-left: {0.5 + (item.level - 1) * 0.7}rem"
            onclick={() => onGotoHeading(i)}
            title={item.text}
          >
            <span class="lv">H{item.level}</span>
            <span class="name">{item.text}</span>
          </button>
        {/each}
      {/if}
    {:else if view === "props" && panels.props}
      <dl class="props">
        {#each fileProps as [label, value] (label)}
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        {/each}
      </dl>
    {:else if view === "search" && panels.search}
      <!-- 跨文件搜索：输入 + 结果（按文件分组，点击命中打开并定位） -->
      {#if root === null}
        <div class="hint">{t("No folder selected. Switch to the “Files” tab, click “Choose…” to pick a folder, then come back here to search.")}</div>
      {:else}
        <div class="search-head">
          <input
            class="search-input"
            type="search"
            placeholder={t("Search in the current folder…")}
            value={query}
            oninput={(e) => {
              query = e.currentTarget.value;
              scheduleSearch();
            }}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearchNow();
              }
            }}
          />
          <label class="search-case" title={t("Match Case")}>
            <input
              type="checkbox"
              checked={caseSensitive}
              onchange={() => {
                caseSensitive = !caseSensitive;
                runSearchNow();
              }}
            />
            Aa
          </label>
          <label class="search-case" title={t("Regular Expression")}>
            <input
              type="checkbox"
              checked={regexMode}
              onchange={() => {
                regexMode = !regexMode;
                runSearchNow();
              }}
            />
            .*
          </label>
        </div>

        {#if searchError}
          <div class="hint error">{searchError}</div>
        {:else if searchBusy}
          <div class="hint">{t("Searching…")}</div>
        {:else if query.trim() === ""}
          <div class="hint">{t("Type a keyword to start searching (case sensitivity and regex can be toggled).")}</div>
        {:else if totalHits === 0}
          <div class="hint">{t("No matches found")}</div>
        {:else}
          <div class="hint">
            {t("Found {n} match(es) in {files} file(s)", { files: searchFiles, n: totalHits })}{#if searchTruncated}{t("(Results truncated — narrow the scope)")}{/if}
          </div>
          {#each searchGroups as group (group.path)}
            <div class="sgroup">
              <div class="sgroup-head" title={group.path}>
                <span class="sgroup-name">{baseName(group.path)}</span>
                <span class="sgroup-path">{group.path}</span>
              </div>
              {#each group.hits as hit (hit.line + ":" + hit.column)}
                <button class="shit" onclick={() => onOpenHit(hit)} title={`${group.path}:${hit.line}`}>
                  <span class="shit-ln">{hit.line}</span>
                  <span class="shit-text">
                    {#each segmentsFor(hit.text) as seg, si (si)}
                      {#if seg.hit}<mark>{seg.text}</mark>{:else}{seg.text}{/if}
                    {/each}
                  </span>
                </button>
              {/each}
              {#if group.truncated}
                <div class="hint">{t("(Too many matches in this file; only the first few are shown)")}</div>
              {/if}
            </div>
          {/each}
        {/if}
      {/if}
    {:else if view === "cloud" && panels.cloud}
      <CloudTree dav={dav} onOpen={onOpenCloud} {t} />
    {:else if view === "bookmarks" && panels.bookmarks}
      <BookmarksPanel items={bookmarks} onAdd={onAddBookmark} canAdd={bookmarksAllowed} {t} />
    {/if}
  </div>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: 240px;
    flex-shrink: 0;
    min-height: 0;
    background: var(--sidebar-bg, #fafafa);
    border-right: 1px solid var(--border, #ddd);
    user-select: none;
    font-size: 0.8125rem;
  }

  .side-head {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.35rem;
    border-bottom: 1px solid var(--border, #ddd);
    flex-shrink: 0;
  }

  .tabs {
    display: flex;
    gap: 0.15rem;
    flex: 1;
    min-width: 0;
  }

  .tabs button {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .tabs button:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .tabs button.active {
    background: var(--hover, rgba(0, 0, 0, 0.1));
    font-weight: 600;
  }

  .close {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.4rem;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
    flex-shrink: 0;
  }

  .close:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
    opacity: 1;
  }

  .side-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.3rem 0;
  }

  /* ---- 目录树 ---- */
  .tree-head {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.5rem 0.35rem;
    border-bottom: 1px solid var(--border, #ddd);
    margin-bottom: 0.3rem;
  }

  .tree-root {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    opacity: 0.8;
  }

  .tree-head button {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    flex-shrink: 0;
  }

  .tree-head button:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .node {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding-top: 0.15rem;
    padding-bottom: 0.15rem;
    padding-right: 0.4rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .node:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .node.current {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    font-weight: 600;
  }

  .node .icon {
    flex: 0 0 0.8rem;
    text-align: center;
    opacity: 0.75;
  }

  .node .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ---- 大纲 ---- */
  .outline-item {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.2rem 0.4rem 0.2rem 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .outline-item:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .outline-item .lv {
    flex: 0 0 auto;
    font-size: 0.6875rem;
    opacity: 0.55;
  }

  .outline-item .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- 文件属性 ---- */
  .props {
    margin: 0;
    padding: 0 0.6rem;
  }

  .props dt {
    font-size: 0.75rem;
    opacity: 0.6;
    margin-top: 0.5rem;
  }

  .props dd {
    margin: 0.1rem 0 0;
    word-break: break-all;
  }

  /* ---- 跨文件搜索 ---- */
  .search-head {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.5rem 0.35rem;
    border-bottom: 1px solid var(--border, #ddd);
    margin-bottom: 0.3rem;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.2rem 0.35rem;
    color: inherit;
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    outline: none;
  }

  .search-case {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    font-size: 0.7rem;
    flex-shrink: 0;
    opacity: 0.8;
    cursor: pointer;
  }

  .sgroup {
    margin-bottom: 0.4rem;
  }

  .sgroup-head {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    padding: 0.2rem 0.5rem;
    font-size: 0.75rem;
  }

  .sgroup-name {
    font-weight: 600;
    flex-shrink: 0;
  }

  .sgroup-path {
    flex: 1;
    min-width: 0;
    font-size: 0.6875rem;
    opacity: 0.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shit {
    display: flex;
    gap: 0.4rem;
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .shit:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .shit-ln {
    flex: 0 0 2.2rem;
    text-align: right;
    opacity: 0.5;
  }

  .shit-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shit-text mark {
    background: color-mix(in srgb, var(--accent) 30%, transparent);
    color: inherit;
    border-radius: 2px;
  }

  .hint {
    padding: 0.4rem 0.6rem;
    font-size: 0.75rem;
    opacity: 0.65;
    line-height: 1.5;
  }

  .hint.error {
    color: var(--danger, #c0392b);
    opacity: 1;
  }
</style>
