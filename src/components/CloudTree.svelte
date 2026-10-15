<script lang="ts">
  /**
   * 侧边栏「云端」视图：以目录形式浏览 WebDAV 远端文件。
   *
   * 与设置里的「云端文件浏览」模态（CloudBrowser.svelte）互补：
   * 这里面向日常浏览与**就地编辑**——打开的文件由应用层绑定远端路径，保存时直接回写云端。
   *
   * 网络 I/O 全部走 Rust 命令；远端路径**绝不**当作本地路径使用。
   */
  import { webdavDownload, webdavList, type DavConfig, type WebdavEntry } from "../lib/tauri-api";

  type Props = {
    /** 已通过「测试连接」的连接参数；null = 尚未配置 */
    dav: DavConfig | null;
    /** 打开云端文件：remote 为远端路径，content 为正文 */
    onOpen: (remote: string, content: string) => void;
    /** 界面翻译函数（以英文原文为键）；未传入时原样返回 */
    t?: (key: string, vars?: Record<string, string | number>) => string;
  };
  let { dav, onOpen, t = (s: string) => s }: Props = $props();

  /** 远端根目录（去掉尾斜杠；与 CloudBrowser 口径一致） */
  const rootPath = $derived((dav?.root ?? "").trim().replace(/\/+$/, "") || "/Sticho");

  /** 只保留连接三要素（list / download 不需要 root） */
  const conn = $derived(dav ? { url: dav.url, user: dav.user, password: dav.password } : null);

  let path = $state(""); // 当前目录（相对 base 的远端路径）
  let entries = $state<WebdavEntry[]>([]);
  let loading = $state(false);
  let error = $state("");
  let busyPath = $state(""); // 正在下载的条目，用于禁用重复点击

  /**
   * 请求代次：每次 load 自增并记下自己的序号，响应回来时序号不是最新就丢弃。
   *
   * 快速点进 A 目录再点进 B 目录时，A 的响应可能后到；没有这道保护，界面会被
   * A 的列表覆盖，且 path 也会被改成 A——用户看到的目录与实际位置对不上。
   */
  let loadSeq = 0;

  async function load(target: string): Promise<void> {
    if (!conn) return;
    const seq = ++loadSeq;
    loading = true;
    error = "";
    const next = target || rootPath;
    try {
      const list = await webdavList(conn, next);
      if (seq !== loadSeq) return; // 已有更新的请求在途，丢弃这份过期响应
      // 内部版本目录（.mdstudio-versions）不在此展示，避免误操作；目录排在文件前面
      entries = list
        .filter((e) => !e.name.startsWith(".") && e.name !== "")
        .sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1));
      path = next;
    } catch (e) {
      if (seq !== loadSeq) return; // 同上：过期请求的失败也不该改写界面状态
      entries = [];
      error = e instanceof Error ? e.message : String(e);
    } finally {
      if (seq === loadSeq) loading = false; // 只有最新请求有权结束 loading
    }
  }

  /**
   * 连接身份指纹（含远端根）：换服务器 / 账号 / 根目录都视为换了数据源。
   * 只盯 `path === ""` 会在连接身份变化时漏掉刷新（旧目录会残留），故按指纹判断。
   */
  const davKey = $derived(
    dav ? `${dav.url}\u0000${dav.user}\u0000${dav.password}\u0000${dav.root}` : "",
  );
  let lastDavKey = "";

  // 连接参数就绪（或身份变化）后重置目录并载入根目录
  $effect(() => {
    if (!conn) {
      lastDavKey = "";
      return;
    }
    if (davKey !== lastDavKey) {
      lastDavKey = davKey;
      path = "";
      void load(rootPath);
    }
  });

  async function enter(e: WebdavEntry): Promise<void> {
    if (e.is_dir) {
      await load(e.path);
      return;
    }
    if (busyPath !== "" || !conn) return;
    busyPath = e.path;
    error = "";
    try {
      const content = await webdavDownload(conn, e.path);
      onOpen(e.path, content);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyPath = "";
    }
  }

  function goUp(): void {
    const p = path.replace(/\/+$/, "");
    if (p === rootPath) return;
    const cut = p.slice(0, p.lastIndexOf("/"));
    void load(cut.length < rootPath.length ? rootPath : cut);
  }

  const atRoot = $derived(path.replace(/\/+$/, "") === rootPath);
</script>

<div class="cloud">
  {#if !dav}
    <div class="hint">{t("WebDAV is not configured yet. Fill it in and test the connection under Settings → Cloud Sync.")}</div>
  {:else}
    <div class="bar">
      <button class="icon" title={t("Up")} disabled={loading || atRoot} onclick={goUp}>↑</button>
      <span class="crumb" title={path}>{path}</span>
      <button class="icon" title={t("Refresh")} disabled={loading} onclick={() => void load(path)}>⟳</button>
    </div>

    {#if error}
      <div class="hint error">{error}</div>
    {/if}

    {#if loading}
      <div class="hint">{t("Loading…")}</div>
    {:else if entries.length === 0}
      {#if error === ""}<div class="hint">{t("Empty folder")}</div>{/if}
    {:else}
      {#each entries as e (e.path)}
        <button
          class="row"
          class:dir={e.is_dir}
          disabled={busyPath !== ""}
          title={e.path}
          onclick={() => void enter(e)}
        >
          <span class="name">{e.name}{e.is_dir ? "/" : ""}</span>
          {#if busyPath === e.path}<span class="busy">…</span>{/if}
        </button>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .cloud {
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-size: 0.8125rem;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--border, #ddd);
  }

  .bar .crumb {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.6;
    direction: rtl; /* 路径过长时优先显示末尾（当前目录名） */
    text-align: left;
  }

  .icon {
    flex: 0 0 auto;
    width: 1.4rem;
    height: 1.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    color: inherit;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0.75;
  }

  .icon:hover:not(:disabled) {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  .icon:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.28rem 0.6rem;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row:hover:not(:disabled) {
    background: var(--hover, rgba(127, 127, 127, 0.15));
  }

  .row:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .row .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row.dir .name {
    font-weight: 600;
  }

  .row .busy {
    opacity: 0.5;
  }

  .hint {
    padding: 0.6rem;
    opacity: 0.6;
    line-height: 1.5;
  }

  .hint.error {
    color: var(--danger, #c0392b);
    opacity: 1;
  }
</style>