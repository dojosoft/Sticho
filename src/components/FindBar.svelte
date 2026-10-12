<script lang="ts">
  /**
   * 查找 / 替换操作栏。
   *
   * 与 App.svelte 的分工：这里只管「输入与按钮」，命中的查找、定位、替换全部由
   * 应用层完成（三种文档通路 Markdown / HTML / CodeMirror 各有实现），组件通过
   * 回调把它们注入。因此本组件不依赖 Vditor / CodeMirror，也不判断 docKind。
   *
   * 样式自带的类名（`.findbar` / `.f-*`）与 App.svelte 里的用法一致：Svelte 的
   * 样式作用域按组件划分，搬进本组件后必须连同 CSS 一起搬，否则选择器落不到元素上。
   * 颜色仍走全局 CSS 变量，主题切换自动跟随。
   */
  import { makeT, type Locale } from "../lib/i18n";

  interface Props {
    locale: Locale;
    /** 查找词（与父级双向绑定） */
    findText?: string;
    /** 替换词（与父级双向绑定） */
    replaceText?: string;
    /** 命中计数 / 「正则表达式无效」等提示 */
    findStatus: string;
    findCase: boolean;
    findWord: boolean;
    findRegex: boolean;
    /** 阅读（只读）模式下禁用替换 */
    browseMode: boolean;
    /** 输入内容变化 */
    onFindInput: () => void;
    /** 切换匹配开关（区分大小写 / 全词 / 正则） */
    onToggleFlag: (flag: "case" | "word" | "regex") => void;
    /** 下一个 / 上一个 */
    onNext: (backwards: boolean) => void;
    onReplaceOne: () => void;
    onReplaceAll: () => void;
    onClose: () => void;
  }

  let {
    locale,
    findText = $bindable(""),
    replaceText = $bindable(""),
    findStatus,
    findCase,
    findWord,
    findRegex,
    browseMode,
    onFindInput,
    onToggleFlag,
    onNext,
    onReplaceOne,
    onReplaceAll,
    onClose,
  }: Props = $props();

  const t = $derived(makeT(locale));

  const readonlyTip = $derived(t("阅读模式下不可直接编辑，请先切到编辑模式（Ctrl+E）"));
</script>

<div class="findbar">
  <input
    class="f-input"
    bind:value={findText}
    placeholder={t("查找内容")}
    oninput={onFindInput}
    onkeydown={(e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onNext(e.shiftKey);
      }
    }}
  />
  <span class="f-status">{findStatus}</span>
  <button class="f-toggle" class:active={findCase} title={t("区分大小写")} onclick={() => onToggleFlag("case")}>Aa</button>
  <button class="f-toggle" class:active={findWord} title={t("全词匹配")} onclick={() => onToggleFlag("word")}>W</button>
  <button class="f-toggle" class:active={findRegex} title={t("正则表达式")} onclick={() => onToggleFlag("regex")}>.*</button>
  <button onclick={() => onNext(false)} title="F3">{t("下一个")}</button>
  <button onclick={() => onNext(true)} title="Shift+F3">{t("上一个")}</button>
  <span class="f-divider"></span>
  <input class="f-input" bind:value={replaceText} placeholder={t("替换为")} />
  <button disabled={browseMode} title={browseMode ? readonlyTip : undefined} onclick={onReplaceOne}>
    {t("替换")}
  </button>
  <button disabled={browseMode} title={browseMode ? readonlyTip : undefined} onclick={onReplaceAll}>
    {t("全部替换")}
  </button>
  <span class="spacer"></span>
  <button class="f-close" onclick={onClose} title={t("关闭（Esc）")}>✕</button>
</div>

<style>
  .findbar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    background: var(--toolbar-bg, #f5f5f5);
    border-bottom: 1px solid var(--border, #ddd);
    flex-shrink: 0;
    font-size: 0.8125rem;
  }

  .findbar .f-input {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.2rem 0.5rem;
    width: 190px;
    color: var(--fg, #1f2328);
    background: var(--bg, #fff);
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    outline: none;
  }

  .findbar .f-input:focus {
    border-color: var(--accent);
  }

  .findbar button {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .findbar button:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .findbar .f-status {
    min-width: 4.5rem;
    opacity: 0.7;
    font-size: 0.75rem;
  }

  /* 三个匹配开关（批次五）：开启时用强调色描边，一眼能看出当前匹配口径 */
  .findbar .f-toggle {
    min-width: 1.9rem;
    padding: 0.2rem 0.35rem;
    font-family: Consolas, "Courier New", monospace;
    border: 1px solid var(--border, #ddd);
  }

  .findbar .f-toggle.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .findbar .f-divider {
    width: 1px;
    height: 1rem;
    background: var(--border, #ddd);
  }

  .findbar .f-close {
    opacity: 0.7;
  }

  /* 占满剩余空间，把关闭按钮推到最右 */
  .spacer {
    flex: 1;
  }
</style>