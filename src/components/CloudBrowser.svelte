<script lang="ts">
  /**
   * 云端文件浏览（批次九）：WebDAV 侧的目录浏览 / 下载打开 / 历史版本。
   *
   * 与 App.svelte 的分工：本组件只管「列目录、取正文」，网络 I/O 全走 Rust 命令；
   * 打开与恢复都通过 `onOpen` 回调交给应用层落成标签页。远端路径**绝不**当作本地
   * 路径使用——打开出来的是未命名文档，用户再自行另存到本地。
   *
   * 样式自成一体：Svelte 样式按组件作用域隔离，颜色仍走全局 CSS 变量以跟随主题。
   */
  import { onMount } from "svelte";
  import { makeT, type Locale } from "../lib/i18n";
  import { diffLines, type DiffLine } from "../lib/diff";
  import DiffView from "./DiffView.svelte";
  import {
    webdavDeleteVersion,
    webdavDownload,
    webdavFetchVersion,
    webdavList,
    webdavVersions,
    type DavConfig,
    type VersionEntry,
    type WebdavEntry,
  } from "../lib/tauri-api";

  interface Props {
    locale: Locale;
    /** 已通过「测试连接」的连接参数 */
    dav: DavConfig;
    /** 打开云端文件 / 恢复某版本：remote 为远端路径，content 为正文 */
    onOpen: (remote: string, content: string) => void;
    onClose: () => void;
  }
  let { locale, dav, onOpen, onClose }: Props = $props();

  const t = $derived(makeT(locale));

  /** 远端根目录（去掉尾斜杠，供面包屑与返回上级计算） */
  const rootPath = $derived(dav.root.trim().replace(/\/+$/, "") || "/Sticho");

  let path = $state(""); // 当前目录（相对 base 的远端路径）
  let entries = $state<WebdavEntry[]>([]);
  let loading = $state(false);
  let error = $state("");

  let versionsFor = $state<string | null>(null); // 正在看历史版本的远端文件路径
  let versions = $state<VersionEntry[]>([]);
  let versionsLoading = $state(false);
  let busyPath = $state(""); // 正在下载 / 恢复的条目，用于禁用重复点击

  // 版本差异视图（批次三）：旧 = 所选历史版本，新 = 远端当前正文
  let diffFor = $state<{ title: string; leftLabel: string; rightLabel: string; lines: DiffLine[] } | null>(null);

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
    loading = true;
    error = "";
    try {
      const list = await webdavList(conn, target);
      // 内部版本目录（.mdstudio-versions）不在这里展示，避免用户误操作
      entries = list.filter((e) => !e.name.startsWith(".") && e.name !== "");
      path = target;
      versionsFor = null;
      versions = [];
    } catch (e) {
      entries = [];
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
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

  /** 展开 / 收起某个文件的历史版本列表 */
  async function toggleVersions(e: WebdavEntry): Promise<void> {
    if (versionsFor === e.path) {
      versionsFor = null;
      versions = [];
      return;
    }
    versionsFor = e.path;
    versions = [];
    versionsLoading = true;
    error = "";
    try {
      versions = await webdavVersions(dav, e.path);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      versionsFor = null;
    } finally {
      versionsLoading = false;
    }
  }

  async function restore(v: VersionEntry): Promise<void> {
    const remote = versionsFor;
    if (remote === null || busyPath !== "") return;
    busyPath = remote;
    error = "";
    try {
      const content = await webdavFetchVersion(dav, remote, v.n);
      onOpen(remote, content);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyPath = "";
    }
  }

  async function removeVersion(v: VersionEntry): Promise<void> {
    const remote = versionsFor;
    if (remote === null) return;
    error = "";
    try {
      await webdavDeleteVersion(dav, remote, v.n);
      versions = versions.filter((x) => x.n !== v.n);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  /** 查看某云端历史版本与「远端当前正文」的差异（云版本只能取回远端正文） */
  async function showDiff(v: VersionEntry): Promise<void> {
    const remote = versionsFor;
    if (remote === null || busyPath !== "") return;
    busyPath = remote;
    error = "";
    try {
      const [oldText, current] = await Promise.all([
        webdavFetchVersion(dav, remote, v.n),
        webdavDownload(conn, remote),
      ]);
      diffFor = {
        title: t("版本差异"),
        leftLabel: t("云端版本 {n}", { n: v.n }),
        rightLabel: t("云端当前内容"),
        lines: diffLines(oldText, current),
      };
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

  function timeText(sec: number): string {
    if (sec === 0) return "-";
    return new Date(sec * 1000).toLocaleString();
  }

  onMount(() => {
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
  <div class="cb-modal" role="dialog" aria-label={t("云端文件")}>
    <div class="cb-head">
      <span>{t("云端文件")}</span>
      <button class="cb-x" title={t("关闭（Esc）")} aria-label={t("关闭")} onclick={onClose}>✕</button>
    </div>

    <div class="cb-bar">
      <button disabled={loading || crumbs.length === 0} onclick={goUp}>{t("返回上级")}</button>
      <button disabled={loading} onclick={() => void load(path)}>{t("刷新")}</button>
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
        <p class="cb-hint">{t("同步中…")}</p>
      {:else if entries.length === 0 && error === ""}
        <p class="cb-hint">{t("空目录")}</p>
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
                {#if !e.is_dir}
                  <button
                    class="cb-mini"
                    disabled={busyPath !== ""}
                    onclick={() => void toggleVersions(e)}
                  >
                    {t("历史版本")}
                  </button>
                {/if}
              </div>

              {#if versionsFor === e.path}
                <div class="cb-versions">
                  {#if versionsLoading}
                    <p class="cb-hint">{t("同步中…")}</p>
                  {:else if versions.length === 0}
                    <p class="cb-hint">{t("该文档暂无历史版本")}</p>
                  {:else}
                    {#each versions as v (v.n)}
                      <div class="cb-vrow">
                        <button
                          class="cb-name"
                          disabled={busyPath !== ""}
                          onclick={() => void restore(v)}
                        >
                          {t("版本 {n}", { n: v.n })}
                        </button>
                        <span class="cb-size">{sizeText(v.size)}</span>
                        <span class="cb-size">{timeText(v.saved_at)}</span>
                        <button class="cb-mini" disabled={busyPath !== ""} onclick={() => void showDiff(v)}>{t("查看差异")}</button>
                        <button class="cb-mini" onclick={() => void restore(v)}>{t("恢复到编辑器")}</button>
                        <button class="cb-mini" onclick={() => void removeVersion(v)}>{t("删除该版本")}</button>
                      </div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="cb-foot">{t("云端文档将作为未命名文档打开，保存时请另存到本地")}</div>
  </div>

  {#if diffFor}
    <DiffView
      {locale}
      title={diffFor.title}
      leftLabel={diffFor.leftLabel}
      rightLabel={diffFor.rightLabel}
      lines={diffFor.lines}
      onClose={() => (diffFor = null)}
    />
  {/if}
</div>

<style>
  .cb-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
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

  .cb-row,
  .cb-vrow {
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

  .cb-mini {
    flex-shrink: 0;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font-size: 0.7rem;
    cursor: pointer;
  }

  .cb-mini:hover:not(:disabled) {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .cb-versions {
    margin: 0 0 0.4rem 0.8rem;
    padding: 0.3rem 0.5rem;
    border-left: 2px solid var(--border, #ddd);
  }

  .cb-versions .cb-vrow {
    font-size: 0.75rem;
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