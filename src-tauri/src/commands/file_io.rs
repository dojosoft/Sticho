//! 文件读写命令（任务书阶段 2；阶段 11 扩展编码检测与目录列举）
//!
//! 为什么用 Rust 命令而非前端 fs 插件直接读写：
//! 1. 编码检测/转换在 Rust 侧完成（chardetng 嗅探 + encoding_rs 编解码）
//! 2. 统一做大文件、占用、磁盘满等边界情况的错误处理（任务书 6.2）

use std::fs;
use std::path::Path;

use base64::Engine as _;
use encoding_rs::{Encoding, BIG5, EUC_KR, GB18030, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252};

/// 大文件提示阈值：超过 10MB 拒绝打开（任务书 6.2：提示用户）
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// PDF 导入大小上限：50MB（文字版 PDF 远小于此，防止误选巨型扫描件拖垮前端）
const MAX_PDF_SIZE: u64 = 50 * 1024 * 1024;

/// 原子写的临时文件后缀（同时用于在目录树里过滤掉崩溃后残留的临时文件）
const TMP_SUFFIX: &str = ".sticho.tmp";

/// 编码 id → encoding_rs 编码。
///
/// id 是前后端约定的稳定标识（前端「编码」菜单直接展示同一套 id 的中文名），
/// 不用 encoding_rs 的 label 是为了让「UTF-8 带 BOM」这类保存差异也能表达。
fn encoding_from_id(id: &str) -> Option<&'static Encoding> {
    Some(match id {
        "utf-8" | "utf-8-bom" => UTF_8,
        "utf-16le" => UTF_16LE,
        "utf-16be" => UTF_16BE,
        "gb18030" => GB18030,
        "big5" => BIG5,
        "shift_jis" => SHIFT_JIS,
        "euc-kr" => EUC_KR,
        "windows-1252" => WINDOWS_1252,
        _ => return None,
    })
}

/// encoding_rs 编码 → 编码 id（自动检测结果的落点）
fn id_from_encoding(enc: &'static Encoding) -> &'static str {
    match enc.name() {
        "UTF-8" => "utf-8",
        "UTF-16LE" => "utf-16le",
        "UTF-16BE" => "utf-16be",
        // encoding_rs 中 GBK 与 GB18030 是同一编码的不同名字，统一归到 gb18030
        "GBK" | "gb18030" => "gb18030",
        "Big5" => "big5",
        "Shift_JIS" => "shift_jis",
        "EUC-KR" => "euc-kr",
        _ => "windows-1252",
    }
}

/// 按 id 去掉与所选编码匹配的 BOM 字节（不匹配时原样返回）
fn strip_bom<'a>(bytes: &'a [u8], id: &str) -> &'a [u8] {
    match id {
        "utf-8-bom" if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) => &bytes[3..],
        "utf-16le" if bytes.starts_with(&[0xFF, 0xFE]) => &bytes[2..],
        "utf-16be" if bytes.starts_with(&[0xFE, 0xFF]) => &bytes[2..],
        _ => bytes,
    }
}

/// 无 BOM 的 UTF-16 嗅探：ASCII 文本在 UTF-16 下每隔一字节为 0x00。
///
/// 纯 CJK 的无 BOM UTF-16 无法靠该启发式识别（交给 chardetng 猜，猜错可由用户手动切换）。
fn sniff_bomless_utf16(bytes: &[u8]) -> Option<&'static str> {
    let n = bytes.len().min(256) & !1;
    if n < 4 {
        return None;
    }
    let mut odd_nul = 0usize;
    let mut even_nul = 0usize;
    for (i, b) in bytes[..n].iter().enumerate() {
        if *b == 0 {
            if i % 2 == 0 {
                even_nul += 1;
            } else {
                odd_nul += 1;
            }
        }
    }
    let pairs = n / 2;
    if odd_nul * 4 >= pairs * 3 {
        Some("utf-16le")
    } else if even_nul * 4 >= pairs * 3 {
        Some("utf-16be")
    } else {
        None
    }
}

