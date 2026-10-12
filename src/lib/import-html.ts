/**
 * 导入 HTML（任务书 F2：打开 .html 转 Markdown 继续编辑）
 *
 * turndown + GFM 插件（表格/删除线/任务列表），任务书 3.2 指定选型。
 * 转换语义与 docx/pdf 导入一致：HTML → Markdown 新文档（未保存状态），
 * 后续保存走 .md，不回写原 .html。
 */
import TurndownService from "turndown";
import * as turndownGfm from "turndown-plugin-gfm";

let service: TurndownService | null = null;

function getService(): TurndownService {
  if (!service) {
    service = new TurndownService({
      headingStyle: "atx", // # 风格标题，与编辑器/GFM 一致
      codeBlockStyle: "fenced", // ``` 围栏代码块
      bulletListMarker: "-",
      emDelimiter: "*",
      strongDelimiter: "**",
    });
    service.use(turndownGfm.gfm);
  }
  return service;
}

/** HTML 源码 → Markdown（正文提取 body，保留语义性内联标签） */
export function htmlToMarkdown(html: string): string {
  // 只取 <body> 内容：去掉脚本/样式/头部，防止 [style] 之类噪音进入文档
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  const body = bodyMatch ? bodyMatch[1]! : html;
  const cleaned = body.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "");
  const md = getService().turndown(cleaned);
  // 连续空行收敛为单个（turndown 对块间距常产生多余空行）
  return md.replace(/\n{3,}/g, "\n\n").trim();
}
