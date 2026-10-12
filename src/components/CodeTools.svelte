<script lang="ts">
  /**
   * 代码小工具面板（notepad4 对标）：Base64 / 进制转换 / GUID / 时间戳。
   *
   * 与 App.svelte 的分工：面板只管「算」，选中内容的读写通过两个回调注入
   * （`readSelection` / `writeText`），因此面板自己不依赖 CodeMirror，
   * 也不参与 docKind 判断——能不能写回由应用层的只读状态决定。
   *
   * 样式自成一体的原因：Svelte 的样式作用域按组件划分，App.svelte 里的
   * `.modal-mask` / `.modal` 选择器不会落到本组件的元素上。颜色仍走全局
   * CSS 变量（`--bg` / `--fg` / `--border` / `--hover`），主题切换自动跟随。
   */
  import { makeT, type Locale } from "../lib/i18n";
  import {
    base64Decode,
    base64Encode,
    formatInBase,
    newGuid,
    parseNumberInBase,
    timestampText,
    type StampKind,
  } from "../lib/codeTools";

  interface Props {
    locale: Locale;
    /** 取编辑器当前选中内容（无选中返回空串） */
    readSelection: () => string;
    /** 写回编辑器：有选中即替换选中，无选中即插入到光标处 */
    writeText: (text: string) => void;
    onClose: () => void;
  }
  let { locale, readSelection, writeText, onClose }: Props = $props();

  const t = $derived(makeT(locale));

  /* ---- Base64 ---- */
  let b64In = $state("");
  let b64Out = $state("");
  let b64Err = $state("");

  function runB64(mode: "encode" | "decode"): void {
    const res = mode === "encode" ? base64Encode(b64In) : base64Decode(b64In);
    if (res.ok) {
      b64Out = res.text;
      b64Err = "";
    } else {
      b64Out = "";
      b64Err = res.error;
    }
  }

  /* ---- 进制转换 ---- */
  const BASES = [2, 8, 10, 16];
  let numIn = $state("");
  let fromBase = $state(0); // 0 = 按前缀自动识别
  let toBase = $state(16);
  const numOut = $derived.by(() => {
    if (numIn.trim() === "") return { text: "", error: "" };
    const res = parseNumberInBase(numIn, fromBase);
    if (!res.ok) return { text: "", error: res.error };
    return { text: formatInBase(res.value, toBase), error: "" };
  });

  /* ---- GUID ---- */
  let guid = $state(newGuid());

  /* ---- 时间戳 ---- */
  const STAMPS: { id: StampKind; label: string }[] = $derived([
    { id: "local", label: t("本地时间 yyyy-MM-dd HH:mm:ss") },
    { id: "date", label: t("日期 yyyy-MM-dd") },
    { id: "time", label: t("时间 HH:mm:ss") },
    { id: "iso", label: t("ISO 8601（UTC）") },
    { id: "unix", label: t("Unix 秒") },
    { id: "unixms", label: t("Unix 毫秒") },
  ]);
  let stampKind = $state<StampKind>("local");
  let stampNow = $state(timestampText("local"));
  // 面板只在打开时存在，秒级刷新够用；组件销毁时由 $effect 的清理函数收尾
  $effect(() => {
    stampNow = timestampText(stampKind);
    const id = window.setInterval(() => {
      stampNow = timestampText(stampKind);
    }, 1000);
    return () => window.clearInterval(id);
  });

  /** 把文本塞进编辑器，并关掉面板（用户接下来多半要接着编辑正文） */
  function push(text: string): void {
    writeText(text);
    onClose();
  }
</script>

