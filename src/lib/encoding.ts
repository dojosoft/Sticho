/**
 * 文本编码表（任务书阶段 11）
 *
 * id 与 Rust 侧 file_io.rs 的 encoding_from_id 一一对应，
 * 前端只负责展示中文名与把 id 传给 Rust，不参与实际编解码。
 */

export type EncodingDef = { id: string; label: string };

export const ENCODINGS: EncodingDef[] = [
  { id: "utf-8", label: "UTF-8" },
  { id: "utf-8-bom", label: "UTF-8（带 BOM）" },
  { id: "utf-16le", label: "Unicode（UTF-16 LE）" },
  { id: "utf-16be", label: "Unicode（UTF-16 BE）" },
  { id: "gb18030", label: "ANSI（简体中文 GBK / GB18030）" },
  { id: "big5", label: "ANSI（繁体中文 Big5）" },
  { id: "shift_jis", label: "ANSI（日文 Shift_JIS）" },
  { id: "euc-kr", label: "ANSI（韩文 EUC-KR）" },
  { id: "windows-1252", label: "ANSI（西欧 Windows-1252）" },
];

/** 编码 id → 界面显示名（未知 id 原样返回，便于排查） */
export function encodingLabel(id: string): string {
  return ENCODINGS.find((e) => e.id === id)?.label ?? id;
}
