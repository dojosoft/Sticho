<script lang="ts">
  /**
   * 云端文件浏览（批次九）：WebDAV 侧的目录浏览 / 下载打开。
   *
   * 与 App.svelte 的分工：本组件只管「列目录、取正文」，网络 I/O 全走 Rust 命令；
   * 打开通过 `onOpen` 回调交给应用层落成标签页。远端路径**绝不**当作本地
   * 路径使用——打开出来的是未命名文档，用户再自行另存到本地。
   *
   * 样式自成一体：Svelte 样式按组件作用域隔离，颜色仍走全局 CSS 变量以跟随主题。
   */
  import { makeT, type Locale } from "../lib/i18n";
  import {
    webdavDownload,
    webdavList,
    type DavConfig,
    type WebdavEntry,
  } from "../lib/tauri-api";

  interface Props {
    locale: Locale;
    /** 语言包合并词表（内置 + locales/ 下的语言包）：由 App 注入，缺省时回落内置词表 */
    i18nEntries?: Record<string, string>;
    /** 已通过「测试连接」的连接参数 */
    dav: DavConfig;
    /** 打开云端文件：remote 为远端路径，content 为正文 */
    onOpen: (remote: string, content: string) => void;
    onClose: () => void;
  }
  let { locale, i18nEntries, dav, onOpen, onClose }: Props = $props();

  const t = $derived(makeT(locale, i18nEntries));

  /**
   * 远端根目录（去掉尾斜杠，供面包屑与返回上级计算）。
   *
   * 只在「没填」时回落到默认目录；用户显式填 "/"（服务器根）必须原样保留——否则
   * 「测试连接」通过、上传写到服务器根，而浏览界面却固定列 /Sticho，两边对不上。
   */
  const rootPath = $derived.by(() => {
    const raw = dav.root.trim();
    return raw === "" ? "/Sticho" : raw.replace(/\/+$/, "") || "/";
  });

  let path = $state(""); // 当前目录（相对 base 的远端路径）
  let entries = $state<WebdavEntry[]>([]);
  let loading = $state(false);
  let error = $state("");

  /**
   * 请求代次：快速连续切目录时，先发出的响应可能后到。
   * 没有这道保护，过期响应会同时改写 entries 与 path，把用户拽回上一个目录。
   */
  let loadSeq = 0;

  let busyPath = $state(""); // 正在下载的条目，用于禁用重复点击

  /** 根目录之下的相对层级（面包屑用） */
  const crumbs = $derived.by(() => {
    const p = path.replace(/\/+$/, "");
    if (p === "" || p === rootPath) return [] as string[];
    const rel = p.startsWith(rootPath + "/") ? p.slice(rootPath.length + 1) : p.replace(/^\/+/, "");
    return rel === "" ? [] : rel.split("/");
  });

  const conn = $derived<Omit<DavConfig, "root">>({
    url: dav.url,
    user: dav.user,
    password: dav.password,
  });

  async function load(target: string): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    error = "";
    // 首次加载失败时 path 还是空串：此时按 rootPath 回退，别去列 base 根目录
    const next = target || rootPath;
    try {
      const list = await webdavList(conn, next);
      if (seq !== loadSeq) return; // 已有更新的请求在途，丢弃这份过期响应
      // 以「.」开头的内部目录不在这里展示，避免用户误操作
      entries = list.filter((e) => !e.name.startsWith(".") && e.name !== "");
      path = next;
    } catch (e) {
      if (seq !== loadSeq) return; // 过期请求的失败也不该改写界面状态
      entries = [];
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (seq === loadSeq) loading = false; // 只有最新请求有权结束 loading
    }
  }

  function enter(e: WebdavEntry): void {
    if (e.is_dir) {
      void load(e.path);
    } else {
      void openFile(e);
    }
  }

  /** 下载并作为未命名文档打开 */
  async function openFile(e: WebdavEntry): Promise<void> {
    if (busyPath !== "") return;
    busyPath = e.path;
    error = "";
    try {
      const content = await webdavDownload(conn, e.path);
      onOpen(e.path, content);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyPath = "";
    }
  }

  function goUp(): void {
    void load(crumbs.length === 0 ? rootPath : `${rootPath}/${crumbs.slice(0, -1).join("/")}`);
  }

  /** 面包屑第 i 段（i = -1 表示根目录） */
  function goTo(i: number): void {
    void load(i < 0 ? rootPath : `${rootPath}/${crumbs.slice(0, i + 1).join("/")}`);
  }

  function sizeText(n: number): string {
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  // 连接身份指纹：dav 变化即换数据源，回到根目录重新加载（不再只在挂载时加载一次）
  const davKey = $derived(`${dav.url}\u0000${dav.user}\u0000${dav.password}\u0000${dav.root}`);
  let lastDavKey = "";

  $effect(() => {
    if (davKey === lastDavKey) return;
    lastDavKey = davKey;
    void load(rootPath);
  });
</script>

<div
  class="cb-mask"
  role="none"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div class="cb-modal" role="dialog" aria-label={t("Cloud Files")}>
    <div class="cb-head">
      <span>{t("Cloud Files")}</span>
      <button class="cb-x" title={t("Close (Esc)")} aria-label={t("Close")} onclick={onClose}>✕</button>
    </div>

    <div class="cb-bar">
      <button disabled={loading || crumbs.length === 0} onclick={goUp}>{t("Up")}</button>
      <button disabled={loading} onclick={() => void load(path || rootPath)}>{t("Refresh")}</button>
      <nav class="cb-crumbs">
        <button class="cb-crumb" disabled={loading} onclick={() => goTo(-1)}>{rootPath || "/"}</button>
        {#each crumbs as c, i (c + i)}
          <span class="cb-sep">/</span>
          <button class="cb-crumb" disabled={loading} onclick={() => goTo(i)}>{c}</button>
        {/each}
      </nav>
    </div>

    <div class="cb-body">
      {#if error}<p class="cb-err">{error}</p>{/if}
      {#if loading}
        <p class="cb-hint">{t("Syncing…")}</p>
      {:else if entries.length === 0 && error === ""}
        <p class="cb-hint">{t("Empty folder")}</p>
      {:else}
        <ul class="cb-list">
          {#each entries as e (e.path)}
            <li class="cb-item">
              <div class="cb-row">
                <button
                  class="cb-name"
                  class:dir={e.is_dir}
                  disabled={busyPath !== ""}
                  title={e.path}
                  onclick={() => enter(e)}
                >
                  {e.name}{e.is_dir ? "/" : ""}
                </button>
                <span class="cb-size">{e.is_dir ? "" : sizeText(e.size)}</span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="cb-foot">{t("Cloud documents open as untitled documents; use Save As to keep a local copy")}</div>
  </div>
</div>

<style>
  .cb-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--overlay, rgba(0, 0, 0, 0.35));
    z-index: 620;
  }

  .cb-modal {
    display: flex;
    flex-direction: column;
    width: 560px;
    max-width: 92vw;
    max-height: 82vh;
    background: var(--bg, #fff);
    color: var(--fg, #1f2328);
    border: 1px solid var(--border, #ddd);
    border-radius: 10px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .cb-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.5rem 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border, #ddd);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .cb-x {
    width: 1.7rem;
    height: 1.7rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .cb-x:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .cb-bar {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border, #ddd);
  }

  .cb-bar button {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .cb-bar button:hover:not(:disabled) {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .cb-bar button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .cb-crumbs {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    font-size: 0.75rem;
    opacity: 0.85;
  }

  .cb-crumb {
    border: none !important;
    padding: 0.1rem 0.2rem !important;
  }

  .cb-sep {
    opacity: 0.5;
  }

  .cb-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0.8rem;
  }

  .cb-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .cb-item + .cb-item {
    border-top: 1px solid var(--border, #ddd);
  }

  .cb-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0;
    font-size: 0.8125rem;
  }

  .cb-name {
    flex: 1;
    min-width: 0;
    text-align: left;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font: inherit;
    padding: 0.15rem 0.3rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .cb-name:hover:not(:disabled) {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .cb-name:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .cb-name.dir {
    font-weight: 600;
  }

  .cb-size {
    flex-shrink: 0;
    font-size: 0.75rem;
    opacity: 0.6;
    white-space: nowrap;
  }

  .cb-hint {
    font-size: 0.75rem;
    opacity: 0.6;
    padding: 0.3rem 0;
  }

  .cb-err {
    font-size: 0.75rem;
    color: var(--danger, #c0392b);
    padding: 0.3rem 0;
    word-break: break-all;
  }

  .cb-foot {
    padding: 0.5rem 0.8rem;
    border-top: 1px solid var(--border, #ddd);
    font-size: 0.75rem;
    opacity: 0.6;
  }
</style>