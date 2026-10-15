<script lang="ts">
  /**
   * 侧边栏「书签」视图：列出当前文档内的书签，并提供一个「添加为书签」按钮。
   *
   * 每条由应用层解析文档得到（label = 序号 / 行号，detail = 片段文本），
   * 本组件只负责渲染；点击一行即跳转到该处、点行尾的 ✕ 删除该条（回调由应用层提供）。
   */
  type Props = {
    /** 文档内书签清单，点击跳转；onRemove 存在时渲染单条删除按钮 */
    items: { label: string; detail?: string; onClick: () => void; onRemove?: () => void }[];
    /** 在光标处（无光标则本页最上方起始位置）添加一条书签；未传入时不显示按钮 */
    onAdd?: () => void;
    /** 当前文档是否支持书签（HTML / 大文档阅读通路为 false，按钮置灰） */
    canAdd?: boolean;
    /** 界面翻译函数（以英文原文为键）；未传入时原样返回 */
    t?: (key: string, vars?: Record<string, string | number>) => string;
  };
  let { items, onAdd, canAdd = false, t = (s: string) => s }: Props = $props();
</script>

{#if onAdd}
  <div class="bm-head">
    <!-- mousedown 阻止默认：避免点按钮时把焦点从编辑器挪走，好让「光标处」仍可抓到 -->
    <button
      class="bm-add"
      class:is-disabled={!canAdd}
      aria-disabled={!canAdd}
      title={t("Add Bookmark")}
      onmousedown={(e) => e.preventDefault()}
      onclick={() => canAdd && onAdd()}
    >
      {t("Add Bookmark")}
    </button>
  </div>
{/if}

{#if items.length === 0}
  <div class="hint">{t("No bookmarks in this document")}</div>
{:else}
  {#each items as item, i (i)}
    <div class="bm-row">
      <button class="bm-item" onclick={() => item.onClick()} title={item.detail ?? item.label}>
        <span class="bm-label">{item.label}</span>
        {#if item.detail}<span class="bm-detail">{item.detail}</span>{/if}
      </button>
      {#if item.onRemove}
        <button class="bm-del" title={t("Delete")} aria-label={t("Delete")} onclick={() => item.onRemove?.()}>✕</button>
      {/if}
    </div>
  {/each}
{/if}

<style>
  .bm-head {
    padding: 0 0.5rem 0.35rem;
    border-bottom: 1px solid var(--border, #ddd);
    margin-bottom: 0.3rem;
  }

  .bm-add {
    width: 100%;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.22rem 0.4rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .bm-add:hover:not(.is-disabled) {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  /* 不可用项：置灰且不响应（与菜单 / 工具栏按钮同一套观感） */
  .bm-add.is-disabled {
    opacity: 0.4;
    cursor: default;
  }

  .hint {
    padding: 0.4rem 0.6rem;
    font-size: 0.75rem;
    opacity: 0.65;
    line-height: 1.5;
  }

  .bm-row {
    display: flex;
    align-items: baseline;
  }

  .bm-item {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    flex: 1;
    min-width: 0;
    text-align: left;
    font: inherit;
    font-size: 0.75rem;
    padding: 0.18rem 0.5rem;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .bm-item:hover,
  .bm-del:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .bm-label {
    flex: 0 0 auto;
    opacity: 0.55;
  }

  .bm-detail {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bm-del {
    flex: 0 0 auto;
    font: inherit;
    font-size: 0.7rem;
    line-height: 1;
    padding: 0.18rem 0.4rem;
    border: none;
    background: transparent;
    color: inherit;
    opacity: 0.55;
    cursor: pointer;
  }

  .bm-del:hover {
    opacity: 1;
  }
</style>