<div
  class="ct-mask"
  role="none"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div class="ct-modal" role="dialog" aria-label={t("代码工具")}>
    <div class="ct-head">
      <span>{t("代码工具")}</span>
      <button class="ct-x" title={t("关闭（Esc）")} aria-label={t("关闭")} onclick={onClose}>✕</button>
    </div>

    <div class="ct-body">
      <section class="ct-group">
        <h3>Base64</h3>
        <textarea bind:value={b64In} rows="3" placeholder={t("待处理的文本")}></textarea>
        <div class="ct-row">
          <button onclick={() => (b64In = readSelection())} title={t("把编辑器里选中的内容取过来")}>
            {t("取选中")}
          </button>
          <button onclick={() => runB64("encode")}>{t("编码为 Base64")}</button>
          <button onclick={() => runB64("decode")}>{t("解码为文本")}</button>
          <button class="ct-primary" disabled={b64Out === ""} onclick={() => push(b64Out)}>
            {t("替换选中")}
          </button>
        </div>
        <textarea readonly rows="3" value={b64Out} placeholder={t("结果")}></textarea>
        {#if b64Err}<p class="ct-err">{b64Err}</p>{/if}
      </section>

      <section class="ct-group">
        <h3>{t("进制转换")}</h3>
        <input bind:value={numIn} placeholder={t("输入数字（如 ff、0b1010、755）")} />
        <div class="ct-row">
          <label class="ct-sel">
            <span>{t("源进制")}</span>
            <select bind:value={fromBase}>
              <option value={0}>{t("自动识别")}</option>
              {#each BASES as b (b)}
                <option value={b}>{t("{n} 进制", { n: b })}</option>
              {/each}
            </select>
          </label>
          <label class="ct-sel">
            <span>{t("目标进制")}</span>
            <select bind:value={toBase}>
              {#each BASES as b (b)}
                <option value={b}>{t("{n} 进制", { n: b })}</option>
              {/each}
            </select>
          </label>
          <button class="ct-primary" disabled={numOut.text === ""} onclick={() => push(numOut.text)}>
            {t("替换选中")}
          </button>
        </div>
        {#if numOut.error}
          <p class="ct-err">{numOut.error}</p>
        {:else if numOut.text !== ""}
          <p class="ct-out">{numOut.text}</p>
        {/if}
      </section>

      <section class="ct-group">
        <h3>GUID</h3>
        <p class="ct-out mono">{guid}</p>
        <div class="ct-row">
          <button onclick={() => (guid = newGuid())}>{t("重新生成")}</button>
          <button class="ct-primary" onclick={() => push(guid)}>{t("插入到光标处")}</button>
        </div>
      </section>

      <section class="ct-group">
        <h3>{t("时间戳")}</h3>
        <select bind:value={stampKind}>
          {#each STAMPS as s (s.id)}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
        <p class="ct-out mono">{stampNow}</p>
        <div class="ct-row">
          <button class="ct-primary" onclick={() => push(stampNow)}>{t("插入到光标处")}</button>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .ct-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    z-index: 620;
  }

  .ct-modal {
    display: flex;
    flex-direction: column;
    width: 420px;
    max-width: 92vw;
    max-height: 82vh;
    background: var(--bg, #fff);
    color: var(--fg, #1f2328);
    border: 1px solid var(--border, #ddd);
    border-radius: 10px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .ct-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.5rem 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border, #ddd);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .ct-x {
    width: 1.7rem;
    height: 1.7rem;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .ct-x:hover {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .ct-body {
    padding: 0.8rem;
    overflow-y: auto;
  }

  .ct-group + .ct-group {
    margin-top: 0.9rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--border, #ddd);
  }

  .ct-group h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    opacity: 0.85;
    margin-bottom: 0.5rem;
  }

  textarea,
  input,
  select {
    width: 100%;
    box-sizing: border-box;
    padding: 0.35rem 0.45rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    background: var(--bg, #fff);
    color: inherit;
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
    font-size: 0.75rem;
    resize: vertical;
  }

  textarea[readonly] {
    opacity: 0.9;
  }

  .ct-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin: 0.45rem 0;
  }

  .ct-row button {
    padding: 0.28rem 0.55rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .ct-row button:hover:not(:disabled) {
    background: var(--hover, rgba(0, 0, 0, 0.07));
  }

  .ct-row button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ct-primary {
    font-weight: 600;
  }

  .ct-sel {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .ct-sel select {
    width: auto;
  }

  .ct-out {
    padding: 0.35rem 0.45rem;
    border: 1px dashed var(--border, #ddd);
    border-radius: 5px;
    font-size: 0.8125rem;
    word-break: break-all;
  }

  .mono {
    font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
  }

  .ct-err {
    margin-top: 0.3rem;
    font-size: 0.75rem;
    color: var(--danger, #c0392b);
  }
</style>