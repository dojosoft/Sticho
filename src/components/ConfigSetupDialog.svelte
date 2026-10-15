<script lang="ts">
  /**
   * 首次运行引导：选择配置文件保存位置（便携 / 系统目录）。
   *
   * 只在启动时探测到两处都没有配置时出现，且**不可关闭**——数据根未定之前应用无法
   * 读写设置、主题与语言包。用户选定后由应用层调用 setup_config_location 落地并放行
   * 启动流程（无需重启）。
   *
   * 样式自带的原因与 WelcomeDialog 同：Svelte 作用域样式不会继承，这里把用到的模态
   * 骨架样式随组件搬一份；颜色走全局 CSS 变量，主题自动跟随。
   */
  import { makeT, type Locale } from "../lib/i18n";
  import type { DataLocationMode } from "../lib/tauri-api";

  interface Props {
    locale: Locale;
    /** 语言包合并词表（内置 + locales/ 下的语言包）：由 App 注入，缺省时回落内置词表 */
    i18nEntries?: Record<string, string>;
    /** 可选语言清单（内置 + locales/ 下的语言包） */
    localeOptions: { id: string; label: string }[];
    /** 用户在引导里切换界面语言（此刻数据根未定，只改内存状态，位置落地后再持久化） */
    onSelectLocale: (id: Locale) => void;
    /** 提交中：禁用两个按钮，防止重复点击 */
    busy: boolean;
    /** 失败提示（为空则不显示） */
    tip: string;
    /** 用户选定某种位置 */
    onChoose: (mode: DataLocationMode) => void;
  }

  let { locale, i18nEntries, localeOptions, onSelectLocale, busy, tip, onChoose }: Props = $props();

  const t = $derived(makeT(locale, i18nEntries));

  /** 两个可选位置（纯展示数据）：标题 / 副标题 / 说明 / 模式 */
  const OPTIONS: {
    mode: DataLocationMode;
    title: string;
    sub: string;
    desc: string;
  }[] = [
    {
      mode: "portable",
      title: "Program folder (portable)",
      sub: "the Sticho folder next to the program",
      desc: "Config travels with the program — copy it to a USB drive or another PC and it is kept; nothing is written to the system folder.",
    },
    {
      mode: "user",
      title: "System folder (recommended)",
      sub: "%APPDATA%\\Sticho",
      desc: "Tied to the current Windows user; works even when the program is installed in a read-only location such as Program Files.",
    },
  ];
</script>

<div class="modal-mask" role="none">
  <div class="modal" role="dialog" aria-modal="true" aria-label={t("Choose where to save configuration")}>
    <div class="modal-head"><span>{t("Choose where to save configuration")}</span></div>

    <div class="modal-body">
      <div class="lang-row">
        <span class="lang-label">{t("Interface Language")}</span>
        <select
          class="lang-select"
          value={locale}
          onchange={(e) => onSelectLocale(e.currentTarget.value)}
        >
          {#each localeOptions as item (item.id)}
            <option value={item.id}>{item.label}</option>
          {/each}
        </select>
      </div>

      <p class="intro">
        {t("No existing configuration was found — this looks like the first run. Choose where Sticho should save its settings and data; an initial config file is created right away and startup continues (no restart needed).")}
      </p>

      <div class="options">
        {#each OPTIONS as opt (opt.mode)}
          <button
            type="button"
            class="option"
            disabled={busy}
            onclick={() => onChoose(opt.mode)}
          >
            <span class="option-title">{t(opt.title)}</span>
            <span class="option-sub">{opt.sub}</span>
            <span class="option-desc">{t(opt.desc)}</span>
          </button>
        {/each}
      </div>

      {#if tip}
        <p class="tip-error">{tip}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  /* ---- 模态骨架（与 App.svelte 通用件同款，随组件作用域自带一份）---- */
  .modal-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--overlay, rgba(0, 0, 0, 0.35));
    /* 高于欢迎页（640），确保首次运行时盖在最上层 */
    z-index: 700;
  }

  .modal {
    display: flex;
    flex-direction: column;
    width: 480px;
    max-width: 92vw;
    max-height: 82vh;
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 10px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .modal-head {
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--border, #ddd);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .modal-body {
    padding: 0.9rem;
    overflow: auto;
  }

  /* ---- 语言选择：先定界面语言，再看位置选项 ---- */
  .lang-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-bottom: 0.9rem;
    font-size: 0.8125rem;
  }

  .lang-label {
    font-weight: 600;
  }

  .lang-select {
    flex: 0 0 auto;
    min-width: 9rem;
    padding: 0.25rem 0.4rem;
    font: inherit;
    font-size: 0.8125rem;
    color: inherit;
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 6px;
  }

  .intro {
    margin-bottom: 0.9rem;
    font-size: 0.8125rem;
    line-height: 1.6;
    opacity: 0.75;
  }

  /* ---- 两个位置选项：整块可点，纵向卡片 ---- */
  .options {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.7rem 0.8rem;
    font: inherit;
    text-align: left;
    background: transparent;
    border: 1px solid var(--border, #ddd);
    border-radius: 8px;
    color: inherit;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }

  .option:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--hover, rgba(0, 0, 0, 0.04));
  }

  .option:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--focus-ring, rgba(37, 99, 235, 0.35));
  }

  .option:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .option-title {
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .option-sub {
    font-size: 0.75rem;
    opacity: 0.7;
    font-family: "Cascadia Mono", Consolas, ui-monospace, monospace;
  }

  .option-desc {
    font-size: 0.75rem;
    line-height: 1.5;
    opacity: 0.6;
  }

  .tip-error {
    margin-top: 0.8rem;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--danger, #c0392b);
  }
</style>