/**
 * 生成「导入 Word」验收用测试文档（含标题层级 / 表格 / 图片 / 中文）
 * 运行：node test-fixtures/make-test-docx.mjs
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
  TableCell, ImageRun, WidthType, BorderStyle,
} from "docx";
import { readFileSync, writeFileSync } from "node:fs";

const img = readFileSync(new URL("../src-tauri/icons/128x128.png", import.meta.url));

const border = { style: BorderStyle.SINGLE, size: 4, color: "C0C0C0" };

// 注意：docx 库的 Heading 样式默认 basedOn="Normal" 却不定义 Normal，
// 形成悬空引用会导致 pandoc 无法识别标题层级，这里显式补上 Normal 定义
const doc = new Document({
  styles: {
    paragraphStyles: [
      { id: "Normal", name: "Normal", quickFormat: true },
    ],
  },
  sections: [{
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Pandoc 导入测试文档")] }),
      new Paragraph({ children: [new TextRun("这是导入验收用的中文段落：包含全角标点，。、；：「」（）、《》，以及加粗与斜体混合排版测试。")] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("章节：图片嵌入")] }),
      new Paragraph({
        children: [new ImageRun({ type: "png", data: img, transformation: { width: 120, height: 120 } })],
      }),
      new Paragraph({ children: [new TextRun("上面是一张 PNG 图标图片，导入后应内联为 data URI 并在编辑器中显示。")] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("章节：表格")] }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: ["功能", "状态", "备注"].map(t =>
              new TableCell({
                shading: { fill: "EFF2F5" },
                children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
              })),
          }),
          ...[
            ["表格行一", "正常", "中文内容"],
            ["表格行二", "正常", "English 内容"],
            ["表格行三", "正常", "混合 mixed 内容"],
          ].map(cells => new TableRow({
            children: cells.map(t => new TableCell({ children: [new Paragraph({ children: [new TextRun(t)] })] })),
          })),
        ],
        borders: {
          top: border, bottom: border, left: border, right: border,
          insideHorizontal: border, insideVertical: border,
        },
      }),
      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("小结")] }),
      new Paragraph({ children: [new TextRun("若导入后标题层级、表格边框、图片均正常呈现，则阶段 5 验收通过。")] }),
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(new URL("./import-test.docx", import.meta.url), buf);
console.log("OK: import-test.docx");
