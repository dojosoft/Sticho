<script lang="ts">
  /**
   * 底部状态栏：实时统计、阅读/编辑模式开关、各文档模式专属控件（HTML 预览/源码/脚本、
   * 代码语言与光标、语法高亮方案）、编码切换、云同步指示、保存状态。
   *
   * 与 App.svelte 的分工：这里只做「显示 + 触发回调」，不判断任何业务分支。
   * `encodingOpen` / `codeLangOpen` 用双向绑定保留在父级：两个下拉既会被应用层的动作
   * 关闭，也会被窗口空白处点击（onWindowClick）关闭，两处都需要能改动它们。
   *
   * 样式自带的类名与 App.svelte 里的用法一致（`.statusbar` / `.encoding*` / `.enc-item`
   * / `.html-switch` / `.html-edit` / `.code-info`），按 Svelte 的组件作用域一并搬来。
   */
  import { makeT, type Locale } from "../lib/i18n";
  import { ENCODINGS, encodingLabel } from "../lib/encoding";
  import { LANG_LIST } from "../lib/codeLang";

  interface Props {
    locale: Locale;
    /** 语言包合并词表（内置 + locales/ 下的语言包）：由 App 注入，缺省时回落内置词表 */
    i18nEntries?: Record<string, string>;
    wordCount: number;
    charCount: number;
    lineCount: number;
    currentPath: string | null;
    /** 绑定的云端（WebDAV）远端路径：云端文档没有本地路径，状态栏据此才判得出「已保存」 */
    currentRemote: string | null;
    dirty: boolean;

    docKind: "markdown" | "html" | "code";

    /** 文档模式切换（状态栏最左侧）：Markdown / HTML / 纯文本 */
    onSetDocKind: (kind: "markdown" | "html" | "code") => void;
    modeOpen?: boolean;

    /** Markdown 渲染模式（IR / 所见即所得 / 分屏预览 / 不渲染）：状态栏以图标呈现并可点击切换 */
    editorMode: "ir" | "wysiwyg" | "sv" | "none";
    onSetEditorMode: (mode: "ir" | "wysiwyg" | "sv" | "none") => void;

    /** 阅读（只读）/ 编辑模式：状态栏分段开关（本轮从右上角移入） */
    browseMode: boolean;
    onSetBrowseMode: (read: boolean) => void;

    /** HTML 文档：预览 / 源码切换 */
    htmlView: "preview" | "source";
    onSetHtmlView: (view: "preview" | "source") => void;
    /** HTML 源码视图因行数过多而没画行号叠层：这里说明一句，免得用户以为行号开关坏了 */
    htmlGutterCapped: boolean;

    /** 代码文件：语言名 + 光标行列 + 匹配数；超大文件走只读分节视图 */
    codeLargeText: string | null;
    codeLangLabel: string;
    codeCursor: { line: number; column: number };
    codeMatch: number;

    /** 代码文件：语法高亮方案（undefined = 自动按扩展名，null = 纯文本，字符串 = 语言 id） */
    codeLangOverride: string | null | undefined;
    onSetCodeLang: (id: string | null | undefined) => void;
    codeLangOpen?: boolean;

    /** 打字机模式 / 段落聚焦：处于开启状态时在状态栏做提示（HTML 文档下不适用） */
    typewriterOn: boolean;
    paragraphFocus: boolean;

    /** 打字机 / 段落聚焦：状态栏图标按钮点击开关 */
    onToggleTypewriter: () => void;
    onToggleParagraphFocus: () => void;

    /** 编码：当前 id、下拉展开状态（双向绑定）、手动切换 / 重新检测 */
    encoding: string;
    encodingOpen?: boolean;
    onApplyEncoding: (id: string | null) => void;

    /** 云同步状态指示（未启用时整块不显示） */
    davEnabled: boolean;
    davSyncState: "idle" | "busy" | "error";
    davSyncTip: string;

    /** 云端变更预警（跨设备冲突提示）：0 时不显示；点击重新打开对比提示 */
    cloudUpdateCount: number;
    cloudUpdateTip: string;
    onOpenCloudUpdates: () => void;
  }

  let {
    locale,
    i18nEntries,
    wordCount,
    charCount,
    lineCount,
    currentPath,
    currentRemote,
    dirty,
    docKind,
    onSetDocKind,
    modeOpen = $bindable(false),
    editorMode,
    onSetEditorMode,
    browseMode,
    onSetBrowseMode,
    htmlView,
    onSetHtmlView,
    htmlGutterCapped,
    codeLargeText,
    codeLangLabel,
    codeCursor,
    codeMatch,
    codeLangOverride,
    onSetCodeLang,
    codeLangOpen = $bindable(false),
    typewriterOn,
    paragraphFocus,
    onToggleTypewriter,
    onToggleParagraphFocus,
    encoding,
    encodingOpen = $bindable(false),
    onApplyEncoding,
    davEnabled,
    davSyncState,
    davSyncTip,
    cloudUpdateCount,
    cloudUpdateTip,
    onOpenCloudUpdates,
  }: Props = $props();

  const t = $derived(makeT(locale, i18nEntries));

  // 统计数字按界面语言分组：toLocaleString() 默认吃浏览器/系统 locale，会和界面语言不一致
  const numberFormat = $derived.by(() => {
    try {
      return new Intl.NumberFormat(locale);
    } catch {
      return new Intl.NumberFormat("en-US");
    }
  });
  const fmt = (n: number): string => numberFormat.format(n);

  // 下拉里的编码项：常表 + 当前编码。自动检测可能给出常表之外的编码
  // （windows-1251 / euc-jp / ISO-8859-x 等），必须让它也能出现在列表里，
  // 否则用户既看不到选中态、也没法把编码改回这一项。
  const encodingOptions = $derived(
    ENCODINGS.some((e) => e.id === encoding)
      ? ENCODINGS
      : [...ENCODINGS, { id: encoding, label: encoding }],
  );
