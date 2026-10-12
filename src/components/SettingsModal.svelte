<script lang="ts">
  /**
   * 软件设置模态面板（左上角齿轮按钮打开）。
   *
   * 与 App.svelte 的分工：面板只负责「渲染 + 触发」，所有设置项的状态与持久化
   * 都留在应用层，通过 props 传入、通过回调传出。标签页 id 用双向绑定保留在父级
   * （Esc 关闭、点遮罩关闭等由父级统一处理）。
   *
   * 样式自带的原因：Svelte 的样式作用域按组件划分，App.svelte 样式块里的
   * 选择器不会落到本组件的元素上，因此这里把用到的通用控件样式（`.modal-*` /
   * `.set-*` / `.assoc-*`）连同 markup 一起搬来。颜色仍走全局 CSS 变量，主题自动跟随。
   */
  import { makeT, LOCALES, type Locale } from "../lib/i18n";
  import type { AssocExt, DataLocationMode } from "../lib/tauri-api";

  type SettingsTabId = "general" | "assoc" | "cloud" | "storage";
  type AssocStat = { on: number; total: number; all: boolean; some: boolean };

  interface Props {
    locale: Locale;
    appVersion: string;
    settingsTab?: SettingsTabId;
    onClose: () => void;

    /* 通用 */
    selectLocale: (id: Locale) => void;
    autoSaveEnabled: boolean;
    onToggleAutoSave: () => void;
    defaultOpenMode: "read" | "edit";
    onSetDefaultOpenMode: (mode: "read" | "edit") => void;
    historyKeep: number;
    onSetHistoryKeep: (n: number) => void;
    notepadAll: boolean;
    assocBusy: boolean;
    onToggleNotepad: () => void;
    onOpenDefaultApps: () => void;
    contextMenu: boolean;
    onToggleContextMenu: () => void;
    recentFiles: string[];
    onClearRecentFiles: () => void;

    /* 文件关联 */
    assoc: Record<string, boolean>;
    assocExts: AssocExt[];
    allAssoc: AssocStat;
    assocOfGroup: (group: string) => AssocExt[];
    assocStats: (list: AssocExt[]) => AssocStat;
    onSetAssocBatch: (exts: string[], value: boolean) => void;
    onToggleAssoc: (ext: string) => void;

    /* WebDAV 同步 */
    davUrl?: string;
    davUser?: string;
    davPass?: string;
    davRoot?: string;
    onDavInput: () => void;
    onPersistDavConfig: () => void;
    davTesting: boolean;
    davTip: string;
    davVerified: boolean;
    davEnabled: boolean;
    davReady: boolean;
    onTestDav: () => void;
    onToggleDavEnabled: () => void;
    onOpenCloud: () => void;
    davVersioning: boolean;
    onToggleDavVersioning: () => void;
    davKeep: number;
    onSetDavKeep: (n: number) => void;
    davConflictPolicy: "copy" | "overwrite";
    onSetDavConflictPolicy: (p: "copy" | "overwrite") => void;

    /* 配置文件位置 */
    dataLocation: DataLocationMode;
    locationBusy: boolean;
    onChangeDataLocation: (mode: DataLocationMode) => void;
    onPickCustomLocation: () => void;
    dataRootPath: string;
    locationTip: string;
    locationTipOk: boolean;
    onRestart: () => void;
  }

  let {
    locale,
    appVersion,
    settingsTab = $bindable("general"),
    onClose,
    selectLocale,
    autoSaveEnabled,
    onToggleAutoSave,
    defaultOpenMode,
    onSetDefaultOpenMode,
    historyKeep,
    onSetHistoryKeep,
    notepadAll,
    assocBusy,
    onToggleNotepad,
    onOpenDefaultApps,
    contextMenu,
    onToggleContextMenu,
    recentFiles,
    onClearRecentFiles,
    assoc,
    assocExts,
    allAssoc,
    assocOfGroup,
    assocStats,
    onSetAssocBatch,
    onToggleAssoc,
    davUrl = $bindable(""),
    davUser = $bindable(""),
    davPass = $bindable(""),
    davRoot = $bindable(""),
    onDavInput,
    onPersistDavConfig,
    davTesting,
    davTip,
    davVerified,
    davEnabled,
    davReady,
    onTestDav,
    onToggleDavEnabled,
    onOpenCloud,
    davVersioning,
    onToggleDavVersioning,
    davKeep,
    onSetDavKeep,
    davConflictPolicy,
    onSetDavConflictPolicy,
    dataLocation,
    locationBusy,
    onChangeDataLocation,
    onPickCustomLocation,
    dataRootPath,
    locationTip,
    locationTipOk,
    onRestart,
  }: Props = $props();

  const t = $derived(makeT(locale));

  /** 设置面板的标签（顺序即左侧导航顺序） */
  const SETTINGS_TABS: { id: SettingsTabId; label: string }[] = [
    { id: "general", label: "通用" },
    { id: "assoc", label: "文件关联" },
    { id: "cloud", label: "WebDAV 同步" },
    { id: "storage", label: "配置文件位置" },
  ];

  /** 文件关联的分块顺序与标题（纯展示数据，随组件自带） */
  const ASSOC_GROUPS: { id: string; label: string }[] = [
    { id: "doc", label: "文档" },
    { id: "web", label: "网页" },
    { id: "text", label: "纯文本" },
    { id: "config", label: "配置" },
    { id: "code", label: "代码" },
    { id: "script", label: "脚本" },
  ];
