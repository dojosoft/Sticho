<script lang="ts">
  /**
   * 底部状态栏：实时统计、路径、各文档模式专属控件（HTML 预览/源码/脚本、代码语言与光标）、
   * 编码切换、云同步指示、保存状态。
   *
   * 与 App.svelte 的分工：这里只做「显示 + 触发回调」，不判断任何业务分支。
   * `encodingOpen` 用双向绑定保留在父级：编码下拉既会被应用层的 `applyEncoding`
   * 关闭，也会被窗口空白处点击（onWindowClick）关闭，两处都需要能改动它。
   *
   * 样式自带的类名与 App.svelte 里的用法一致（`.statusbar` / `.encoding*` / `.enc-item`
   * / `.html-switch` / `.html-edit` / `.code-info`），按 Svelte 的组件作用域一并搬来。
   */
  import { makeT, type Locale } from "../lib/i18n";
  import { ENCODINGS, encodingLabel } from "../lib/encoding";

  interface Props {
    locale: Locale;
    wordCount: number;
    charCount: number;
    lineCount: number;
    currentPath: string | null;
    dirty: boolean;

    docKind: "markdown" | "html" | "code";

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
    browseMode: boolean;

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
    htmlView,
    onSetHtmlView,
    htmlScripts,
    onToggleHtmlScripts,
    codeLargeText,
    codeLangLabel,
    codeCursor,
    codeMatch,
    browseMode,
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
  <span class="path" class:rtl={currentPath !== null} title={currentPath ?? t("尚未保存到磁盘")}>{currentPath ?? t("未保存到磁盘")}</span>

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

  <!-- 代码文件：语言名 + 光标行列（由 CodeMirror 的 updateListener 上报） -->
  {#if docKind === "code"}
    <span class="code-info">
      {#if codeLargeText !== null}
        <!-- 超大代码文件走只读分节纯文本，没有 CM 也就没有光标行列可报 -->
        {codeLangLabel} · {t("分节只读视图")}
      {:else}
        {codeLangLabel} · {t("行 {r}，列 {c}", { r: codeCursor.line, c: codeCursor.column })}{codeMatch >= 2
          ? ` · ${t("{n} 处匹配", { n: codeMatch })}`
          : ""}{browseMode ? t("（只读）") : ""}
      {/if}
    </span>
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

  .statusbar .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.85;
  }

  /* 长路径优先显示尾部（文件名部分）：对 ASCII 路径可靠截断 */
  .statusbar .path.rtl {
    direction: rtl;
    text-align: left;
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

  /* ---- 状态栏编码切换（阶段 11）---- */
  .encoding-wrap {
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

  /* 状态栏「预览 / 源码」分段切换 */
  .html-switch {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    overflow: hidden;
  }

  .html-switch button {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.05rem 0.5rem;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }

  .html-switch button.active {
    background: var(--hover, rgba(0, 0, 0, 0.07));
    opacity: 1;
    font-weight: 600;
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