/// 自动检测编码并解码：BOM 优先 → 无 BOM UTF-16 启发式 → chardetng 嗅探
pub(crate) fn decode_auto(bytes: &[u8]) -> (String, &'static str) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (UTF_8.decode_without_bom_handling(&bytes[3..]).0.into_owned(), "utf-8-bom");
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return (UTF_16LE.decode_without_bom_handling(&bytes[2..]).0.into_owned(), "utf-16le");
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return (UTF_16BE.decode_without_bom_handling(&bytes[2..]).0.into_owned(), "utf-16be");
    }
    if let Some(id) = sniff_bomless_utf16(bytes) {
        let enc = encoding_from_id(id).expect("嗅探结果必为已知编码");
        return (enc.decode_without_bom_handling(bytes).0.into_owned(), id);
    }
    // 纯 ASCII 一律按 UTF-8：ASCII 是各编码的公共子集，按 UTF-8 保存兼容性最好
    if bytes.is_ascii() {
        return (String::from_utf8_lossy(bytes).into_owned(), "utf-8");
    }
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let enc = detector.guess(None, true);
    (enc.decode_without_bom_handling(bytes).0.into_owned(), id_from_encoding(enc))
}

/// 文本文件内容 + 实际使用的编码 id
#[derive(serde::Serialize)]
pub struct TextFile {
    pub content: String,
    /// 编码 id：utf-8 / utf-8-bom / utf-16le / utf-16be / gb18030 / big5 / shift_jis / euc-kr / windows-1252
    pub encoding: String,
}

/// 读取文本文件。
///
/// `encoding` 为 None 时自动检测；给定时按用户指定的编码解码（「编码」菜单的手动切换）。
/// 错误全部转为用户可读的中文消息返回给前端，避免裸 panic。
#[tauri::command]
pub async fn read_text_file(path: String, encoding: Option<String>) -> Result<TextFile, String> {
    // 最大 10MB 的读取 + 编码嗅探有明显耗时，放后台线程执行，避免阻塞主线程
    tauri::async_runtime::spawn_blocking(move || read_text_file_blocking(&path, encoding.as_deref()))
        .await
        .map_err(|e| format!("任务调度失败：{e}"))?
}

fn read_text_file_blocking(path: &str, encoding: Option<&str>) -> Result<TextFile, String> {
    let p = Path::new(path);

    let meta = match fs::metadata(p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("文件不存在：{path}"));
        }
        Err(e) => return Err(format!("无法访问文件：{e}")),
    };

    if meta.len() > MAX_FILE_SIZE {
        return Err(format!(
            "文件过大（{} MB），当前版本仅支持 10MB 以内的文档",
            meta.len() / 1024 / 1024
        ));
    }

    let bytes = fs::read(p).map_err(|e| format!("读取失败：{e}"))?;

    if let Some(id) = encoding {
        let enc = encoding_from_id(id).ok_or_else(|| format!("不支持的编码：{id}"))?;
        let text = enc.decode_without_bom_handling(strip_bom(&bytes, id)).0;
        return Ok(TextFile { content: text.into_owned(), encoding: id.to_string() });
    }

    let (content, id) = decode_auto(&bytes);
    Ok(TextFile { content, encoding: id.to_string() })
}

/// 原子写：先写同目录临时文件，再 rename 覆盖目标。
///
/// 避免写一半时崩溃/断电把原文件损坏成半截内容。
pub(crate) fn atomic_write(path: &str, bytes: &[u8]) -> Result<(), String> {
    let tmp_path = format!("{path}{TMP_SUFFIX}");

    if let Err(e) = fs::write(&tmp_path, bytes) {
        return Err(match e.kind() {
            std::io::ErrorKind::ReadOnlyFilesystem | std::io::ErrorKind::PermissionDenied => {
                format!("无写入权限（路径可能只读或被安全软件拦截）：{path}")
            }
            std::io::ErrorKind::StorageFull => "磁盘空间不足，保存失败".to_string(),
            _ => format!("写入失败：{e}"),
        });
    }

    // rename 在 Windows 上目标被占用（如 Word 正开着该文件）或被设为只读时会失败
    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path); // 清理临时文件
        return Err(format!(
            "保存失败（目标文件可能正被其他程序占用，或为只读属性）：{e}"
        ));
    }
    Ok(())
}

