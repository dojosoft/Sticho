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
    wordCount: number;
    charCount: number;
    lineCount: number;
    currentPath: string | null;
    dirty: boolean;

    docKind: "markdown" | "html" | "code";

    /** Markdown 渲染模式（IR / 所见即所得 / 分屏预览）：状态栏以图标呈现并可点击切换 */
    editorMode: "ir" | "wysiwyg" | "sv";
    onSetEditorMode: (mode: "ir" | "wysiwyg" | "sv") => void;

    /** 阅读（只读）/ 编辑模式：状态栏分段开关（本轮从右上角移入） */
    browseMode: boolean;
    onSetBrowseMode: (read: boolean) => void;

    /** HTML 文档：预览 / 源码切换 */
    htmlView: "preview" | "source";
    onSetHtmlView: (view: "preview" | "source") => void;
    htmlScripts: boolean;
    onToggleHtmlScripts: () => void;

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

    /** 编码：当前 id、下拉展开状态（双向绑定）、手动切换 / 重新检测 */
    encoding: string;
    encodingOpen?: boolean;
    onApplyEncoding: (id: string | null) => void;

    /** 云同步状态指示（未启用时整块不显示） */
    davEnabled: boolean;
    davSyncState: "idle" | "busy" | "error";
    davSyncTip: string;
  }

  let {
    locale,
    wordCount,
    charCount,
    lineCount,
    currentPath,
    dirty,
    docKind,
    editorMode,
    onSetEditorMode,
    browseMode,
    onSetBrowseMode,
    htmlView,
    onSetHtmlView,
    htmlScripts,
    onToggleHtmlScripts,
    codeLargeText,
    codeLangLabel,
    codeCursor,
    codeMatch,
    codeLangOverride,
    onSetCodeLang,
    codeLangOpen = $bindable(false),
    typewriterOn,
    paragraphFocus,
    encoding,
    encodingOpen = $bindable(false),
    onApplyEncoding,
    davEnabled,
    davSyncState,
    davSyncTip,
  }: Props = $props();

  const t = $derived(makeT(locale));
</script>

