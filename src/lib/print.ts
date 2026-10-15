/**
 * 打印（新增）
 *
 * 为什么在前端做，而不复用 Rust 的 export_pdf：
 * - 导出 PDF 是「静默产出文件」，走不可见 WebView 的 PrintToPdf，全程没有用户交互；
 * - 打印要让用户看到系统打印对话框（WebView2 自带打印预览）并选打印机与页数，走的是 window.print()。
 *   把一个装好打印样式的 iframe 挂进文档流再让它自己 print()，打印内容就只是这一帧，
 *   绝不会把应用工具栏、侧边栏一起打出去。
 *
 * 打印样式与导出 PDF 共用同一份（export-pdf.ts 的 buildPrintHtml），
 * 避免「导出」与「打印」两份 CSS 各自漂移。
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import MarkdownIt from "markdown-it";
import { buildPrintHtml } from "./export-pdf";
import { applyAutoSpace } from "./typography";

const md = new MarkdownIt({ html: false, linkify: true });
applyAutoSpace(md);

/** iframe onload 的兜底时限：超时仍未加载就收尾，避免调用方 await 永久挂起 */
const PRINT_LOAD_TIMEOUT_MS = 15_000;

export type PrintKind = "markdown" | "html" | "code";

export interface PrintSource {
  /** 权威正文：Markdown 源码 / HTML 源码 / 代码原文 */
  source: string;
  kind: PrintKind;
  /** 文档主名，写进 <title>（打印对话框的文档名） */
  title: string;
  /** 文档所在目录：把正文里相对路径的图片换成可访问的 asset URL；未保存文档传 null */
  dir?: string | null;
  /** 当前界面语言：写入 <html lang>，避免打印环境用错误 locale 排版 */
  locale?: string;
}

/** 组装一份可直接打印的完整 HTML */
export function buildPrintDocument({ source, kind, title, dir, locale = "zh-CN" }: PrintSource): string {
  let body: string;
  if (kind === "code") body = `<pre class="plain">${escapeHtml(source)}</pre>`;
  else if (kind === "html") body = source;
  else body = md.render(source);
  if (dir) body = rewriteImageSrc(body, dir);
  return buildPrintHtml(body, title, locale);
}

/**
 * 在离屏 iframe 里打印。
 *
 * 用 iframe 而不是给主界面套 @media print：主界面套打印样式要保证「除了正文全部隐藏」，
 * 一旦将来新增浮层忘了加规则，就会被一起打印出去；iframe 的文档流天然只有正文。
 *
 * Promise 在 print() 返回后 resolve（WebView2 里 print() 会阻塞到对话框关闭）。
 */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    // 必须上沙箱：srcdoc 会继承父页面的源，HTML 文档里的 <script> 一旦能跑就与本应用同源，
    // 可以反过来操作主窗口（含 Tauri IPC）。只放行 allow-modals 让 print() 能弹系统打印
    // 对话框，绝不给 allow-scripts——与「执行脚本」关闭时 HTML 预览的沙箱口径一致。
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    // 必须保持「已渲染」：display:none 的 iframe 不会打印，故移出视口而非隐藏
    frame.style.cssText = "position:fixed;top:0;left:-10000px;width:1px;height:1px;border:0;";
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.setTimeout(() => frame.remove(), 0);
      resolve();
    };
    // onload 万一不触发（异常 HTML），也不能让调用方永久 await：兜底时限到点照样收尾
    timer = window.setTimeout(() => {
      frame.remove();
      finish();
    }, PRINT_LOAD_TIMEOUT_MS);
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return finish();
      try {
        win.focus();
        win.print();
      } finally {
        finish();
      }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 把 body 里 <img> 的相对路径换成 asset URL。
 *
 * markdown-it 会把中文/空格路径按 URL 规则转义成 %XX，先解码再拼绝对路径；
 * 绝对路径（盘符 / UNC / 以 / 开头）直接交给 convertFileSrc。
 */
function rewriteImageSrc(html: string, dir: string): string {
  return html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (whole, pre: string, raw: string, post: string) => {
    if (/^(?:https?:|data:|blob:|asset:|tauri:|about:)/i.test(raw)) return whole;
    let src = raw;
    try {
      src = decodeURIComponent(raw);
    } catch {
      // 解码失败就用原串（可能本来就不是转义过的路径）
    }
    if (/^[a-zA-Z]:[\\/]/.test(src) || /^[\\/]/.test(src)) return `${pre}${convertFileSrc(src)}${post}`;
    const base = dir.replace(/[\\/]+$/, "");
    return `${pre}${convertFileSrc(`${base}\\${src.replace(/^\.?[\\/]/, "")}`)}${post}`;
  });
}