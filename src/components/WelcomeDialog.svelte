<script lang="ts">
  /**
   * 入门指南 / 欢迎页（单页，不做多步向导）。
   *
   * 只负责「渲染 + 触发」：语言与应用版本由 props 传入，点「开始使用」或关闭按钮
   * 时回调 onClose，真正的显隐与持久化都留在应用层。
   *
   * 样式自带的原因：Svelte 的样式作用域按组件划分，父组件里的 `.modal-*` 选择器
   * 不会落到本组件的元素上，因此把用到的模态骨架样式连同 markup 一起搬来一份。
   * 颜色仍走全局 CSS 变量，主题自动跟随。
   */
  import { makeT, type Locale } from "../lib/i18n";

  interface Props {
    locale: Locale;
    /** 语言包合并词表（内置 + locales/ 下的语言包）：由 App 注入，缺省时回落内置词表 */
    i18nEntries?: Record<string, string>;
    appVersion: string;
    onClose: () => void;
  }

  let { locale, i18nEntries, appVersion, onClose }: Props = $props();

  const t = $derived(makeT(locale, i18nEntries));

  /** 要点清单（纯展示数据，随组件自带）：短标题 + 说明各占一行 */
  const HIGHLIGHTS: { title: string; desc: string }[] = [
    {
      title: "Create or open a document",
      desc: "Use the toolbar or the File menu; you can also drag a file into the window.",
    },
    {
      title: "Quick formatting",
      desc: "Ctrl+B bold, Ctrl+I italic, Ctrl+K link, Ctrl+Shift+K code block, Ctrl+1~6 headings.",
    },
    { title: "Command Palette", desc: "Press Ctrl+P to search for and run any command in the menus." },
    {
      title: "Search in Files",
      desc: "The sidebar's “Search” tab looks through the full text of the current folder.",
    },
    {
      title: "Export and cloud sync",
      desc: "Export to Word / PDF / HTML, and sync documents to a WebDAV cloud folder.",
    },
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
  <div class="modal modal--welcome" role="dialog" aria-label={t("Welcome to Sticho")}>
    <div class="modal-head">
      <span>{t("Welcome to Sticho")}</span>
      <button class="icon-btn" title={t("Close (Esc)")} aria-label={t("Close")} onclick={onClose}>✕</button>
    </div>

    <div class="modal-body">
      <p class="welcome-intro">{t("A lightweight Markdown / plain text / code / HTML document editor; all conversions happen on your machine.")}</p>

      <ul class="welcome-list">
        {#each HIGHLIGHTS as item (item.title)}
          <li class="welcome-item">
            <span class="welcome-item-title">{t(item.title)}</span>
            <span class="welcome-item-desc">{t(item.desc)}</span>
          </li>
        {/each}
      </ul>
    </div>

    <div class="modal-foot welcome-foot">
      <button class="welcome-primary" onclick={onClose}>{t("Get Started")}</button>
      <div class="welcome-version">Sticho {appVersion}</div>
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
    background: var(--overlay, rgba(0, 0, 0, 0.35));
    /* 欢迎页层级高于设置面板，保证首次启动时盖在最上层 */
    z-index: 640;
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

  /* 欢迎页：内容以单栏列表呈现，宽度与高度都按阅读舒适度收紧 */
  .modal--welcome {
    width: 520px;
    max-width: 92vw;
    max-height: 80vh;
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

  /* ---- 欢迎页内容 ---- */
  .welcome-intro {
    margin-bottom: 0.9rem;
    font-size: 0.8125rem;
    line-height: 1.5;
    opacity: 0.75;
  }

  .welcome-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .welcome-item {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border, #ddd);
  }

  .welcome-item:last-child {
    border-bottom: none;
  }

  .welcome-item-title {
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .welcome-item-desc {
    font-size: 0.75rem;
    line-height: 1.5;
    opacity: 0.6;
  }

  /* ---- 底部：主按钮 + 版本号 ---- */
  .welcome-foot {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.35rem;
    opacity: 1;
  }

  .welcome-primary {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.35rem 0.9rem;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .welcome-primary:hover {
    opacity: 0.9;
  }

  .welcome-primary:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--focus-ring, rgba(37, 99, 235, 0.35));
  }

  .welcome-version {
    font-size: 0.75rem;
    opacity: 0.6;
  }
</style>