<footer class="statusbar">
  <!-- 实时统计（批次七）：随输入 400ms 防抖刷新，口径与侧栏「文件属性」一致 -->
  <span class="count">{t("{w} 字 · {c} 字符 · {l} 行", { w: wordCount.toLocaleString(), c: charCount.toLocaleString(), l: lineCount.toLocaleString() })}</span>
  <!-- 当前文档模式：纯文本 / Markdown / HTML（与「视图 → 模式」三选一致） -->
  <span class="mode-chip" title={t("当前文档模式")}>
    {docKind === "markdown" ? t("Markdown 模式") : docKind === "html" ? t("HTML 模式") : t("纯文本模式")}
  </span>
  <!-- 占位撑开：把右侧控件推到状态栏右端（原先由已移除的路径文本承担） -->
  <span class="spacer"></span>

  <!-- HTML 文档模式：预览 / 源码切换 + 是否执行脚本。
       预览的可编辑性不再单设按钮——它就是「阅读 / 编辑模式」在 HTML 文档上的表现（见 previewEditable） -->
  {#if docKind === "html"}
    <span class="html-switch">
      <button class:active={htmlView === "preview"} onclick={() => onSetHtmlView("preview")}>{t("预览")}</button>
      <button class:active={htmlView === "source"} onclick={() => onSetHtmlView("source")}>{t("源码")}</button>
    </span>
    <button
      class="html-edit"
      class:active={htmlScripts}
      onclick={onToggleHtmlScripts}
      title={t("执行文档内的 JavaScript。开启后预览的沙箱会降级为独立源，直接编辑、查找替换、大纲定位将不可用（这是防止文档脚本反向操作本应用的安全底线）")}
    >
      {htmlScripts ? t("禁用脚本") : t("执行脚本")}
    </button>
  {/if}

  <!-- 代码文件：光标行列 / 分节只读提示（由 CodeMirror 的 updateListener 上报） -->
  {#if docKind === "code"}
    <span class="code-info">
      {#if codeLargeText !== null}
        <!-- 超大代码文件走只读分节纯文本：没有语言下拉按钮，语言名在这里显示一次 -->
        {codeLangLabel} · {t("分节只读视图")}
      {:else}
        <!-- 普通代码文件：语言名已由右侧「语法高亮方案」下拉显示，这里不再重复，只报位置 -->
        {t("行 {r}，列 {c}", { r: codeCursor.line, c: codeCursor.column })}{codeMatch >= 2
          ? ` · ${t("{n} 处匹配", { n: codeMatch })}`
          : ""}{browseMode ? t("（只读）") : ""}
      {/if}
    </span>

    <!-- 语法高亮方案切换（本轮新增）：与编码切换同构，仅普通代码文件可用（超大文件无高亮） -->
    {#if codeLargeText === null}
      <span class="lang-wrap">
        <button
          class="encoding"
          onclick={(e) => {
            e.stopPropagation();
            codeLangOpen = !codeLangOpen;
          }}
          title={t("语法高亮方案：默认按扩展名自动判定，可手动指定")}
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
              <span class="label">{t("自动（按扩展名）")}</span>
            </button>
            <button
              class="enc-item"
              onclick={() => {
                onSetCodeLang(null);
                codeLangOpen = false;
              }}
            >
              <span class="mark">{codeLangOverride === null ? "✓" : ""}</span>
              <span class="label">{t("纯文本")}</span>
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
  {/if}

  <!-- 打字机模式 / 段落聚焦：仅 Markdown / 纯文本下有意义（HTML 文档光标在 iframe 里，做不到） -->
  {#if typewriterOn && docKind !== "html"}
    <span class="mode-chip" title={t("打字机模式：当前行始终保持在屏幕垂直中央")}>{t("打字机模式")}</span>
  {/if}
  {#if paragraphFocus && docKind !== "html"}
    <span class="mode-chip" title={t("段落聚焦：仅高亮当前段落，其余内容淡出")}>{t("段落聚焦")}</span>
  {/if}

  <!-- 编码（阶段 11）：显示当前编码，点击可手动切换或重新自动检测 -->
  <span class="encoding-wrap">
    <button
      class="encoding"
      onclick={(e) => {
        e.stopPropagation();
        encodingOpen = !encodingOpen;
      }}
      title={t("文件编码：打开时自动检测，可手动切换")}
    >{encodingLabel(encoding)} ▾</button>
    {#if encodingOpen}
      <div class="encoding-pop">
        <button class="enc-item" onclick={() => onApplyEncoding(null)}>
          <span class="mark"></span>
          <span class="label">{t("自动检测（重新读取文件）")}</span>
        </button>
        <div class="menu-sep"></div>
        {#each ENCODINGS as enc (enc.id)}
          <button class="enc-item" onclick={() => onApplyEncoding(enc.id)}>
            <span class="mark">{encoding === enc.id ? "✓" : ""}</span>
            <span class="label">{enc.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </span>

  <!-- Markdown 渲染模式（IR / 所见即所得 / 分屏预览）：仅 Markdown 模式下出现，图标点击即切换 -->
  {#if docKind === "markdown"}
    <span class="render-switch" title={t("渲染模式")}>
      <button
        class:active={editorMode === "ir"}
        title={t("即时渲染（IR）")}
        aria-label={t("即时渲染（IR）")}
        onclick={() => onSetEditorMode("ir")}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
          <path d="M14.5 6.5l3 3" />
        </svg>
      </button>
      <button
        class:active={editorMode === "wysiwyg"}
        title={t("所见即所得（WYSIWYG）")}
        aria-label={t("所见即所得（WYSIWYG）")}
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
        title={t("分屏预览（SV）")}
        aria-label={t("分屏预览（SV）")}
        onclick={() => onSetEditorMode("sv")}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M12 4v16" />
        </svg>
      </button>
    </span>
  {/if}

  <!-- 阅读 / 编辑模式切换：放在编码切换右侧；阅读态只读，编辑态高亮 -->
  <span
    class="mode-switch"
    title={browseMode ? t("当前为阅读模式，文档只读。点击切换到编辑模式（Ctrl+E）") : t("当前为编辑模式，可以修改文档。点击回到阅读模式（Ctrl+E）")}
  >
    <button class:active={browseMode} onclick={() => onSetBrowseMode(true)}>{t("阅读")}</button>
    <button class:active={!browseMode} onclick={() => onSetBrowseMode(false)}>{t("编辑")}</button>
  </span>

  {#if davEnabled}
    <span
      class="cloud-state"
      class:busy={davSyncState === "busy"}
      class:error={davSyncState === "error"}
      title={davSyncTip || t("已同步")}
    >
      ☁ {davSyncState === "busy" ? t("同步中…") : davSyncState === "error" ? t("同步失败") : t("已同步")}
    </span>
  {/if}

  <span class="state">{dirty ? t("未保存") : currentPath ? t("已保存") : t("新建文档")}</span>
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

  /* ---- 状态栏下拉（编码 / 语法高亮方案）---- */
  .encoding-wrap,
  .lang-wrap {
    position: relative;
    flex-shrink: 0;
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

  .render-switch button.active {
    background: var(--hover, rgba(0, 0, 0, 0.07));
    opacity: 1;
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

  .html-switch button.active,
  .mode-switch button.active {
    background: var(--hover, rgba(0, 0, 0, 0.07));
    opacity: 1;
    font-weight: 600;
  }

  /* 打字机模式 / 段落聚焦的状态提示（开启时才出现） */
  .mode-chip {
    flex-shrink: 0;
    white-space: nowrap;
    padding: 0.05rem 0.45rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 999px;
    opacity: 0.85;
  }

  /* 状态栏「执行脚本」开关（仅 HTML 文档出现）。原「直接编辑」按钮已并入阅读 / 编辑模式 */
  .html-edit {
    flex-shrink: 0;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.05rem 0.5rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }

  .html-edit:hover {
    opacity: 1;
  }

  .html-edit:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .html-edit.active {
    background: var(--accent, #2563eb);
    border-color: var(--accent, #2563eb);
    color: #fff;
    opacity: 1;
    font-weight: 600;
  }

  .code-info {
    flex-shrink: 0;
    opacity: 0.8;
    white-space: nowrap;
  }
</style>