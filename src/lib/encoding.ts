/**
 * 文本编码表（任务书阶段 11）
 *
 * id 与 Rust 侧 file_io.rs 的 encoding_from_id 一一对应，
 * 前端只负责展示名称（英文原文即键，显示时经 t() 得到当前语言译文）与把 id 传给 Rust，
 * 不参与实际编解码。
 */

export type EncodingDef = { id: string; label: string };

export const ENCODINGS: EncodingDef[] = [
  { id: "utf-8", label: "UTF-8" },
  { id: "utf-8-bom", label: "UTF-8 (with BOM)" },
  { id: "utf-16le", label: "Unicode (UTF-16 LE)" },
  { id: "utf-16be", label: "Unicode (UTF-16 BE)" },
  { id: "gb18030", label: "ANSI (Simplified Chinese GBK / GB18030)" },
  { id: "big5", label: "ANSI (Traditional Chinese Big5)" },
  { id: "shift_jis", label: "ANSI (Japanese Shift_JIS)" },
  { id: "euc-kr", label: "ANSI (Korean EUC-KR)" },
  { id: "windows-1252", label: "ANSI (Western European Windows-1252)" },
];

/**
 * 编码 id → 界面显示名（英文原文即键，显示时经 t() 翻译）。
 *
 * 表外 id 直接显示 id 本身：自动检测可能给出 windows-1251 / euc-jp / ISO-8859-x 等
 * （Rust 侧取的是 encoding_rs 的规范名），显示规范名比笼统的「Unknown encoding」准确得多，
 * 用户也能据此判断该选哪一种。
 */
export function encodingLabel(id: string): string {
  return ENCODINGS.find((e) => e.id === id)?.label ?? id;
}
