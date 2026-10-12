/**
 * 生成「扫描件」测试 PDF：只有图形内容（模拟扫描图像区域），没有文本层。
 * 用于验证导入 PDF 的扫描件检测：pdfjs 提取字符数近 0 时应给出明确提示。
 *
 * 手写最小 PDF 结构（Catalog / Pages / Page / Contents），
 * content stream 只含灰色矩形填充指令，无任何文本操作符。
 */
import { writeFileSync } from "node:fs";

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << >> >>",
];

// 模拟一页扫描图像：整页浅灰底 + 一块深色"图片"区域（纯图形，无文本）
const stream = "0.92 0.92 0.92 rg 0 0 595 842 re f\n0.55 0.55 0.55 rg 60 120 475 620 re f\n";
objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);

let pdf = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefPos = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const off of offsets) {
  pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

writeFileSync(new URL("./scanned-test.pdf", import.meta.url), pdf, "latin1");
console.log(`scanned-test.pdf 已生成（${pdf.length} 字节，1 页，无文本层）`);
