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
  import { makeT, type Locale } from "../lib/i18n";
  import type { AssocExt, DataLocationMode } from "../lib/tauri-api";

  type SettingsTabId = "general" | "save" | "assoc" | "cloud";
  type AssocStat = { on: number; total: number; all: boolean; some: boolean };

  interface Props {
    locale: Locale;
    /** 语言包合并词表（内置 + locales/ 下的语言包）：由 App 注入，缺省时回落内置词表 */
    i18nEntries?: Record<string, string>;
    appVersion: string;
    settingsTab?: SettingsTabId;
    onClose: () => void;

    /* 通用 */
    selectLocale: (id: Locale) => void;
    /** 可选语言清单（内置 + locales/ 下的语言包） */
    localeOptions: { id: string; label: string }[];
    /** 在资源管理器中打开语言包文件夹 */
    onOpenLocalesDir: () => void;
    autoSaveEnabled: boolean;
    onToggleAutoSave: () => void;
    /** 自动保存间隔（分钟）；0.5 表示 30 秒 */
    autoSaveIntervalMin: number;
    onSetAutoSaveInterval: (min: number) => void;
    defaultOpenMode: "read" | "edit";
    onSetDefaultOpenMode: (mode: "read" | "edit") => void;
    /* 本地多版本控制：三类上限 */
    historyKeep: number;
    onSetHistoryKeep: (n: number) => void;
    historyCountLimitOn: boolean;
    onSetHistoryCountLimitOn: (on: boolean) => void;
    historySizeLimitOn: boolean;
    onSetHistorySizeLimitOn: (on: boolean) => void;
    historyMaxSizeMb: number;
    onSetHistoryMaxSizeMb: (n: number) => void;
    historyAgeLimitOn: boolean;
    onSetHistoryAgeLimitOn: (on: boolean) => void;
    historyMaxAgeDays: number;
    onSetHistoryMaxAgeDays: (n: number) => void;
    notepadAll: boolean;
    assocBusy: boolean;
    onToggleNotepad: () => void;
    onOpenDefaultApps: () => void;
    contextMenu: boolean;
    onToggleContextMenu: () => void;
    recentFiles: string[];
    onClearRecentFiles: () => void;
    /** 清理对系统的全部写入（文件关联 + 右键菜单），恢复便携状态 */
    onClearSystemWrites: () => void;
    /** 一键清理全部配置文件（两次确认后执行，完成后提示重启） */
    onClearConfigFiles: () => void;

    /* 文件关联 */
    assoc: Record<string, boolean>;
    assocExts: AssocExt[];
    allAssoc: AssocStat;
    assocOfGroup: (group: string) => AssocExt[];
    assocStats: (list: AssocExt[]) => AssocStat;
    onSetAssocBatch: (exts: string[], value: boolean) => void;
    onToggleAssoc: (ext: string) => void;

    /* WebDAV */
    davUrl?: string;
    davUser?: string;
    davPass?: string;
    davRoot?: string;
    /** 使用 HTTPS；关闭后允许明文 http 连接 */
    davUseHttps?: boolean;
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
    davConflictPolicy: "copy" | "overwrite";
    onSetDavConflictPolicy: (p: "copy" | "overwrite") => void;

    /* 配置文件位置 */
    dataLocation: DataLocationMode;
    locationBusy: boolean;
    onChangeDataLocation: (mode: DataLocationMode) => void;
    dataRootPath: string;
    locationTip: string;
    locationTipOk: boolean;
  }

  let {
    locale,
    i18nEntries,
    appVersion,
    settingsTab = $bindable("general"),
    onClose,
    selectLocale,
    localeOptions,
    onOpenLocalesDir,
    autoSaveEnabled,
    onToggleAutoSave,
    autoSaveIntervalMin,
    onSetAutoSaveInterval,
    defaultOpenMode,
    onSetDefaultOpenMode,
    historyKeep,
    onSetHistoryKeep,
    historyCountLimitOn,
    onSetHistoryCountLimitOn,
    historySizeLimitOn,
    onSetHistorySizeLimitOn,
    historyMaxSizeMb,
    onSetHistoryMaxSizeMb,
    historyAgeLimitOn,
    onSetHistoryAgeLimitOn,
    historyMaxAgeDays,
    onSetHistoryMaxAgeDays,
    notepadAll,
    assocBusy,
    onToggleNotepad,
    onOpenDefaultApps,
    contextMenu,
    onToggleContextMenu,
    recentFiles,
    onClearRecentFiles,
    onClearSystemWrites,
    onClearConfigFiles,
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
    davUseHttps = $bindable(true),
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
    davConflictPolicy,
    onSetDavConflictPolicy,
    dataLocation,
    locationBusy,
    onChangeDataLocation,
    dataRootPath,
    locationTip,
    locationTipOk,
  }: Props = $props();

  const t = $derived(makeT(locale, i18nEntries));

  /** 服务器地址是否为明文 http：明文下 Basic Auth 的用户名/密码未加密，可能被网络截获 */
  const davInsecure = $derived(davUrl.trim().toLowerCase().startsWith("http://"));

  /**
   * 常见 WebDAV 服务商的服务器地址预设（key 走 i18n，便于中英文切换）。
   * host 非空者用于「按已填地址回显对应服务商」；含占位符的模板项留空 host，
   * 一律按「自定义服务器」处理（用户改完地址后自行配置）。
   */
  const DAV_PROVIDERS: { id: string; key: string; url: string; host: string; tlsOnly: boolean }[] = [
    { id: "custom", key: "Custom Server", url: "", host: "", tlsOnly: false },
    { id: "jianguoyun", key: "Jianguoyun", url: "https://dav.jianguoyun.com/dav/", host: "dav.jianguoyun.com", tlsOnly: true },
    { id: "infinicloud", key: "InfiniCLOUD", url: "https://your-id.teracloud.jp/dav/", host: "", tlsOnly: true },
    { id: "nextcloud", key: "Nextcloud", url: "https://your-server/remote.php/dav/files/your-username/", host: "", tlsOnly: false },
    { id: "owncloud", key: "ownCloud", url: "https://your-server/remote.php/dav/files/your-username/", host: "", tlsOnly: false },
    { id: "synology", key: "Synology NAS", url: "https://your-nas:5006/", host: "", tlsOnly: false },
    { id: "yandex", key: "Yandex Disk", url: "https://webdav.yandex.ru/", host: "webdav.yandex.ru", tlsOnly: true },
    { id: "pcloud", key: "pCloud", url: "https://webdav.pcloud.com/", host: "webdav.pcloud.com", tlsOnly: true },
    { id: "box", key: "Box", url: "https://dav.box.com/dav", host: "dav.box.com", tlsOnly: true },
    { id: "koofr", key: "Koofr", url: "https://app.koofr.net/dav/Koofr/", host: "app.koofr.net", tlsOnly: true },
  ];

  /** 取地址的主机名（非法地址返回空串） */
  function hostOf(url: string): string {
    try {
      return new URL(url.trim()).host;
    } catch {
      return "";
    }
  }

  /** 当前地址对应的服务商（按主机名匹配；认不出则视为「自定义服务器」） */
  const davProvider = $derived.by(() => {
    const host = hostOf(davUrl);
    if (host === "") return "custom";
    return DAV_PROVIDERS.find((p) => p.host !== "" && p.host === host)?.id ?? "custom";
  });

  /** 按 HTTPS 开关改写地址的协议前缀（关 = 允许明文 http） */
  function applyScheme(url: string): string {
    return davUseHttps ? url.replace(/^http:\/\//i, "https://") : url.replace(/^https:\/\//i, "http://");
  }

  /**
   * 选择服务商：预设项按其自带推荐协议填入地址。
   * 仅支持 TLS 的服务商（如坚果云、Yandex 等公共网盘）恒用 https，不随 HTTPS 开关降级；
   * 「自定义」保留当前地址交给用户自行编辑。
   */
  function chooseDavProvider(id: string): void {
    const p = DAV_PROVIDERS.find((x) => x.id === id);
    if (p && p.url !== "") davUrl = p.tlsOnly ? p.url : applyScheme(p.url);
    onDavInput();
    onPersistDavConfig();
  }

  /** 切换 HTTPS：同步改写当前地址的协议前缀并落盘；仅支持 TLS 的服务商不降级为明文 http */
  function setDavHttps(on: boolean): void {
    davUseHttps = on;
    const u = davUrl.trim();
    if (u !== "") {
      const host = hostOf(u);
      const tlsOnly = DAV_PROVIDERS.some((p) => p.tlsOnly && p.host !== "" && p.host === host);
      if (on || !tlsOnly) davUrl = applyScheme(u);
    }
    onDavInput();
    onPersistDavConfig();
  }

  /** 自动保存间隔档位（分钟）；0.5 表示 30 秒 */
  const AUTO_SAVE_INTERVALS: number[] = [0.5, 1, 2, 5, 10, 15, 30];

  /** 间隔档位的显示文案：半小时档显示为「30 秒」，1 分钟用单数，其余显示为「n 分钟」 */
  function intervalLabel(min: number): string {
    if (min === 0.5) return t("30 seconds");
    return min === 1 ? t("1 minute") : t("{n} minutes", { n: min });
  }

  /**
   * 数字输入的钳制：把值收进 [min, max] 的整数；空值或非法值回退 `fallback`。
   * 输入框的 min/max 只是提示，用户仍可手输越界值或清空，必须在 change 时兜住。
   */
  function clampNumber(raw: string, min: number, max: number, fallback: number): number {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  /** 设置面板的标签（顺序即左侧导航顺序） */
  const SETTINGS_TABS: { id: SettingsTabId; label: string }[] = [
    { id: "general", label: "General" },
    { id: "save", label: "Recovery Center" },
    { id: "assoc", label: "File Associations" },
    { id: "cloud", label: "WebDAV" },
  ];

  /** 文件关联的分块顺序与标题（纯展示数据，随组件自带） */
  const ASSOC_GROUPS: { id: string; label: string }[] = [
    { id: "doc", label: "Documents" },
    { id: "web", label: "Web" },
    { id: "text", label: "Plain Text" },
    { id: "config", label: "Config" },
    { id: "code", label: "Code" },
    { id: "script", label: "Script" },
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
  <div class="modal modal--settings" role="dialog" aria-label={t("Settings")}>
    <div class="modal-head">
      <span>{t("Settings")}</span>
      <button class="icon-btn" title={t("Close (Esc)")} aria-label={t("Close")} onclick={onClose}>✕</button>
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
            <!-- 标题与「打开语言包文件夹」同排，按钮靠右对齐 -->
            <div class="set-head">
              <h3
                data-tip={`${t("Language packs: put a .json file into the locales folder to select it here (keys are the original English text, values are the translation).")} ${t("Takes effect immediately, including the editor toolbar tooltips — no restart needed.")}`}
              >{t("Language")}</h3>
              <button class="set-action" onclick={onOpenLocalesDir}>{t("Open Locales Folder")}</button>
            </div>
            <label class="set-row set-row--field">
              <span class="set-label">{t("Interface Language")}</span>
              <select
                class="set-select"
                value={locale}
                onchange={(e) => selectLocale(e.currentTarget.value)}
              >
                {#each localeOptions as item (item.id)}
                  <option value={item.id}>{item.label}</option>
                {/each}
              </select>
            </label>
          </section>

          <section class="set-group">
            <h3 data-tip={t("The initial mode for documents you open or create; it only affects documents opened afterwards. Large documents and oversized code files always open in read-only mode.")}>{t("Open")}</h3>
            <div class="set-row set-row--field">
              <span class="set-label">{t("Default Open Mode")}</span>
              <div class="set-radios" role="radiogroup" aria-label={t("Default Open Mode")}>
                <label class="set-radio">
                  <input
                    type="radio"
                    name="default-open-mode"
                    value="read"
                    checked={defaultOpenMode === "read"}
                    onchange={() => onSetDefaultOpenMode("read")}
                  />
                  <span>{t("Reading Mode")}</span>
                </label>
                <label class="set-radio">
                  <input
                    type="radio"
                    name="default-open-mode"
                    value="edit"
                    checked={defaultOpenMode === "edit"}
                    onchange={() => onSetDefaultOpenMode("edit")}
                  />
                  <span>{t("Edit Mode")}</span>
                </label>
              </div>
            </div>
          </section>

          <section class="set-group">
            <!-- 标题与「打开系统默认应用」同排，按钮靠右对齐 -->
            <div class="set-head">
              <h3 data-tip={t("Enabling this associates Notepad's usual text formats with this app. If they still open in Notepad, change them in the system's Default Apps.")}>{t("System Integration")}</h3>
              <button class="set-action" onclick={onOpenDefaultApps}>{t("Open system Default Apps")}</button>
            </div>
            <label class="set-row">
              <input
                type="checkbox"
                checked={notepadAll}
                disabled={assocBusy}
                onchange={onToggleNotepad}
              />
              <span>{t("Replace Notepad (text formats such as txt / log / ini)")}</span>
            </label>
            <label class="set-row">
              <input
                type="checkbox"
                checked={contextMenu}
                disabled={assocBusy}
                onchange={onToggleContextMenu}
              />
              <span>{t("Add “Open with Sticho” to the file context menu (all files)")}</span>
            </label>
          </section>

          <!-- 配置文件位置：移到「其他」之上；位置切换本身会提示重启，故不再单列「立即重启」按钮 -->
          <section class="set-group">
            <h3>{t("Config File Location")}</h3>
            <div
              class="set-choices"
              data-tip={`${t("The system folder is recommended; the program folder travels with the app (both must be readable and writable).")} ${t("The target folder is checked for read/write access first; if unavailable the current config is kept. Choosing migrate cleans up the old folder after a complete copy.")}`}
            >
              <button
                class:active={dataLocation === "user"}
                disabled={locationBusy}
                onclick={() => onChangeDataLocation("user")}
              >
                {t("System folder")}
              </button>
              <button
                class:active={dataLocation === "portable"}
                data-tip={t("Portable use: copy the program together with the Sticho folder under “Program Folder” to a USB drive or another PC; it is detected automatically on launch and keeps the same config, with no re-setup needed.")}
                disabled={locationBusy}
                onclick={() => onChangeDataLocation("portable")}
              >
                {t("Program Folder")}
              </button>
            </div>
            {#if dataRootPath}
              <p class="set-path" title={dataRootPath}>{dataRootPath}</p>
            {/if}
            {#if locationTip}
              <p class="set-tip" class:ok={locationTipOk}>{locationTip}</p>
            {/if}
          </section>

          <section class="set-group">
            <h3>{t("Other")}</h3>
            <div class="set-actions">
              <button class="set-action" disabled={recentFiles.length === 0} onclick={onClearRecentFiles}>
                {t("Clear Recent Files")}
              </button>
              <button
                class="set-action"
                data-tip={t("Reverts all file associations and removes the “Open with Sticho” context-menu item, restoring Sticho to a portable state.")}
                onclick={onClearSystemWrites}
              >
                {t("Clean Up System Writes")}
              </button>
              <button
                class="set-action set-action--danger"
                data-tip={t("Clears settings, custom themes and language packs, bookmarks, recovery drafts and version history.")}
                onclick={onClearConfigFiles}
              >
                {t("Clear Configuration Files")}
              </button>
            </div>
          </section>
        {/if}

        {#if settingsTab === "save"}
          <section class="set-group">
            <h3 data-tip={t("While a document has unsaved changes, a recovery draft is written at the chosen interval so your work survives a crash; the draft is cleared once you save.")}>{t("Auto-save")}</h3>
            <label class="set-row">
              <input
                type="checkbox"
                checked={autoSaveEnabled}
                onchange={onToggleAutoSave}
              />
              <span>{t("Auto-save recovery drafts")}</span>
            </label>
            <label class="set-row set-row--field">
              <span class="set-label">{t("Interval")}</span>
              <select
                class="set-select"
                value={String(autoSaveIntervalMin)}
                disabled={!autoSaveEnabled}
                onchange={(e) => onSetAutoSaveInterval(Number(e.currentTarget.value))}
              >
                {#each AUTO_SAVE_INTERVALS as min (min)}
                  <option value={String(min)}>{intervalLabel(min)}</option>
                {/each}
              </select>
            </label>
          </section>

          <section class="set-group">
            <h3 data-tip={t("Each time you save a document, its previous content is archived locally so you can roll back later. Auto-saved drafts do not count toward these versions.")}>{t("Multi-version Control")}</h3>
            <label class="set-row">
              <input
                type="checkbox"
                checked={historyCountLimitOn}
                onchange={(e) => onSetHistoryCountLimitOn(e.currentTarget.checked)}
              />
              <span>{t("Limit the number of versions")}</span>
            </label>
            <label class="set-row set-row--field">
              <span class="set-label">{t("Versions kept per file")}</span>
              <select
                class="set-select"
                value={String(historyKeep)}
                disabled={!historyCountLimitOn}
                onchange={(e) => onSetHistoryKeep(Number(e.currentTarget.value))}
              >
                {#each [5, 10, 20, 30, 50, 100, 200] as n (n)}
                  <option value={String(n)}>{n}</option>
                {/each}
              </select>
            </label>
            <label class="set-row">
              <input
                type="checkbox"
                checked={historySizeLimitOn}
                onchange={(e) => onSetHistorySizeLimitOn(e.currentTarget.checked)}
              />
              <span>{t("Limit total size of versions")}</span>
            </label>
            <label class="set-row set-row--field">
              <span class="set-label">{t("Size limit (MB per file)")}</span>
              <input
                class="set-input"
                type="number"
                min="1"
                max="10240"
                value={historyMaxSizeMb}
                disabled={!historySizeLimitOn}
                onchange={(e) => onSetHistoryMaxSizeMb(clampNumber(e.currentTarget.value, 1, 10240, 100))}
              />
            </label>
            <label class="set-row">
              <input
                type="checkbox"
                checked={historyAgeLimitOn}
                onchange={(e) => onSetHistoryAgeLimitOn(e.currentTarget.checked)}
              />
              <span>{t("Limit retention time of versions")}</span>
            </label>
            <label class="set-row set-row--field">
              <span class="set-label">{t("Retention Days")}</span>
              <input
                class="set-input"
                type="number"
                min="1"
                max="3650"
                value={historyMaxAgeDays}
                disabled={!historyAgeLimitOn}
                onchange={(e) => onSetHistoryMaxAgeDays(clampNumber(e.currentTarget.value, 1, 3650, 30))}
              />
            </label>
            <p class="set-tip">{t("When a limit is exceeded, the oldest versions are deleted first to free up space.")}</p>
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
                <span data-tip={t("Associations apply to the current user only; no admin rights needed.")}>{t("Select All")}</span>
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
          </section>
        {/if}

        {#if settingsTab === "cloud"}
          <section class="set-group">
            <label class="set-row set-row--field">
              <span class="set-label" data-tip={t("Pick a common WebDAV provider to fill in its server address, or choose “Custom Server” and edit the address yourself.")}>{t("Service Provider")}</span>
              <select
                class="set-select"
                value={davProvider}
                onchange={(e) => chooseDavProvider(e.currentTarget.value)}
              >
                {#each DAV_PROVIDERS as p (p.id)}
                  <option value={p.id}>{t(p.key)}</option>
                {/each}
              </select>
            </label>
            <label class="set-row set-row--field">
              <span class="set-label" data-tip={t("HTTPS servers with self-signed certificates are not supported; use a public CA or a plain http intranet address")}>{t("Server URL")}</span>
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
            <label class="set-row">
              <input
                type="checkbox"
                checked={davUseHttps}
                onchange={(e) => setDavHttps(e.currentTarget.checked)}
              />
              <span data-tip={t("Turn this off to allow a plain http connection (unencrypted). Keep it on to require https.")}>{t("Use HTTPS")}</span>
            </label>
            {#if davInsecure}
              <p class="set-tip warn">
                {t("The server address uses plain http — your username and password are sent unencrypted and may be intercepted. Use https when possible.")}
              </p>
            {/if}
            <label class="set-row set-row--field">
              <span class="set-label">{t("Username")}</span>
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
              <span class="set-label" data-tip={t("The password is encrypted with Windows DPAPI and stored locally, bound to the current Windows user (another user or machine cannot decrypt it)")}>{t("Password")}</span>
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
              <span class="set-label">{t("Remote Root")}</span>
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
                {davTesting ? t("Testing…") : t("Test Connection")}
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
              <span data-tip={t("A sync failure does not affect local saving")}>{t("Enable Cloud Sync")}</span>
            </label>
            {#if !davReady}
              <p class="set-tip">{t("Test the connection first")}</p>
            {/if}

            <div class="set-row">
              <button class="set-action" disabled={!davReady} onclick={onOpenCloud}>
                {t("Browse Cloud Files")}
              </button>
            </div>

            <label class="set-row set-row--field">
              <span class="set-label" data-tip={t("When a cloud file has been changed by another device: “Keep a Conflict Copy” saves a separate copy in the same folder and never overwrites the other side; “Overwrite” makes this copy authoritative.")}>{t("Conflict Handling")}</span>
              <select
                class="set-select"
                value={davConflictPolicy}
                onchange={(e) => onSetDavConflictPolicy(e.currentTarget.value as "copy" | "overwrite")}
              >
                <option value="copy">{t("Keep a Conflict Copy")}</option>
                <option value="overwrite">{t("Overwrite the Cloud Copy")}</option>
              </select>
            </label>
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
    transition: background 0.15s ease, color 0.15s ease;
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

  /* 操作按钮组：横向排列，面板变窄时自动换行 */
  .set-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
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

  /* 「默认打开方式」改用单选按钮组：两个互斥选项一目了然，不必展开下拉 */
  .set-radios {
    display: flex;
    flex-wrap: wrap;
    gap: 0.9rem;
  }

  .set-radio {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .set-radio input[type="radio"] {
    margin: 0;
    accent-color: var(--accent, #2563eb);
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

  /* 明文 http 警示：用警告色，与成功提示区分 */
  .modal-body .set-tip.warn {
    color: var(--warning, #b7791f);
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

  /* 危险动作（清理配置文件）：用危险色描边与文字，与普通操作区分开 */
  .set-action--danger {
    border-color: var(--danger, #c0392b);
    color: var(--danger, #c0392b);
  }

  .set-action--danger:hover:not(:disabled) {
    background: var(--danger-soft, rgba(192, 57, 43, 0.12));
  }

  /* ---- 文件关联：分组标题 + 扩展名勾选网格 ---- */
  /* 每个子分类标题下方加一条细分割线，并加大分类之间的上间距，便于辨认分组 */
  .assoc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin: 1.1rem 0 0.45rem;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--border, #ddd);
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

  /* 标题与右侧动作按钮同排（如「语言 + 打开语言包文件夹」「系统集成 + 打开系统默认应用」）：
     下划线改由整行承担，按钮靠右对齐 */
  .modal-body .set-group .set-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border, #ddd);
  }

  /* 标题自身的下划线/间距交给 .set-head，避免出现两条线 */
  .modal-body .set-group .set-head h3 {
    margin: 0;
    padding: 0;
    border-bottom: none;
  }

  /* 同排按钮不再需要与分组正文的上间距 */
  .modal-body .set-group .set-head .set-action {
    flex-shrink: 0;
    white-space: nowrap;
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