/// 按指定编码写入文本文件（保存时的编码由用户当前选择决定）。
///
/// 覆盖写之前会先把**磁盘上的旧内容**留一份到本地版本历史（内容没变则跳过），
/// 这样误保存 / 误改都能从「文件历史」找回。
#[tauri::command]
pub async fn write_text_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
    encoding: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_text_file_blocking(&app, &path, &content, &encoding)
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

fn write_text_file_blocking(
    app: &tauri::AppHandle,
    path: &str,
    content: &str,
    encoding: &str,
) -> Result<(), String> {
    let enc = encoding_from_id(encoding).ok_or_else(|| format!("不支持的编码：{encoding}"))?;

    let mut bytes: Vec<u8> = Vec::with_capacity(content.len() + 3);
    match encoding {
        "utf-8-bom" => bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]),
        "utf-16le" => bytes.extend_from_slice(&[0xFF, 0xFE]),
        "utf-16be" => bytes.extend_from_slice(&[0xFE, 0xFF]),
        _ => {}
    }

    match encoding {
        // UTF-8 与 Rust String 内存表示一致，直接取字节，不经编解码库
        "utf-8" | "utf-8-bom" => bytes.extend_from_slice(content.as_bytes()),
        "utf-16le" => {
            for unit in content.encode_utf16() {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
        }
        "utf-16be" => {
            for unit in content.encode_utf16() {
                bytes.extend_from_slice(&unit.to_be_bytes());
            }
        }
        _ => {
            // 注意：encoding_rs 的 encode() 会把无法映射的字符写成 HTML 实体（&#...;），
            // 那会污染纯文本。故回读校验，不一致就直接报错让用户改存 UTF-8。
            let (encoded, _, _) = enc.encode(content);
            if enc.decode_without_bom_handling(&encoded).0.as_ref() != content {
                return Err(format!(
                    "当前文档包含「{encoding}」无法表示的字符（如 emoji 或生僻字），请改用 UTF-8 保存"
                ));
            }
            bytes.extend_from_slice(&encoded);
        }
    }

    // 覆盖前留档旧内容（仅当目标已存在且内容确有变化）；历史留档失败不阻断保存
    super::history::snapshot_if_changed(app, path, &bytes);
    atomic_write(path, &bytes)
}

/// 写入二进制文件（阶段 3：导出的 .docx 等非文本产物）。
///
/// 数据以 base64 传输：Tauri IPC 走 JSON，二进制必须编码后过通道。
#[tauri::command]
pub async fn write_file_base64(path: String, data: String) -> Result<(), String> {
    // base64 解码可能放大到数 MB 级，放后台线程
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.trim())
            .map_err(|e| format!("导出数据解码失败：{e}"))?;
        atomic_write(&path, &bytes)
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

/// 文件属性（阶段 10：文件菜单 →「文件属性」）
#[derive(serde::Serialize)]
pub struct FileInfo {
    /// 文件大小（字节）
    pub size: u64,
    /// 创建时间（Unix 毫秒时间戳；部分文件系统取不到时为 None）
    pub created: Option<u64>,
    /// 最后修改时间（Unix 毫秒时间戳）
    pub modified: Option<u64>,
}

/// 读取文件属性。文件不存在/不可访问时返回中文错误，由前端提示。
#[tauri::command]
pub fn get_file_info(path: String) -> Result<FileInfo, String> {
    let p = Path::new(&path);

    let meta = match fs::metadata(p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("文件不存在：{path}"));
        }
        Err(e) => return Err(format!("无法读取文件属性：{e}")),
    };

    // SystemTime → Unix 毫秒；转换失败（时钟早于 1970）按未知处理
    let to_ms = |t: std::io::Result<std::time::SystemTime>| {
        t.ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
    };

    Ok(FileInfo {
        size: meta.len(),
        created: to_ms(meta.created()),
        modified: to_ms(meta.modified()),
    })
}

/// 目录项（阶段 11：侧边栏「文件目录树」）
///
/// camelCase 与前端 DirEntry 类型一致（is_dir → isDir）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 列出目录内容（不递归，子目录按需展开时再调用）。
#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entries = fs::read_dir(&path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => format!("目录不存在：{path}"),
            std::io::ErrorKind::PermissionDenied => format!("无权限访问目录：{path}"),
            _ => format!("读取目录失败：{e}"),
        })?;

        let mut list: Vec<DirEntry> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                // 原子写残留的临时文件（崩溃后遗留）不该出现在目录树里
                if name.ends_with(TMP_SUFFIX) {
                    return None;
                }
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                Some(DirEntry {
                    name,
                    path: entry.path().to_string_lossy().into_owned(),
                    is_dir,
                })
            })
            .collect();

        // 目录在前、文件在后，各自按名称不区分大小写排序
        list.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(list)
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

