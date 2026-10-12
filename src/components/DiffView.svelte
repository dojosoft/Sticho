<script lang="ts">
  /**
   * 版本差异视图（批次三）：把 diff.ts 算出的逐行差异渲染成一个只读模态。
   *
   * 纯展示组件：差异计算在调用方完成（本地历史用 read_history + 当前正文，
   * 云版本用 webdav_fetch_version + 远端当前正文），这里只负责排版。
   * 样式自成一体，颜色走全局 CSS 变量以跟随主题。
   */
  import { makeT, type Locale } from "../lib/i18n";
  import type { DiffLine } from "../lib/diff";

  interface Props {
    locale: Locale;
    title: string;
    /** 左侧（旧）标题，如「历史版本」 */
    leftLabel: string;
    /** 右侧（新）标题，如「当前内容」 */
    rightLabel: string;
    lines: DiffLine[];
    onClose: () => void;
  }
  let { locale, title, leftLabel, rightLabel, lines, onClose }: Props = $props();

  const t = $derived(makeT(locale));

  // 一次遍历求出增删统计，避免在模板里重复过滤整表
  const stats = $derived.by(() => {
    let added = 0;
    let removed = 0;
    let same = 0;
    for (const line of lines) {
      if (line.type === "add") added++;
      else if (line.type === "del") removed++;
      else same++;
    }
    return { added, removed, same };
  });
</script>

<div
  class="dv-mask"
  role="none"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div class="dv-modal" role="dialog" aria-label={title}>
    <div class="dv-head">
      <span>{title}</span>
      <button class="dv-x" title={t("关闭（Esc）")} aria-label={t("关闭")} onclick={onClose}>✕</button>
    </div>

    <div class="dv-bar">
      <span class="dv-legend">{leftLabel} → {rightLabel}</span>
      <span class="dv-stats">
        <span class="dv-add">+{stats.added}</span>
        <span class="dv-del">−{stats.removed}</span>
        <span class="dv-same">{t("未变 {n} 行", { n: stats.same })}</span>
      </span>
    </div>

    <div class="dv-body">
      {#if stats.added === 0 && stats.removed === 0}
        <p class="dv-empty">{t("两个版本内容完全相同")}</p>
      {:else}
        {#each lines as line, i (i)}
          <div class="dv-line dv-line--{line.type}">
            <span class="dv-num">{line.oldLine ?? ""}</span>
            <span class="dv-num">{line.newLine ?? ""}</span>
            <span class="dv-sign">{line.type === "add" ? "+" : line.type === "del" ? "−" : " "}</span>
            <span class="dv-text">{line.text}</span>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .dv-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    z-index: 700;
  }

  .dv-modal {
    display: flex;
    flex-direction: column;
    width: 760px;
    max-width: 94vw;
    height: 78vh;
    background: var(--bg, #fff);
    color: var(--fg, #1f2328);
    border: 1px solid var(--border, #ddd);
    border-radius: 10px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .dv-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.5rem 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border, #ddd);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .dv-x {
    width: 1.7rem;
    height: 1.7rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .dv-x:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .dv-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.4rem 0.8rem;
    border-bottom: 1px solid var(--border, #ddd);
    font-size: 0.75rem;
    opacity: 0.85;
  }

  .dv-legend {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dv-stats {
    display: flex;
    gap: 0.6rem;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .dv-add {
    color: var(--accent, #2563eb);
  }

  .dv-del {
    color: var(--danger, #c0392b);
  }

  .dv-same {
    opacity: 0.7;
  }

  .dv-body {
    flex: 1;
    overflow: auto;
    padding: 0.4rem 0;
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .dv-empty {
    padding: 0.6rem 0.8rem;
    opacity: 0.6;
  }

  .dv-line {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    padding: 0 0.6rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .dv-num {
    flex-shrink: 0;
    width: 2.6rem;
    text-align: right;
    opacity: 0.4;
    user-select: none;
  }

  .dv-sign {
    flex-shrink: 0;
    width: 0.8rem;
    text-align: center;
    user-select: none;
  }

  .dv-text {
    flex: 1;
    min-width: 0;
  }

  .dv-line--add {
    background: rgba(37, 99, 235, 0.12);
  }

  .dv-line--add .dv-sign {
    color: var(--accent, #2563eb);
  }

  .dv-line--del {
    background: rgba(192, 57, 43, 0.12);
  }

  .dv-line--del .dv-sign {
    color: var(--danger, #c0392b);
  }
</style>