</script>

<div
  class="modal-mask"
  role="none"
  onclick={(e) => {
    // 只有点在遮罩本身（而非面板内部）时才关闭
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div class="modal modal--settings" role="dialog" aria-label={t("软件设置")}>
    <div class="modal-head">
      <span>{t("软件设置")}</span>
      <button class="icon-btn" title={t("关闭（Esc）")} aria-label={t("关闭")} onclick={onClose}>✕</button>
    </div>

    <div class="settings-shell">
      <nav class="settings-nav">
        {#each SETTINGS_TABS as tab (tab.id)}
          <button class:active={settingsTab === tab.id} onclick={() => (settingsTab = tab.id)}>
            {t(tab.label)}
          </button>
        {/each}
      </nav>

      <div class="modal-body settings-panes">
        {#if settingsTab === "general"}
          <section class="set-group">
            <h3>{t("语言")}</h3>
            <div class="set-choices">
              {#each LOCALES as item (item.id)}
                <button class:active={locale === item.id} onclick={() => selectLocale(item.id)}>
                  {item.label}
                </button>
              {/each}
            </div>
            <p class="set-tip">{t("切换后立即生效；编辑器工具栏的气泡提示需重启程序才会更新。")}</p>
          </section>

          <section class="set-group">
            <h3>{t("打开")}</h3>
            <label class="set-row set-row--field">
              <span class="set-label">{t("默认打开模式")}</span>
              <select
                class="set-select"
                value={defaultOpenMode}
                onchange={(e) => onSetDefaultOpenMode(e.currentTarget.value as "read" | "edit")}
              >
                <option value="read">{t("阅读模式")}</option>
                <option value="edit">{t("编辑模式")}</option>
              </select>
            </label>
            <p class="set-tip">{t("打开或新建文档后的初始模式，只影响之后打开的文档；大文档与超大代码文件始终以只读方式打开。")}</p>
          </section>

          <section class="set-group">
            <h3>{t("保存")}</h3>
            <label class="set-row">
              <input type="checkbox" checked={autoSaveEnabled} onchange={onToggleAutoSave} />
              <span>{t("自动保存恢复草稿（每 30 秒，异常退出后可在下次启动恢复）")}</span>
            </label>
            <label class="set-row set-row--field">
              <span class="set-label">{t("本地版本历史保留份数")}</span>
              <select class="set-select" value={String(historyKeep)} onchange={(e) => onSetHistoryKeep(Number(e.currentTarget.value))}>
                {#each [5, 10, 20, 30, 50, 100] as n (n)}
                  <option value={String(n)}>{n}</option>
                {/each}
              </select>
            </label>
            <p class="set-tip">{t("保存覆盖前自动留档，可在「文件 → 文件历史」回滚；份数越多占用磁盘越多。")}</p>
          </section>

          <section class="set-group">
            <h3>{t("更新")}</h3>
            <p class="set-tip">
              {t("未配置更新源则不检查更新；如需升级，请到发布页下载新版安装包。")}
            </p>
          </section>

          <section class="set-group">
            <h3>{t("系统集成")}</h3>
            <label class="set-row">
              <input
                type="checkbox"
                checked={notepadAll}
                disabled={assocBusy}
                onchange={onToggleNotepad}
              />
              <span>{t("替代系统记事本（txt / log / ini 等文本格式）")}</span>
            </label>
            <p class="set-tip">
              {t("勾选即把记事本常见的文本格式关联到本软件。若双击后仍由记事本打开，请到系统「默认应用」里把对应格式改过来。")}
            </p>
            <div class="set-row">
              <button class="set-action" onclick={onOpenDefaultApps}>
                {t("打开系统「默认应用」设置")}
              </button>
            </div>

            <label class="set-row">
              <input
                type="checkbox"
                checked={contextMenu}
                disabled={assocBusy}
                onchange={onToggleContextMenu}
              />
              <span>{t("在文件右键菜单中加入「用 Sticho 打开」（所有文件）")}</span>
            </label>
          </section>

          <section class="set-group">
            <h3>{t("其他")}</h3>
            <button class="set-action" disabled={recentFiles.length === 0} onclick={onClearRecentFiles}>
              {t("清除最近文件列表")}
            </button>
          </section>
        {/if}

        {#if settingsTab === "assoc"}
          <section class="set-group">
            <div class="assoc-head assoc-head--all">
              <label class="assoc-head-check">
                <input
                  type="checkbox"
                  checked={allAssoc.all}
                  indeterminate={allAssoc.some}
                  disabled={assocBusy}
                  onchange={() => onSetAssocBatch(assocExts.map((e) => e.ext), !allAssoc.all)}
                />
                <span>{t("全选所有")}</span>
              </label>
              <span class="assoc-count">{allAssoc.on} / {allAssoc.total}</span>
            </div>

            {#each ASSOC_GROUPS as group (group.id)}
              {@const items = assocOfGroup(group.id)}
              {@const state = assocStats(items)}
              {#if items.length > 0}
                <div class="assoc-head">
                  <label class="assoc-head-check">
                    <input
                      type="checkbox"
                      checked={state.all}
                      indeterminate={state.some}
                      disabled={assocBusy}
                      onchange={() => onSetAssocBatch(items.map((e) => e.ext), !state.all)}
                    />
                    <span>{t(group.label)}</span>
                  </label>
                  <span class="assoc-count">{state.on} / {state.total}</span>
                </div>
                <div class="assoc-grid">
                  {#each items as item (item.ext)}
                    <label class="assoc-cell">
                      <input
                        type="checkbox"
                        checked={assoc[item.ext] === true}
                        onchange={() => onToggleAssoc(item.ext)}
                      />
                      <span>.{item.ext}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            {/each}

            <p class="set-tip">{t("关联仅对当前用户生效，无需管理员权限。")}</p>
          </section>
        {/if}

        {#if settingsTab === "cloud"}
          <section class="set-group">
            <label class="set-row set-row--field">
              <span class="set-label">{t("服务器地址")}</span>
              <input
                class="set-input"
                type="text"
                placeholder="https://example.com/dav"
                value={davUrl}
                oninput={(e) => {
                  davUrl = e.currentTarget.value;
                  onDavInput();
                }}
                onchange={onPersistDavConfig}
              />
            </label>
            <label class="set-row set-row--field">
              <span class="set-label">{t("用户名")}</span>
              <input
                class="set-input"
                type="text"
                value={davUser}
                oninput={(e) => {
                  davUser = e.currentTarget.value;
                  onDavInput();
                }}
                onchange={onPersistDavConfig}
              />
            </label>
            <label class="set-row set-row--field">
              <span class="set-label">{t("密码")}</span>
              <input
                class="set-input"
                type="password"
                value={davPass}
                oninput={(e) => {
                  davPass = e.currentTarget.value;
                  onDavInput();
                }}
                onchange={onPersistDavConfig}
              />
            </label>
            <label class="set-row set-row--field">
              <span class="set-label">{t("远端根目录")}</span>
              <input
                class="set-input"
                type="text"
                placeholder="/Sticho"
                value={davRoot}
                oninput={(e) => {
                  davRoot = e.currentTarget.value;
                  onDavInput();
                }}
                onchange={onPersistDavConfig}
              />
            </label>
            <div class="set-row">
              <button class="set-action" disabled={davTesting} onclick={onTestDav}>
                {davTesting ? t("测试中…") : t("测试连接")}
              </button>
              {#if davTip}<span class="set-tip-inline" class:ok={davVerified}>{davTip}</span>{/if}
            </div>

            <label class="set-row">
              <input
                type="checkbox"
                checked={davEnabled}
                disabled={!davReady}
                onchange={onToggleDavEnabled}
              />
              <span>{t("启用云同步")}</span>
            </label>
            {#if !davReady}
              <p class="set-tip">{t("请先测试连接")}</p>
            {/if}

            <div class="set-row">
              <button class="set-action" disabled={!davReady} onclick={onOpenCloud}>
                {t("浏览云端文件")}
              </button>
            </div>

            <label class="set-row">
              <input
                type="checkbox"
                checked={davVersioning}
                onchange={onToggleDavVersioning}
              />
              <span>{t("多版本控制")}</span>
            </label>
            {#if davVersioning}
              <label class="set-row set-row--field">
                <span class="set-label">{t("最多保留版本数")}</span>
                <select class="set-select" value={String(davKeep)} onchange={(e) => onSetDavKeep(Number(e.currentTarget.value))}>
                  {#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as n (n)}
                    <option value={String(n)}>{n}</option>
                  {/each}
                </select>
              </label>
            {/if}

            <label class="set-row set-row--field">
              <span class="set-label">{t("冲突处理方式")}</span>
              <select
                class="set-select"
                value={davConflictPolicy}
                onchange={(e) => onSetDavConflictPolicy(e.currentTarget.value as "copy" | "overwrite")}
              >
                <option value="copy">{t("保留冲突副本（推荐）")}</option>
                <option value="overwrite">{t("直接覆盖云端")}</option>
              </select>
            </label>
            <p class="set-tip">
              {t("云端文件被其他设备改过时：保留副本会在同目录另存一份，绝不覆盖对方内容；直接覆盖则以其为准。")}
            </p>

            <p class="set-tip">{t("凭据以明文保存在本机设置文件中")}</p>
            <p class="set-tip">{t("自签名证书的 HTTPS 服务器暂不支持，请使用公网证书或 http 内网地址")}</p>
            <p class="set-tip">{t("同步失败不影响本地保存")}</p>
          </section>
        {/if}

        {#if settingsTab === "storage"}
          <section class="set-group">
            <div class="set-choices">
              <button
                class:active={dataLocation === "user"}
                disabled={locationBusy}
                onclick={() => onChangeDataLocation("user")}
              >
                {t("系统目录")}
              </button>
              <button
                class:active={dataLocation === "custom"}
                disabled={locationBusy}
                onclick={onPickCustomLocation}
              >
                {t("指定目录")}
              </button>
              <button
                class:active={dataLocation === "portable"}
                disabled={locationBusy}
                onclick={() => onChangeDataLocation("portable")}
              >
                {t("当前程序目录")}
              </button>
            </div>
            {#if dataRootPath}
              <p class="set-path" title={dataRootPath}>{dataRootPath}</p>
            {/if}
            {#if locationTip}
              <p class="set-tip" class:ok={locationTipOk}>{locationTip}</p>
            {/if}
            <div class="set-row">
              <button class="set-action" disabled={locationBusy} onclick={onRestart}>
                {t("立即重启")}
              </button>
            </div>
            <p class="set-tip">{t("系统目录为推荐做法；当前程序目录便于随程序一起搬移；指定目录可放到任意位置（均需目录可读写）")}</p>
            <p class="set-tip">{t("切换前会检测目标目录可读写，不可用则保持原配置；选择迁移会在完整复制后清理旧目录")}</p>
          </section>
        {/if}
      </div>
    </div>

    <div class="modal-foot">Sticho {appVersion}</div>
  </div>
</div>

<style>
  /* ---- 模态骨架（与 App.svelte 的通用件同款，随组件作用域自带一份）---- */
  .modal-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    z-index: 600;
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

  /* 软件设置面板：多标签布局，明显放大（多选一对话框仍保持 380px） */
  .modal--settings {
    width: 760px;
    height: 580px;
    max-height: 88vh;
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

  .modal-foot {
    padding: 0.5rem 0.8rem;
    border-top: 1px solid var(--border, #ddd);
    font-size: 0.75rem;
    opacity: 0.6;
    text-align: right;
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

  .icon-btn:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  /* ---- 设置面板骨架 ---- */
  .settings-shell {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .settings-nav {
    flex-shrink: 0;
    width: 150px;
    padding: 0.5rem 0.45rem;
    overflow-y: auto;
    border-right: 1px solid var(--border, #ddd);
    background: var(--sidebar-bg, #fafafa);
  }

  .settings-nav button {
    display: block;
    width: 100%;
    margin-bottom: 2px;
    padding: 0.45rem 0.6rem;
    font: inherit;
    font-size: 0.8125rem;
    text-align: left;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .settings-nav button:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  /* 当前标签：淡底 + 强调色文字，与主界面的选中态观感一致 */
  .settings-nav button.active {
    font-weight: 600;
    color: var(--accent);
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .settings-panes {
    flex: 1;
    min-width: 0;
  }

  /* 面板变宽后，等分按钮不要拉得过长 */
  .settings-panes .set-choices {
    max-width: 460px;
  }

  /* ---- 设置项通用控件 ---- */
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

  .set-label {
    flex-shrink: 0;
    width: 4.2rem;
    opacity: 0.8;
  }

  /* 云同步的文本框：380px 宽的面板放不下长 URL，改成标签在上、输入框在下 */
  .set-row--field {
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
    cursor: default;
  }

  .set-row--field .set-label {
    width: auto;
  }

  .set-input {
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

  .set-tip-inline {
    font-size: 0.75rem;
    opacity: 0.75;
    margin-left: 0.5rem;
  }

  .set-tip-inline.ok {
    color: var(--accent);
    opacity: 1;
  }

  .set-tip {
    font-size: 0.75rem;
    opacity: 0.6;
    margin-top: 0.35rem;
  }

  /* 切换结果提示：成功用强调色，失败沿用错误色 */
  .modal-body .set-tip.ok {
    color: var(--accent);
    opacity: 0.95;
  }

  /* 当前数据根目录（只读展示）：等宽字体 + 可换行，过长时省略 */
  .set-path {
    margin-top: 0.4rem;
    padding: 0.25rem 0.4rem;
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.6875rem;
    line-height: 1.4;
    opacity: 0.75;
    word-break: break-all;
    background: var(--bg, #fff);
    border: 1px dashed var(--border, #ddd);
    border-radius: 6px;
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

  .set-action:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ---- 文件关联：分组标题 + 扩展名勾选网格 ---- */
  .assoc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 0.7rem 0 0.3rem;
  }

  .assoc-head--all {
    margin-top: 0;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border, #ddd);
  }

  .assoc-head-check {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    font-weight: 600;
    opacity: 0.65;
    cursor: pointer;
  }

  .assoc-head--all .assoc-head-check {
    font-size: 0.8125rem;
    opacity: 0.85;
  }

  .assoc-count {
    font-size: 0.75rem;
    opacity: 0.5;
    font-variant-numeric: tabular-nums;
  }

  .assoc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: 0.15rem 0.5rem;
  }

  .assoc-cell {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8125rem;
    padding: 0.15rem 0;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ---- 面板内的控件微调 ---- */
  /* 软件设置面板：扁平分组 + 控件观感统一（批次十一）
   * 去掉此前的灰色底卡，只用标题下的细线分隔，与编辑器主界面观感保持一致。 */
  .modal-body .set-group {
    padding: 0;
    border: none;
    background: none;
  }

  .modal-body .set-group + .set-group {
    margin-top: 1.1rem;
  }

  /* 分组标题：仅用一条细线与正文分隔，不再用底色块 */
  .modal-body .set-group h3 {
    margin-bottom: 0.6rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border, #ddd);
    opacity: 1;
  }

  /* 设置面板里的勾选框：统一尺寸与强调色，深浅色下都清晰 */
  .modal-body input[type="checkbox"] {
    flex-shrink: 0;
    width: 0.95rem;
    height: 0.95rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .modal-body input[type="checkbox"]:disabled {
    cursor: default;
    opacity: 0.4;
  }

  /* 输入框 / 下拉框 / 按钮：统一圆角与内边距，聚焦时给一圈强调色 */
  .modal-body .set-input,
  .modal-body .set-select {
    padding: 0.3rem 0.45rem;
    border-radius: 6px;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .modal-body .set-input:focus,
  .modal-body .set-select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18);
  }

  .modal-body .set-action,
  .modal-body .set-choices button {
    transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
  }

  .modal-body .set-action:focus-visible,
  .modal-body .set-choices button:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18);
  }

  .modal-body .set-action:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .modal-body .set-choices button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>