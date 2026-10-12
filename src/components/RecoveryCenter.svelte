<script lang="ts">
  /**
   * 恢复中心：把「恢复草稿」与「本地版本历史」合并到一个面板，
   * 每条都能先预览，再决定恢复 / 另存 / 删除。
   *
   * 与 App.svelte 的分工：本组件只管「列举、读取、删除、另存」这些离线文件操作；
   * 「恢复」刻意不在这里落盘——通过 onRestore 回调交给应用层在编辑器里打开成
   * 未保存文档，走应用原有的标签 / 脏标记 / 写盘保护，避免绕开它们直接改磁盘。
   *
   * 样式自成一体：Svelte 样式按组件作用域隔离，颜色仍走全局 CSS 变量以跟随主题。
   */
  import { onMount } from "svelte";
  import { confirm as confirmDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
  import { makeT, type Locale } from "../lib/i18n";
  import { isCodePath } from "../lib/codeLang";
  import {
    deleteHistory,
    deleteRecovery,
    listAllHistory,
    listRecovery,
    readHistory,
    readRecovery,
    restoreHistory,
    writeTextFile,
    type HistoryDoc,
    type HistoryEntry,
    type RecoveryMeta,
  } from "../lib/tauri-api";

  interface Props {
    locale: Locale;
    /** 恢复：把内容载入编辑器（应用层负责新建标签、标记未保存、不直接写盘） */
    onRestore: (payload: {
      content: string;
      kind: string;
      path: string | null;
      encoding?: string;
    }) => void;
    onClose: () => void;
  }
  let { locale, onRestore, onClose }: Props = $props();

  const t = $derived(makeT(locale));

  let tab = $state<"draft" | "history">("draft");
  let drafts = $state<RecoveryMeta[]>([]);
  let docs = $state<HistoryDoc[]>([]);
  let loading = $state(true);
  let error = $state("");
  let busyKey = $state(""); // 正在处理的行标识，防重复点击
  let expanded = $state(""); // 展开的历史文档路径（一次只展开一个）

  // 预览：null = 未打开。内容只读展示，不参与编辑。
  let preview = $state<{ title: string; content: string } | null>(null);

  async function reload(): Promise<void> {
    loading = true;
    error = "";
    try {
      const [d, h] = await Promise.all([listRecovery(), listAllHistory()]);
      drafts = d;
      docs = h;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function timeText(sec: number): string {
    if (!sec) return "-";
    return new Date(sec * 1000).toLocaleString();
  }

  function sizeText(n: number): string {
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${Math.round(n / 1024)} KB`;
    return `${n} B`;
  }

  /** 由原文档路径推断文档类型（决定恢复时用哪种视图打开） */
  function kindOf(path: string): string {
    const dot = path.lastIndexOf(".");
    const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
    if (ext === "html" || ext === "htm") return "html";
    return isCodePath(path) ? "code" : "markdown";
  }

  // ---- 预览 ----

  async function previewDraft(m: RecoveryMeta): Promise<void> {
    busyKey = `d:${m.id}`;
    error = "";
    try {
      const content = await readRecovery(m.id);
      if (content === null) throw new Error(t("草稿正文已不存在"));
      preview = { title: m.title || t("未命名文档"), content };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyKey = "";
    }
  }

  async function previewHist(d: HistoryDoc, e: HistoryEntry): Promise<void> {
    busyKey = `h:${d.path}:${e.file}`;
    error = "";
    try {
      preview = {
        title: `${d.name} · ${timeText(e.saved_at)}`,
        content: await readHistory(d.path, e.file),
      };
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyKey = "";
    }
  }

  // ---- 恢复（交给应用层打开成未保存文档）----

  async function restoreDraft(m: RecoveryMeta): Promise<void> {
    busyKey = `d:${m.id}`;
    error = "";
    try {
      const content = await readRecovery(m.id);
      if (content === null) throw new Error(t("草稿正文已不存在"));
      onRestore({ content, kind: m.kind, path: m.path, encoding: m.encoding });
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyKey = "";
    }
  }

  async function restoreHist(d: HistoryDoc, e: HistoryEntry): Promise<void> {
    busyKey = `h:${d.path}:${e.file}`;
    error = "";
    try {
      // restoreHistory 会先把当前磁盘内容再留一份档，保证这次恢复可撤销
      const content = await restoreHistory(d.path, e.file);
      onRestore({ content, kind: kindOf(d.path), path: d.path });
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyKey = "";
    }
  }

  // ---- 另存为 ----

  async function saveAs(defaultPath: string, content: string, encoding: string): Promise<void> {
    const path = await saveDialog({ title: t("另存为…"), defaultPath });
    if (!path) return; // 用户取消
    await writeTextFile(path, content, encoding);
  }

  async function saveDraftAs(m: RecoveryMeta): Promise<void> {
    busyKey = `d:${m.id}`;
    error = "";
    try {
      const content = await readRecovery(m.id);
      if (content === null) throw new Error(t("草稿正文已不存在"));
      await saveAs(m.path ?? m.title, content, m.encoding || "utf-8");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyKey = "";
    }
  }

  async function saveHistAs(d: HistoryDoc, e: HistoryEntry): Promise<void> {
    busyKey = `h:${d.path}:${e.file}`;
    error = "";
    try {
      // 历史版本回来的是解码后的文本，统一按 UTF-8 另存
      await saveAs(d.name || "untitled", await readHistory(d.path, e.file), "utf-8");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyKey = "";
    }
  }

  // ---- 删除 ----

  async function removeDraft(m: RecoveryMeta): Promise<void> {
    const ok = await confirmDialog(t("确认删除草稿「{title}」？删除后无法恢复。", { title: m.title }), {
      title: "Sticho",
      kind: "warning",
      okLabel: t("删除"),
      cancelLabel: t("取消"),
    });
    if (!ok) return;
    error = "";
    try {
      await deleteRecovery(m.id);
      drafts = drafts.filter((x) => x.id !== m.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function removeHist(d: HistoryDoc, e: HistoryEntry): Promise<void> {
    const ok = await confirmDialog(t("确认删除该历史版本？删除后无法恢复。"), {
      title: "Sticho",
      kind: "warning",
      okLabel: t("删除"),
      cancelLabel: t("取消"),
    });
    if (!ok) return;
    error = "";
    try {
      await deleteHistory(d.path, e.file);
      // 本地剔除，避免整表重读；某文档一份不剩时把整组也去掉
      docs = docs
        .map((x) =>
          x.path === d.path ? { ...x, entries: x.entries.filter((y) => y.file !== e.file) } : x,
        )
        .filter((x) => x.entries.length > 0);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  onMount(() => {
    void reload();
  });
</script>

<div
  class="rc-mask"
  role="none"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div class="rc-modal" role="dialog" aria-label={t("恢复中心")}>
    <div class="rc-head">
      <span>{t("恢复中心")}</span>
      <button class="rc-x" title={t("关闭（Esc）")} aria-label={t("关闭")} onclick={onClose}>✕</button>
    </div>

    <div class="rc-tabs">
      <button class:active={tab === "draft"} onclick={() => (tab = "draft")}>
        {t("恢复草稿")}{drafts.length ? ` (${drafts.length})` : ""}
      </button>
      <button class:active={tab === "history"} onclick={() => (tab = "history")}>
        {t("本地版本历史")}{docs.length ? ` (${docs.length})` : ""}
      </button>
      <button class="rc-refresh" disabled={loading} onclick={() => void reload()}>{t("刷新")}</button>
    </div>

    <div class="rc-body">
      {#if error}<p class="rc-err">{error}</p>{/if}

      {#if preview}
        <div class="rc-preview">
          <div class="rc-preview-head">
            <span class="rc-preview-title" title={preview.title}>{preview.title}</span>
            <button class="rc-mini" onclick={() => (preview = null)}>{t("关闭预览")}</button>
          </div>
          <pre class="rc-pre">{preview.content}</pre>
        </div>
      {:else if loading}
        <p class="rc-hint">{t("读取中…")}</p>
      {:else if tab === "draft"}
        {#if drafts.length === 0}
          <p class="rc-hint">{t("暂无恢复草稿")}</p>
        {:else}
          <ul class="rc-list">
            {#each drafts as m (m.id)}
              <li class="rc-item">
                <div class="rc-row">
                  <div class="rc-main">
                    <span class="rc-name">{m.title || t("未命名文档")}</span>
                    <span class="rc-sub">{timeText(m.saved_at)} · {t("{n} 字", { n: m.chars })}</span>
                    {#if m.path}<span class="rc-path" title={m.path}>{m.path}</span>{/if}
                  </div>
                  <div class="rc-acts">
                    <button class="rc-mini" disabled={busyKey !== ""} onclick={() => void previewDraft(m)}>{t("预览")}</button>
                    <button class="rc-mini" disabled={busyKey !== ""} onclick={() => void restoreDraft(m)}>{t("恢复")}</button>
                    <button class="rc-mini" disabled={busyKey !== ""} onclick={() => void saveDraftAs(m)}>{t("另存为…")}</button>
                    <button class="rc-mini danger" onclick={() => void removeDraft(m)}>{t("删除")}</button>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if docs.length === 0}
        <p class="rc-hint">{t("暂无本地版本历史")}</p>
      {:else}
        <ul class="rc-list">
          {#each docs as d (d.path)}
            <li class="rc-item">
              <div class="rc-row">
                <button
                  class="rc-name rc-doc"
                  title={d.path}
                  onclick={() => (expanded = expanded === d.path ? "" : d.path)}
                >
                  {expanded === d.path ? "▾" : "▸"} {d.name}
                </button>
                <span class="rc-sub">{t("{n} 个版本", { n: d.entries.length })}</span>
              </div>
              {#if expanded === d.path}
                <div class="rc-versions">
                  {#each d.entries as e (e.file)}
                    <div class="rc-row rc-vrow">
                      <div class="rc-main">
                        <span class="rc-sub">{timeText(e.saved_at)} · {sizeText(e.size)}</span>
                      </div>
                      <div class="rc-acts">
                        <button class="rc-mini" disabled={busyKey !== ""} onclick={() => void previewHist(d, e)}>{t("预览")}</button>
                        <button class="rc-mini" disabled={busyKey !== ""} onclick={() => void restoreHist(d, e)}>{t("恢复")}</button>
                        <button class="rc-mini" disabled={busyKey !== ""} onclick={() => void saveHistAs(d, e)}>{t("另存为…")}</button>
                        <button class="rc-mini danger" onclick={() => void removeHist(d, e)}>{t("删除")}</button>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="rc-foot">
      {t("草稿与版本历史都存放在本机数据目录，离线可用；恢复后以未保存的新文档打开，需手动保存。")}
    </div>
  </div>
</div>

<style>
  .rc-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    z-index: 620;
  }

  .rc-modal {
    display: flex;
    flex-direction: column;
    width: 680px;
    max-width: 94vw;
    max-height: 84vh;
    background: var(--bg, #fff);
    color: var(--fg, #1f2328);
    border: 1px solid var(--border, #ddd);
    border-radius: 10px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .rc-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.5rem 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border, #ddd);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .rc-x {
    width: 1.7rem;
    height: 1.7rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .rc-x:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .rc-tabs {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border, #ddd);
  }

  .rc-tabs button {
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .rc-tabs button:hover:not(:disabled) {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .rc-tabs button.active {
    border-color: var(--accent, #3b82f6);
    color: var(--accent, #3b82f6);
  }

  .rc-tabs button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .rc-refresh {
    margin-left: auto;
  }

  .rc-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem 0.8rem;
  }

  .rc-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .rc-item + .rc-item {
    border-top: 1px solid var(--border, #ddd);
  }

  .rc-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0;
    font-size: 0.8125rem;
  }

  .rc-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .rc-name {
    font: inherit;
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rc-doc {
    flex: 1;
    min-width: 0;
    text-align: left;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    padding: 0.15rem 0.3rem;
    font-weight: 600;
    cursor: pointer;
  }

  .rc-doc:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .rc-sub {
    font-size: 0.72rem;
    opacity: 0.65;
    white-space: nowrap;
  }

  .rc-path {
    font-size: 0.7rem;
    opacity: 0.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rc-acts {
    display: flex;
    flex-shrink: 0;
    gap: 0.3rem;
  }

  .rc-mini {
    flex-shrink: 0;
    padding: 0.15rem 0.45rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font-size: 0.7rem;
    cursor: pointer;
  }

  .rc-mini:hover:not(:disabled) {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .rc-mini:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .rc-mini.danger {
    color: var(--danger, #c0392b);
  }

  .rc-versions {
    margin: 0 0 0.4rem 0.8rem;
    padding: 0.2rem 0.5rem;
    border-left: 2px solid var(--border, #ddd);
  }

  .rc-vrow {
    font-size: 0.75rem;
  }

  .rc-hint {
    font-size: 0.78rem;
    opacity: 0.6;
    padding: 0.4rem 0;
  }

  .rc-err {
    font-size: 0.75rem;
    color: var(--danger, #c0392b);
    padding: 0.3rem 0;
    word-break: break-all;
  }

  .rc-preview {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .rc-preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border, #ddd);
  }

  .rc-preview-title {
    font-size: 0.78rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rc-pre {
    flex: 1;
    margin: 0.5rem 0 0;
    padding: 0.5rem;
    max-height: 60vh;
    overflow: auto;
    background: var(--code-bg, rgba(0, 0, 0, 0.04));
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .rc-foot {
    padding: 0.5rem 0.8rem;
    border-top: 1px solid var(--border, #ddd);
    font-size: 0.72rem;
    opacity: 0.6;
  }
</style>