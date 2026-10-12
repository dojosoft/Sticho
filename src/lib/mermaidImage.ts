/**
 * Mermaid → PNG 位图（Word 导出嵌入图片用）
 *
 * docx 只吃位图，认不得 SVG，所以要把 Mermaid 渲染出的 SVG 先画进 canvas 再取 PNG。
 * 这条链路全在本机浏览器里完成，不联网、不落临时文件。
 *
 * 任何一步失败（语法错误、canvas 被禁用、字体测量失败……）都返回 null，
 * 由调用方回落成代码块，绝不让一张图失败拖垮整篇导出。
 */
import type { DocxImage } from "./export-docx";
import { renderMermaidInto } from "./editor";

/** 位图超采样倍率：按 2 倍画再交给 Word 缩放，避免文字发虚 */
const SUPER_SAMPLE = 2;

/** 从 svg 上读出固有尺寸：优先 viewBox（mermaid 输出必然带它），其次 width/height 数值 */
function svgSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const width = Number.parseFloat(svg.getAttribute("width") ?? "");
  const height = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  return { width: 0, height: 0 };
}

/** 用 data URI 加载位图（canvas 因跨域污染拿不到 toBlob，data URI 无此问题） */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("SVG 转位图失败"));
    img.src = src;
  });
}

/**
 * 渲染 Mermaid 源码为 PNG。
 *
 * 返回的 width/height 是「逻辑尺寸」（docx 按它排版），data 是超采样后的位图字节。
 */
export async function renderMermaidToPng(code: string): Promise<DocxImage | null> {
  // 离屏容器：挂在 body 下但不参与布局，保证 mermaid 测量文字宽度时有真实样式环境
  const host = document.createElement("div");
  host.className = "vditor";
  host.setAttribute(
    "style",
    "position:fixed;left:-99999px;top:0;width:1000px;opacity:0;pointer-events:none;",
  );
  document.body.appendChild(host);

  try {
    const svg = await renderMermaidInto(host, code);
    if (!svg) return null;

    const { width, height } = svgSize(svg);
    if (width <= 0 || height <= 0) return null;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("style", `width:${width}px;height:${height}px;`);
    const source = new XMLSerializer().serializeToString(clone);

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * SUPER_SAMPLE));
    canvas.height = Math.max(1, Math.round(height * SUPER_SAMPLE));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // 白底：Mermaid 图透明背景，直接垫白避免 Word 里透出正文
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const image = await loadImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
    );
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) return null;

    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      width,
      height,
      type: "png",
    };
  } catch {
    return null;
  } finally {
    host.remove();
  }
}