</script>

<footer class="statusbar">
  <!-- 当前文档模式（Markdown / HTML / 纯文本）：固定最左，点击展开选择直接切换 -->
  <span class="mode-wrap">
    <button
      class="mode-chip"
      title={t("Click to switch document mode")}
      onclick={(e) => {
        e.stopPropagation();
        modeOpen = !modeOpen;
      }}
    >{docKind === "markdown" ? t("Markdown") : docKind === "html" ? t("HTML") : t("Plain Text")} ▾</button>
    {#if modeOpen}
      <div class="encoding-pop">
        <button class="enc-item" onclick={() => { onSetDocKind("markdown"); modeOpen = false; }}>
          <span class="mark">{docKind === "markdown" ? "✓" : ""}</span>
          <span class="label">{t("Markdown")}</span>
        </button>
        <button class="enc-item" onclick={() => { onSetDocKind("html"); modeOpen = false; }}>
          <span class="mark">{docKind === "html" ? "✓" : ""}</span>
          <span class="label">{t("HTML")}</span>
        </button>
        <button class="enc-item" onclick={() => { onSetDocKind("code"); modeOpen = false; }}>
          <span class="mark">{docKind === "code" ? "✓" : ""}</span>
          <span class="label">{t("Plain Text")}</span>
        </button>
      </div>
    {/if}
  </span>
  <!-- 编码（阶段 11）：显示当前编码，点击可手动切换或重新自动检测。
       位置紧随最左侧的文档模式按钮之后（本轮从右端移来），面板相应改为向左展开 -->
  <span class="encoding-wrap">
    <button
      class="encoding"
      onclick={(e) => {
        e.stopPropagation();
        encodingOpen = !encodingOpen;
      }}
      title={t("File encoding: auto-detected on open; can be switched manually")}
    >{t(encodingLabel(encoding))} ▾</button>
    {#if encodingOpen}
      <div class="encoding-pop">
        <button class="enc-item" onclick={() => onApplyEncoding(null)}>
          <span class="mark"></span>
          <span class="label">{t("Auto-detect (re-read file)")}</span>
        </button>
        <div class="menu-sep"></div>
        {#each encodingOptions as enc (enc.id)}
          <button class="enc-item" onclick={() => onApplyEncoding(enc.id)}>
            <span class="mark">{encoding === enc.id ? "✓" : ""}</span>
            <span class="label">{t(enc.label)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </span>
  <!-- 语法高亮方案切换：紧随编码切换右侧（本轮从右端移来），仅纯文本（代码）模式下出现；
       超大文件的只读分节视图没有高亮，故不显示 -->
  {#if docKind === "code" && codeLargeText === null}
    <span class="lang-wrap">
      <button
        class="encoding"
        onclick={(e) => {
          e.stopPropagation();
          codeLangOpen = !codeLangOpen;
        }}
        title={t("Syntax highlighting scheme: auto-detected by extension by default; can be set manually")}
      >{codeLangLabel} ▾</button>
      {#if codeLangOpen}
        <div class="encoding-pop">
          <button
            class="enc-item"
            onclick={() => {
              onSetCodeLang(undefined);
              codeLangOpen = false;
            }}
          >
            <span class="mark">{codeLangOverride === undefined ? "✓" : ""}</span>
            <span class="label">{t("Auto (by Extension)")}</span>
          </button>
          <button
            class="enc-item"
            onclick={() => {
              onSetCodeLang(null);
              codeLangOpen = false;
            }}
          >
            <span class="mark">{codeLangOverride === null ? "✓" : ""}</span>
            <span class="label">{t("Plain Text")}</span>
          </button>
          <div class="menu-sep"></div>
          {#each LANG_LIST as lang (lang.id)}
            <button
              class="enc-item"
              onclick={() => {
                onSetCodeLang(lang.id);
                codeLangOpen = false;
              }}
            >
              <span class="mark">{codeLangOverride === lang.id ? "✓" : ""}</span>
              <span class="label">{lang.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    </span>
  {/if}
  <!-- 实时统计（批次七）：随输入 400ms 防抖刷新，口径与侧栏「文件属性」一致 -->
  <span class="count">{t("{w} words · {c} characters · {l} lines", { w: fmt(wordCount), c: fmt(charCount), l: fmt(lineCount) })}</span>
  <!-- 占位撑开：把右侧控件推到状态栏右端（原先由已移除的路径文本承担） -->
  <span class="spacer"></span>

  <!-- HTML 文档模式：预览 / 源码切换。
       「执行脚本」的开关已从状态栏移除（改由视图菜单控制）；
       预览的可编辑性不再单设按钮——它就是「阅读 / 编辑模式」在 HTML 文档上的表现（见 previewEditable） -->
  {#if docKind === "html"}
    <span class="html-switch">
      <button class:active={htmlView === "preview"} onclick={() => onSetHtmlView("preview")}>{t("Preview")}</button>
      <button class:active={htmlView === "source"} onclick={() => onSetHtmlView("source")}>{t("Source")}</button>
    </span>
    {#if htmlGutterCapped}
      <span class="count" data-tip={t("Line numbers are drawn line by line to follow the source wrapping. A page with tens of thousands of lines would make switching views freeze, so the gutter is skipped above 5000 lines.")}>{t("Line numbers hidden for the long source")}</span>
    {/if}
  {/if}

  <!-- 代码文件：光标行列 / 分节只读提示（由 CodeMirror 的 updateListener 上报） -->
  {#if docKind === "code"}
    <span class="code-info">
      {#if codeLargeText !== null}
        <!-- 超大代码文件走只读分节纯文本：没有语言下拉按钮，语言名在这里显示一次 -->
        {codeLangLabel} · {t("Read-only sections")}
      {:else}
        <!-- 普通代码文件：语言名已由左端「语法高亮方案」下拉显示，这里不再重复，只报位置 -->
        {t("Ln {r}, Col {c}", { r: codeCursor.line, c: codeCursor.column })}{codeMatch >= 2
          ? ` · ${t("{n} matches", { n: codeMatch })}`
          : ""}{browseMode ? t(" (read-only)") : ""}
      {/if}
    </span>
  {/if}

  <!-- 打字机模式 / 段落聚焦：图标按钮，点击即开关（HTML 文档下不适用） -->
  {#if docKind !== "html"}
    <span class="render-switch">
      <button
        class:active={typewriterOn}
        title={t("Typewriter Mode")}
        aria-label={t("Typewriter Mode")}
        onclick={onToggleTypewriter}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h16M7 12h10M9.5 17h5" />
        </svg>
      </button>
      <button
        class:active={paragraphFocus}
        title={t("Paragraph Focus")}
        aria-label={t("Paragraph Focus")}
        onclick={onToggleParagraphFocus}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
        </svg>
      </button>
    </span>
  {/if}

  <!-- Markdown 渲染模式（IR / 所见即所得 / 分屏预览）：仅 Markdown 模式下出现，图标点击即切换 -->
  {#if docKind === "markdown"}
    <!-- 渲染模式图标组：提示语只挂在各按钮上（每个按钮自带 title）。外层span 若也给 title，
         它那圈边框与按钮间的留白就成了「渲染模式」的热区——同样属于「不点在按钮上也弹提示」 -->
    <span class="render-switch">
      <button
        class:active={editorMode === "ir"}
        title={t("Instant Rendering (IR)")}
        aria-label={t("Instant Rendering (IR)")}
        onclick={() => onSetEditorMode("ir")}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
          <path d="M14.5 6.5l3 3" />
        </svg>
      </button>
      <button
        class:active={editorMode === "wysiwyg"}
        title={t("WYSIWYG")}
        aria-label={t("WYSIWYG")}
        onclick={() => onSetEditorMode("wysiwyg")}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4" />
          <path d="M9 12h6M9 16h6" />
        </svg>
      </button>
      <button
        class:active={editorMode === "sv"}
        title={t("Split View (SV)")}
        aria-label={t("Split View (SV)")}
        onclick={() => onSetEditorMode("sv")}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M12 4v16" />
        </svg>
      </button>
      <button
        class:active={editorMode === "none"}
        title={t("No Render")}
        aria-label={t("No Render")}
        onclick={() => onSetEditorMode("none")}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      </button>
    </span>
  {/if}

  <!-- 阅读 / 编辑模式切换：放在编码切换右侧；阅读态（只读）红底、编辑态（可改）绿底。
       提示语挂在两个按钮上，不挂外层分段开关：外层那条 title 会把整块（含边框、两个按钮之间
       与四角留白）都变成提示热区，鼠标落在「不是这个按钮」的位置也会弹出同一句话 -->
  <span class="mode-switch">
    <button
      class:active={browseMode}
      class:on-read={browseMode}
      title={t("Switch to Reading Mode (the document becomes read-only, Ctrl+E)")}
      onclick={() => onSetBrowseMode(true)}
    >{t("Read")}</button>
    <button
      class:active={!browseMode}
      class:on-edit={!browseMode}
      title={t("Switch to Edit Mode (the document can be modified, Ctrl+E)")}
      onclick={() => onSetBrowseMode(false)}
    >{t("Edit")}</button>
  </span>

  {#if davEnabled}
    <span
      class="cloud-state"
      class:busy={davSyncState === "busy"}
      class:error={davSyncState === "error"}
      title={davSyncTip || t("Synced")}
    >
      ☁ {davSyncState === "busy" ? t("Syncing…") : davSyncState === "error" ? t("Sync failed") : t("Synced")}
    </span>
  {/if}

  <!-- 云端变更预警：别的设备改过云端副本时一直提示，点击可再打开对比提示 -->
  {#if cloudUpdateCount > 0}
    <button class="cloud-state cloud-update" title={cloudUpdateTip} onclick={onOpenCloudUpdates}>
      ⚠ {t("Cloud versions updated: {n}", { n: cloudUpdateCount })}
    </button>
  {/if}

  <span class="state">{dirty ? t("Unsaved") : currentPath || currentRemote ? t("Saved") : t("New Document")}</span>
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.2rem 0.75rem;
    font-size: 0.75rem;
    background: var(--statusbar-bg, #f5f5f5);
    border-top: 1px solid var(--border, #ddd);
    user-select: none;
    flex-shrink: 0;
  }

  /* 撑开空白：把计数左侧留出、右侧控件推到右端 */
  .statusbar .spacer {
    flex: 1;
    min-width: 0;
  }

  .statusbar .count {
    flex-shrink: 0;
    white-space: nowrap;
  }

  .statusbar .state {
    flex-shrink: 0;
    opacity: 0.85;
  }

  /* 云同步指示（批次九）：仅开启同步时出现；失败亮警示色，详情挂在 title 上 */
  .statusbar .cloud-state {
    flex-shrink: 0;
    white-space: nowrap;
    opacity: 0.85;
  }

  .statusbar .cloud-state.busy {
    opacity: 0.6;
  }

  .statusbar .cloud-state.error {
    color: var(--danger, #c0392b);
    opacity: 1;
  }

  /* 云端变更预警：可点击，弱化底色以区别于普通状态文字 */
  .statusbar .cloud-update {
    padding: 0 0.3rem;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--warning, #b7791f);
    font: inherit;
    cursor: pointer;
    opacity: 1;
  }

  .statusbar .cloud-update:hover {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  /* ---- 状态栏下拉（编码 / 语法高亮方案）---- */
  .encoding-wrap,
  .lang-wrap {
    position: relative;
    flex-shrink: 0;
  }

  /* 语法高亮下拉已移到状态栏左端（编码切换右侧），面板改为向右展开；
     沿用默认的「右对齐向左展开」会顶出窗口左边界。 */
  .lang-wrap .encoding-pop {
    right: auto;
    left: 0;
  }

  .encoding {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .encoding:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .encoding-pop {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 0;
    min-width: 240px;
    padding: 4px;
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
    z-index: 400;
  }

  .enc-item {
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

  .enc-item:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .enc-item .mark {
    flex: 0 0 0.9rem;
    text-align: center;
  }

  .enc-item .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .menu-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--border, #ddd);
  }

  /* 状态栏分段切换：「预览 / 源码」「阅读 / 编辑」共用同一套外观 */
  .html-switch,
  .mode-switch {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    overflow: hidden;
  }

  /* Markdown 渲染模式图标组：三个等宽方按钮，选中项高亮 */
  .render-switch {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    overflow: hidden;
  }

  .render-switch button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.12rem 0.35rem;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.65;
  }

  .render-switch button:hover {
    opacity: 1;
  }

  /* 渲染模式 / 打字机 / 段落聚焦的图标按钮：按下时转「深灰底 + 白图标」，并把图标描边加粗一档。
     SVG 的 stroke-width 是表现属性，任何 CSS 规则都能盖过它（故这里直接对 子元素 赋值，
     在 svg 上赋值会被子元素自己的属性挡住）。比原来的淡底色醒目得多。 */
  .render-switch button.active {
    background: var(--render-active-bg, #3f4650);
    color: var(--render-active-fg, #ffffff);
    opacity: 1;
  }

  .render-switch button.active :global(svg path),
  .render-switch button.active :global(svg circle),
  .render-switch button.active :global(svg rect) {
    stroke-width: 2.8;
  }

  .html-switch button,
  .mode-switch button {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.05rem 0.5rem;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }

  .mode-switch button.active {
    background: var(--hover, rgba(0, 0, 0, 0.07));
    opacity: 1;
    font-weight: 600;
  }

  /* 「预览 / 源码」的选中项改用反色（深灰底 + 白字），与右侧渲染模式图标按钮同一套观感：
     原先那条中性淡灰底在状态栏里几乎看不出是按下的（模式切换是最常用的开关，必须一眼可辨）。
     写在上面那条之后，同优先级下由它胜出。 */
  .html-switch button.active {
    background: var(--render-active-bg, #3f4650);
    color: var(--render-active-fg, #ffffff);
    opacity: 1;
    font-weight: 600;
  }

  /* 阅读 / 编辑开关按语义着色：阅读（只读）红底、编辑（可改）绿底。
     写在 .active 之后，同优先级下靠后者胜出，用来覆盖上面那条中性底色。 */
  .mode-switch button.on-read {
    background: var(--danger, #c0392b);
    color: var(--danger-contrast, #ffffff);
  }

  .mode-switch button.on-edit {
    background: var(--edit-accent, #2f9e44);
    color: var(--edit-contrast, #ffffff);
  }

  /* 文档模式按钮（状态栏最左）：与右侧编码下拉同款外观——无可见边框、圆角 5px，
     悬浮才出现底色，不再画独立的圆角矩形边框 */
  .mode-chip {
    flex-shrink: 0;
    white-space: nowrap;
    padding: 0.1rem 0.4rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    opacity: 0.85;
  }

  .mode-chip:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  /* 文档模式下拉（最左）：与编码下拉同构，但面板向左展开以免超出窗口 */
  .mode-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .mode-wrap .encoding-pop {
    left: 0;
    right: auto;
  }

  /* 编码下拉本轮移到最左（紧接文档模式按钮）：与模式下拉一致改为向右展开，
     否则默认的右对齐会让面板从窗口左缘溢出 */
  .encoding-wrap .encoding-pop {
    left: 0;
    right: auto;
  }

  .code-info {
    flex-shrink: 0;
    opacity: 0.8;
    white-space: nowrap;
  }
</style>