/// 启动参数里的待打开文件（阶段 11：文件关联后双击文档，由资源管理器以参数传入）。
///
/// 取第一个「存在且是文件」的非选项参数，避免把开发模式下的命令行开关误当文件。
#[tauri::command]
pub fn get_startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && Path::new(arg).is_file())
}

/// 读取 PDF 原始字节，以 base64 返回（阶段 6：导入 PDF）。
///
/// 前端 pdfjs-dist 需要原始二进制；Tauri IPC 走 JSON，二进制必须编码后过通道。
/// 真正的文本抽取在前端完成（任务书 3.2：pdfjs-dist 前端解析）。
#[tauri::command]
pub async fn read_pdf_base64(path: String) -> Result<String, String> {
    // 最大 50MB 读入 + base64 编码（约 +33%）内存峰值很高，必须放后台线程
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);

        let meta = match fs::metadata(p) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(format!("文件不存在：{path}"));
            }
            Err(e) => return Err(format!("无法访问文件：{e}")),
        };

        if meta.len() > MAX_PDF_SIZE {
            return Err(format!(
                "PDF 文件过大（{} MB），当前版本仅支持 50MB 以内的文件",
                meta.len() / 1024 / 1024
            ));
        }

        let bytes = fs::read(p).map_err(|e| format!("读取失败：{e}"))?;

        // 魔数校验：避免用户把改名后的非 PDF 文件传进来
        if !bytes.starts_with(b"%PDF") {
            return Err("这不是有效的 PDF 文件（文件头不匹配）".to_string());
        }

        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 编码_id_与编码库双向一致() {
        for id in ["utf-8", "utf-16le", "utf-16be", "gb18030", "big5", "shift_jis", "euc-kr"] {
            let enc = encoding_from_id(id).expect("已知编码");
            assert_eq!(id_from_encoding(enc), id, "编码 id 往返应保持一致：{id}");
        }
        // 「UTF-8 带 BOM」是保存差异，解码统一走 UTF-8
        assert_eq!(id_from_encoding(encoding_from_id("utf-8-bom").unwrap()), "utf-8");
        assert!(encoding_from_id("no-such-encoding").is_none());
    }

    #[test]
    fn 按编码剥离_bom() {
        let utf8_bom = [0xEF, 0xBB, 0xBF, b'a'];
        assert_eq!(strip_bom(&utf8_bom, "utf-8-bom"), &[b'a']);
        // BOM 与所选编码不匹配时原样返回
        assert_eq!(strip_bom(&utf8_bom, "gb18030"), &utf8_bom[..]);

        let utf16le = [0xFF, 0xFE, 0x41, 0x00];
        assert_eq!(strip_bom(&utf16le, "utf-16le"), &[0x41, 0x00]);
    }

    #[test]
    fn 无_bom_的_utf16_启发式() {
        // 小端：ASCII 文本偶数位为 0x00
        let le = [b'a', 0x00, b'b', 0x00, b'c', 0x00, b'd', 0x00];
        assert_eq!(sniff_bomless_utf16(&le), Some("utf-16le"));
        let be = [0x00, b'a', 0x00, b'b', 0x00, b'c', 0x00, b'd'];
        assert_eq!(sniff_bomless_utf16(&be), Some("utf-16be"));
        // 普通 UTF-8 不应被误判
        assert_eq!(sniff_bomless_utf16("hello world".as_bytes()), None);
    }

    #[test]
    fn 自动检测优先识别_bom_与纯_ascii() {
        let (text, id) = decode_auto(&[0xEF, 0xBB, 0xBF, b'h', b'i']);
        assert_eq!((text.as_str(), id), ("hi", "utf-8-bom"));

        let (text, id) = decode_auto(b"plain ascii");
        assert_eq!((text.as_str(), id), ("plain ascii", "utf-8"));
    }
}
