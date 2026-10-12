<script lang="ts">
  /**
   * 命令面板（菜单命令的快速检索与执行）。
   *
   * 与 App.svelte 的分工：面板只负责「渲染 + 模糊筛选 + 键盘选择」，
   * 命令清单（label / category / shortcut）与执行动作（run 回调）都由父级传入。
   * Esc / Enter / 点遮罩的关闭一律回调 onClose，由父级统一处理打开状态。
   *
   * 样式自带的原因：Svelte 的样式作用域按组件划分，App.svelte 样式块里的
   * `.modal-*` 选择器不会落到本组件的元素上，因此这里把模态骨架样式连同
   * markup 一起复制一份进来。颜色仍走全局 CSS 变量，主题自动跟随。
   */
  import { makeT, type Locale } from "../lib/i18n";
  import { fuzzyRank } from "../lib/fuzzy";

  /** 面板里的一条命令（label 已由父级 t() 处理为当前语言文案） */
  export type PaletteCommand = {
    id: string;
    label: string;
    category: string;
    shortcut?: string;
    run: () => void;
  };

  interface Props {
    locale: Locale;
    commands: PaletteCommand[];
    onClose: () => void;
  }
  let { locale, commands, onClose }: Props = $props();

  const t = $derived(makeT(locale));

  /** 最多渲染条数：面板要轻量，超出部分不渲染 */
  const MAX_RESULTS = 50;

  /** 输入框里的查询串 */
  let query = $state("");
  /** 当前选中项下标（相对 visible 数组） */
  let activeIndex = $state(0);
  /** 输入框元素，用于打开即聚焦 */
  let inputEl = $state<HTMLInputElement | null>(null);

  /** 过滤排序结果：空查询时 fuzzyRank 给 0 分并保持原顺序，等同全量目录 */
  const visible = $derived(
    fuzzyRank(query, commands, (c) => `${c.category} ${c.label}`).slice(0, MAX_RESULTS),
  );

  /** 打开即聚焦输入框（bind:this 赋值后 effect 会重新执行并聚焦） */
  $effect(() => {
    inputEl?.focus();
  });

  /** 选中项若因结果变少而越界，回拉到末条，避免 Enter 落空 */
  $effect(() => {
    const len = visible.length;
    if (activeIndex > len - 1) activeIndex = Math.max(0, len - 1);
  });

  /** 执行指定命令并关闭面板 */
  function run(cmd: PaletteCommand) {
    cmd.run();
    onClose();
  }

  /** 键盘导航：上下循环移动、Enter 执行、Esc 关闭 */
  function onKeydown(e: KeyboardEvent) {
    const len = visible.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (len > 0) activeIndex = (activeIndex + 1) % len;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (len > 0) activeIndex = (activeIndex - 1 + len) % len;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = visible[activeIndex];
      if (cmd) run(cmd);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

<div
  class="modal-mask"
  role="none"
  onclick={(e) => {
    // 只有点在遮罩本身（而非面板内部）时才关闭
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div class="modal modal--palette" role="dialog" aria-label={t("命令面板")}>
    <div class="modal-head">
      <span>{t("命令面板")}</span>
      <button class="icon-btn" title={t("关闭（Esc）")} aria-label={t("关闭")} onclick={onClose}>✕</button>
    </div>

    <div class="palette-search">
      <input
        bind:this={inputEl}
        class="palette-input"
        type="text"
        placeholder={t("输入命令名称…")}
        bind:value={query}
        oninput={() => (activeIndex = 0)}
        onkeydown={onKeydown}
      />
    </div>

    <div class="modal-body palette-list">
      {#if visible.length === 0}
        <p class="palette-empty">{t("没有匹配的命令")}</p>
      {:else}
        {#each visible as cmd, i (cmd.id)}
          <button
            class="palette-item"
            class:active={i === activeIndex}
            onclick={() => run(cmd)}
            onmouseenter={() => (activeIndex = i)}
          >
            <span class="palette-label">{cmd.label}</span>
            <span class="palette-cat">{cmd.category}</span>
            {#if cmd.shortcut}<span class="palette-key">{cmd.shortcut}</span>{/if}
          </button>
        {/each}
      {/if}
    </div>
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
    /* 高于设置面板（600），命令面板应压在其它对话框之上 */
    z-index: 650;
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

  /* 命令面板：宽扁的搜索列表形态 */
  .modal--palette {
    width: 560px;
    max-width: 92vw;
    max-height: 70vh;
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

  /* ---- 命令面板骨架 ---- */
  .palette-search {
    padding: 0.6rem 0.8rem;
    border-bottom: 1px solid var(--border, #ddd);
  }

  .palette-input {
    width: 100%;
    font: inherit;
    font-size: 0.875rem;
    padding: 0.45rem 0.6rem;
    color: inherit;
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .palette-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18);
  }

  /* 结果列表：占满剩余高度并可滚动（min-height 让 flex 子项正确收缩） */
  .palette-list {
    flex: 1;
    min-height: 0;
    padding: 0.3rem;
    overflow: auto;
  }

  .palette-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.4rem 0.6rem;
    font: inherit;
    font-size: 0.8125rem;
    text-align: left;
    color: inherit;
    background: transparent;
    /* 左侧强调竖条：默认透明占位，选中时才显色 */
    border: none;
    border-left: 3px solid transparent;
    border-radius: 6px;
    cursor: pointer;
  }

  /* 选中态：淡底 + 左侧强调竖条，方向键移动时观感明确 */
  .palette-item.active {
    background: var(--hover, rgba(0, 0, 0, 0.07));
    border-left-color: var(--accent);
  }

  .palette-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 所属菜单：次要信息，减弱透明度且不换行 */
  .palette-cat {
    flex-shrink: 0;
    font-size: 0.6875rem;
    opacity: 0.55;
    white-space: nowrap;
  }

  /* 快捷键：右侧灰字，可能为空 */
  .palette-key {
    flex-shrink: 0;
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.6875rem;
    opacity: 0.55;
    white-space: nowrap;
  }

  .palette-empty {
    padding: 1.2rem 0;
    font-size: 0.8125rem;
    text-align: center;
    opacity: 0.6;
  }
</style>