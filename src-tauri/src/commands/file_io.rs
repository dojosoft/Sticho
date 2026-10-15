//! 文件读写命令（任务书阶段 2；阶段 11 扩展编码检测与目录列举）
//!
//! 为什么用 Rust 命令而非前端 fs 插件直接读写：
//! 1. 编码检测/转换在 Rust 侧完成（chardetng 嗅探 + encoding_rs 编解码）
//! 2. 统一做大文件、占用、磁盘满等边界情况的错误处理（任务书 6.2）

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use encoding_rs::{
    Encoding, BIG5, EUC_KR, GB18030, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252,
};

/// 大文件提示阈值：超过 10MB 拒绝打开（任务书 6.2：提示用户）
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// PDF 导入大小上限：50MB（文字版 PDF 远小于此，防止误选巨型扫描件拖垮前端）
const MAX_PDF_SIZE: u64 = 50 * 1024 * 1024;

/// 图片读取大小上限：20MB（Word 导出嵌入图片用，正常插图远小于此）
const MAX_IMAGE_SIZE: u64 = 20 * 1024 * 1024;

/// 原子写的临时文件后缀（同时用于在目录树里过滤掉崩溃后残留的临时文件）。
///
/// 实际临时名是 `<目标>.<序号>.sticho.tmp`：序号保证唯一，且仍以本后缀结尾，
/// 目录树过滤（见 `list_dir`）照常能把它挡掉。
const TMP_SUFFIX: &str = ".sticho.tmp";

/// 原子写临时文件名的进程内自增序号。
///
/// 固定名 `<path>.sticho.tmp` 在两次写同一目标并发时（快速重复 Ctrl+S、自动保存与
/// 手动保存交错）会共用同一临时文件：后写者截断前者，随后两者都 rename → 一方失败
/// 或内容被覆盖。加序号后每个写入各用各的临时文件，互不干扰。
static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 编码 id → encoding_rs 编码。
///
/// id 是前后端约定的稳定标识（前端「编码」菜单直接展示同一套 id 的中文名），
/// 不用 encoding_rs 的 label 是为了让「UTF-8 带 BOM」这类保存差异也能表达。
///
/// 常用编码先走固定表；表外的 id 交给 `Encoding::for_label` 兜底——因为
/// `id_from_encoding` 用的就是 encoding_rs 的规范名小写，两边严格互逆。
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
        // chardetng 还能猜出 windows-1251 / windows-1255 / EUC-JP / ISO-8859-x 等，
        // 这些 id 都取 encoding_rs 的规范名，for_label 能原样还原对应的编码。
        _ => return Encoding::for_label(id.as_bytes()),
    })
}

/// encoding_rs 编码 → 编码 id（自动检测结果的落点）。
///
/// 取规范名小写，保证「检测出的编码」与「保存时使用的编码」严格一致：
/// 以前表外一律归到 windows-1252，导致 cp1251 之类的文件被标错编码、保存必然报错。
/// 只有 GBK 例外——encoding_rs 里 GBK 与 GB18030 是同一编码的两个名字，统一归到 gb18030。
fn id_from_encoding(enc: &'static Encoding) -> String {
    match enc.name() {
        "GBK" | "gb18030" => "gb18030".to_string(),
        other => other.to_ascii_lowercase(),
    }
}

/// 按 id 去掉与所选编码匹配的 BOM 字节（不匹配时原样返回）。
///
/// `utf-8` 与 `utf-8-bom` 指向同一编码：文件带 BOM 而用户手动选了不带 BOM 的 `utf-8`
/// 时也必须剥掉——否则正文会以一个看不见的 U+FEFF 开头，搜索、字数统计都会莫名多一个字符，
/// 保存时又把它写回去，问题反复出现。
fn strip_bom<'a>(bytes: &'a [u8], id: &str) -> &'a [u8] {
    match id {
        "utf-8" | "utf-8-bom" if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) => &bytes[3..],
        "utf-16le" if bytes.starts_with(&[0xFF, 0xFE]) => &bytes[2..],
        "utf-16be" if bytes.starts_with(&[0xFE, 0xFF]) => &bytes[2..],
        _ => bytes,
    }
}

/// 名字是否为原子写残留的临时文件（形如 `<目标>.<序号>.sticho.tmp`）。
///
/// 不能只按后缀 `ends_with` 判断：用户完全可能有一个真实文件就叫 `笔记.sticho.tmp`，
/// 那样会被目录树永久隐藏。加上「序号段必须是纯数字」这一条，只有本程序生成的
/// 临时文件才被过滤，用户文件不受影响。
fn is_atomic_tmp_name(name: &str) -> bool {
    let Some(rest) = name.strip_suffix(TMP_SUFFIX) else {
        return false;
    };
    match rest.rsplit_once('.') {
        Some((_, seq)) => !seq.is_empty() && seq.bytes().all(|b| b.is_ascii_digit()),
        None => false,
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
///
/// 返回的编码 id 直接由 `id_from_encoding` 取 encoding_rs 的规范名，
/// 保存时经 `encoding_from_id` 能一字不差地还原同一编码。
pub(crate) fn decode_auto(bytes: &[u8]) -> (String, String) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return (
            UTF_8
                .decode_without_bom_handling(&bytes[3..])
                .0
                .into_owned(),
            "utf-8-bom".to_string(),
        );
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return (
            UTF_16LE
                .decode_without_bom_handling(&bytes[2..])
                .0
                .into_owned(),
            "utf-16le".to_string(),
        );
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return (
            UTF_16BE
                .decode_without_bom_handling(&bytes[2..])
                .0
                .into_owned(),
            "utf-16be".to_string(),
        );
    }
    if let Some(id) = sniff_bomless_utf16(bytes) {
        // 嗅探只会给 utf-16le / utf-16be，正常必然命中；生产路径不该有 expect，
        // 万一将来嗅探名单变了，这里直接放行给后面的 chardetng，而不是 panic
        if let Some(enc) = encoding_from_id(id) {
            return (
                enc.decode_without_bom_handling(bytes).0.into_owned(),
                id.to_string(),
            );
        }
    }
    // 纯 ASCII 一律按 UTF-8：ASCII 是各编码的公共子集，按 UTF-8 保存兼容性最好
    if bytes.is_ascii() {
        return (
            String::from_utf8_lossy(bytes).into_owned(),
            "utf-8".to_string(),
        );
    }
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let enc = detector.guess(None, true);
    (
        enc.decode_without_bom_handling(bytes).0.into_owned(),
        id_from_encoding(enc),
    )
}

/// 文本文件内容 + 实际使用的编码 id
#[derive(serde::Serialize)]
pub struct TextFile {
    pub content: String,
    /// 编码 id：本程序自造的 `utf-8-bom`，或 encoding_rs 的规范名小写
    /// （utf-8 / utf-16le / utf-16be / gb18030 / big5 / shift_jis / euc-kr /
    /// windows-1252 / windows-1251 / euc-jp / iso-8859-2 …）。
    /// 保存时原样回传给 Rust 即可用同一编码写回。
    pub encoding: String,
}

/// 读取文本文件。
///
/// `encoding` 为 None 时自动检测；给定时按用户指定的编码解码（「编码」菜单的手动切换）。
/// 错误全部转为用户可读的中文消息返回给前端，避免裸 panic。
///
/// 信任边界：path 直接采用调用方给的值，不做「只允许已打开目录」之类的白名单——
/// 本程序是文件编辑器，正文的读取路径来自系统文件对话框与已打开文档，均在前端可信区；
/// 因此这里只做「非空 / 不是目录」这类 sanity 检查，防止把明显用错的输入变成费解的底层报错。
#[tauri::command]
pub async fn read_text_file(path: String, encoding: Option<String>) -> Result<TextFile, String> {
    // 最大 10MB 的读取 + 编码嗅探有明显耗时，放后台线程执行，避免阻塞主线程
    tauri::async_runtime::spawn_blocking(move || {
        read_text_file_blocking(&path, encoding.as_deref())
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn read_text_file_blocking(path: &str, encoding: Option<&str>) -> Result<TextFile, String> {
    if path.trim().is_empty() {
        return Err("File path is empty".to_string());
    }
    let p = Path::new(path);

    let meta = match fs::metadata(p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("File does not exist: {path}"));
        }
        Err(e) => return Err(format!("Cannot access file: {e}")),
    };

    if meta.is_dir() {
        return Err(format!("This path is a directory, not a file: {path}"));
    }

    if meta.len() > MAX_FILE_SIZE {
        return Err(format!(
            "File is too large ({} MB); this version only supports documents up to 10MB",
            meta.len() / 1024 / 1024
        ));
    }

    let bytes = fs::read(p).map_err(|e| format!("Read failed: {e}"))?;

    if let Some(id) = encoding {
        let enc = encoding_from_id(id).ok_or_else(|| format!("Unsupported encoding: {id}"))?;
        let text = enc.decode_without_bom_handling(strip_bom(&bytes, id)).0;
        return Ok(TextFile {
            content: text.into_owned(),
            encoding: id.to_string(),
        });
    }

    let (content, id) = decode_auto(&bytes);
    Ok(TextFile {
        content,
        encoding: id,
    })
}

/// 原子写：先写同目录临时文件，再 rename 覆盖目标。
///
/// 避免写一半时崩溃/断电把原文件损坏成半截内容。
pub(crate) fn atomic_write(path: &str, bytes: &[u8]) -> Result<(), String> {
    let seq = TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp_path = format!("{path}.{seq}{TMP_SUFFIX}");

    if let Err(e) = fs::write(&tmp_path, bytes) {
        // 写失败（磁盘满 / 权限）可能已经留下半截临时文件，必须清掉，否则会残留在用户目录里
        let _ = fs::remove_file(&tmp_path);
        return Err(match e.kind() {
            std::io::ErrorKind::ReadOnlyFilesystem | std::io::ErrorKind::PermissionDenied => {
                format!("No write permission (the path may be read-only or blocked by security software): {path}")
            }
            std::io::ErrorKind::StorageFull => "Insufficient disk space; save failed".to_string(),
            _ => format!("Write failed: {e}"),
        });
    }

    // rename 在 Windows 上目标被占用（如 Word 正开着该文件）或被设为只读时会失败
    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path); // 清理临时文件
        return Err(format!(
            "Save failed (the target file may be in use by another program or have the read-only attribute): {e}"
        ));
    }
    Ok(())
}

/// 按指定编码写入文本文件（保存时的编码由用户当前选择决定）。
///
/// 覆盖写之前会先把**磁盘上的旧内容**留一份到本地版本历史（内容没变则跳过），
/// 这样误保存 / 误改都能从「文件历史」找回。
///
/// 信任边界与 `read_text_file` 一致：path 来自前端可信区，只做 sanity 检查。
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
    .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn write_text_file_blocking(
    app: &tauri::AppHandle,
    path: &str,
    content: &str,
    encoding: &str,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("File path is empty".to_string());
    }
    // 目标是目录时提前给出明确原因：否则会落到 rename 失败，报出一句与真实原因无关的提示
    if fs::metadata(path).is_ok_and(|m| m.is_dir()) {
        return Err(format!("The target is a directory, not a file: {path}"));
    }
    let enc =
        encoding_from_id(encoding).ok_or_else(|| format!("Unsupported encoding: {encoding}"))?;

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
                    "The current document contains characters that \"{encoding}\" cannot represent (such as emoji or rare characters); please save with UTF-8 instead"
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
            .map_err(|e| format!("Failed to decode export data: {e}"))?;
        atomic_write(&path, &bytes)
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
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
            return Err(format!("File does not exist: {path}"));
        }
        Err(e) => return Err(format!("Failed to read file attributes: {e}")),
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
            std::io::ErrorKind::NotFound => format!("Directory does not exist: {path}"),
            std::io::ErrorKind::PermissionDenied => {
                format!("No permission to access directory: {path}")
            }
            _ => format!("Failed to read directory: {e}"),
        })?;

        let mut list: Vec<DirEntry> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                // 原子写残留的临时文件（崩溃后遗留）不该出现在目录树里；
                // 只过滤本程序生成的那种（带数字序号），用户真实同名文件照常显示
                if is_atomic_tmp_name(&name) {
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
    .map_err(|e| format!("Task spawn failed: {e}"))?
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

/// 在资源管理器中定位并选中某个文件（标签右键「打开文件位置」）。
///
/// `/select,` 与路径必须分成**两个参数**传：explorer 对 `/select,<path>` 这种
/// 单参数形式只在路径不含特殊字符时才可靠，路径里带引号 / 逗号时会把路径拆错。
/// 拆成两参数后由 explorer 自身完成参数拼装，各类路径都能正确定位。
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg("/select,")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open file location: {e}"))?;
    Ok(())
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
                return Err(format!("File does not exist: {path}"));
            }
            Err(e) => return Err(format!("Cannot access file: {e}")),
        };

        if meta.len() > MAX_PDF_SIZE {
            return Err(format!(
                "PDF file is too large ({} MB); this version only supports files up to 50MB",
                meta.len() / 1024 / 1024
            ));
        }

        let bytes = fs::read(p).map_err(|e| format!("Read failed: {e}"))?;

        // 魔数校验：避免用户把改名后的非 PDF 文件传进来
        if !bytes.starts_with(b"%PDF") {
            return Err("This is not a valid PDF file (file header mismatch)".to_string());
        }

        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
}

/// 读取本地图片并 base64 编码（Word 导出嵌入图片用）。
///
/// 与 read_pdf_base64 同理：IPC 走 JSON，二进制必须编码后过通道。
/// 这里只做大小与存在性检查，能不能真正嵌入由前端按扩展名/MIME 判定——
/// 判断失败时前端回落到占位文字，不影响整篇导出。
///
/// 信任边界与 `read_text_file` 一致：path 来自前端对正文里 `src` 的地址解析，
/// 属编辑器语义下的可信输入，故只做「非空 / 不是目录」这类 sanity 检查。
#[tauri::command]
pub async fn read_image_base64(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if path.trim().is_empty() {
            return Err("Image path is empty".to_string());
        }
        let p = Path::new(&path);

        let meta = match fs::metadata(p) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(format!("File does not exist: {path}"));
            }
            Err(e) => return Err(format!("Cannot access file: {e}")),
        };

        // 目标是目录时提前给出明确原因，否则会落到 fs::read 报一句与真实原因无关的错
        if meta.is_dir() {
            return Err(format!("Path is a directory, not an image file: {path}"));
        }

        if meta.len() > MAX_IMAGE_SIZE {
            return Err(format!(
                "Image is too large ({} MB); export only supports images up to 20MB",
                meta.len() / 1024 / 1024
            ));
        }

        let bytes = fs::read(p).map_err(|e| format!("Read failed: {e}"))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
}

/// 跨文件搜索的命中条目（阶段 12：侧边栏「搜索」视图）。
///
/// path 为文件绝对路径，line 为 1 起行号，column 为行内 0 起字符下标，text 为命中行文本。
#[derive(serde::Serialize, Clone)]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub text: String,
}

/// 跨文件搜索的整体结果。
#[derive(serde::Serialize, Clone)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// 实际扫描的文件数（已通过扩展名白名单的文件，含因过大/二进制被跳过的）
    pub files: u32,
    /// 命中数达到上限提前结束（结果可能不完整）
    pub truncated: bool,
}

/// 搜索时整棵跳过的目录名（依赖包 / 版本库 / 构建产物 / 应用自身数据目录）。
///
/// 除通用噪声目录外，还跳过本应用写在配置根下的 `logs` / `themes` / `history`：
/// 用户在主目录里搜索时，这些内部数据既非用户文档，命中还会淹没真实结果。
const SEARCH_SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    ".svn",
    "logs",
    "themes",
    "history",
    "bookmarks",
    "recovery",
];

/// 搜索时纳入的文本文件扩展名白名单（小写，不含点）。
const SEARCH_EXTS: &[&str] = &[
    "md", "markdown", "txt", "html", "htm", "css", "scss", "less", "js", "mjs", "cjs", "ts", "tsx",
    "jsx", "json", "yaml", "yml", "toml", "ini", "cfg", "conf", "xml", "csv", "log", "py", "rs",
    "go", "java", "c", "cpp", "h", "hpp", "sh", "bat", "ps1", "sql", "vue", "svelte", "tex", "rst",
    "adoc",
];

/// 单次搜索最多扫描的文件数（防止在超大仓库上长时间占用后台线程）。
const MAX_SEARCH_FILES: usize = 5000;
/// 单次搜索最多返回的命中数。
const MAX_SEARCH_HITS: usize = 500;
/// 命中行文本的最大字符数，超出则按窗口截取。
const SEARCH_LINE_MAX: usize = 600;
/// 行内过长时，命中位置之前额外保留的字符数（让上下文可见）。
const SEARCH_LINE_LEAD: usize = 100;

/// 跨文件全文搜索（字面量匹配，无正则依赖）。
///
/// 遍历 root 下的文本文件，返回所有含 query 的行；目录遍历与匹配都在后台线程完成，
/// 避免大目录卡住主线程。`max_hits` 为 0 时使用 MAX_SEARCH_HITS。
#[tauri::command]
pub async fn search_files(
    root: String,
    query: String,
    case_sensitive: bool,
    max_hits: u32,
) -> Result<SearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        search_files_blocking(&root, &query, case_sensitive, max_hits)
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn search_files_blocking(
    root: &str,
    query: &str,
    case_sensitive: bool,
    max_hits: u32,
) -> Result<SearchResult, String> {
    // 空查询直接返回空结果（前端此时不应发起请求，这里兜底）
    if query.is_empty() {
        return Ok(SearchResult {
            hits: Vec::new(),
            files: 0,
            truncated: false,
        });
    }

    // 校验根目录，错误文案与 list_dir 对齐
    let meta = match fs::metadata(root) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("Directory does not exist: {root}"));
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err(format!("No permission to access directory: {root}"));
        }
        Err(e) => return Err(format!("Cannot access directory: {e}")),
    };
    if !meta.is_dir() {
        return Err(format!("Directory does not exist: {root}"));
    }

    let limit = if max_hits == 0 {
        MAX_SEARCH_HITS
    } else {
        max_hits as usize
    };
    // 不区分大小写时先折叠一次查询词，避免每行重复折叠
    let needle = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };

    let mut hits: Vec<SearchHit> = Vec::new();
    let mut files: u32 = 0;
    let mut truncated = false;

    // 显式栈做深度优先遍历，避免对深层目录递归调用
    let mut stack: Vec<PathBuf> = vec![PathBuf::from(root)];
    'outer: while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue, // 个别子目录无权限时跳过，不中断整体搜索
        };

        for entry in entries.flatten() {
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let path = entry.path();

            if file_type.is_dir() {
                // 跳过集合内的目录名命中则整棵跳过
                if path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| SEARCH_SKIP_DIRS.contains(&n))
                {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }

            // 文件数达到上限后停止扫描
            if files as usize >= MAX_SEARCH_FILES {
                break 'outer;
            }

            // 扩展名白名单：取末尾点后的小写扩展名
            let ext = match path.extension().and_then(|e| e.to_str()) {
                Some(e) => e.to_ascii_lowercase(),
                None => continue,
            };
            if !SEARCH_EXTS.contains(&ext.as_str()) {
                continue;
            }

            files += 1;

            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }

            let bytes = match fs::read(&path) {
                Ok(b) => b,
                Err(_) => continue,
            };
            // 前 8000 字节含 NUL 视为二进制，跳过
            if bytes[..bytes.len().min(8000)].contains(&0) {
                continue;
            }

            let (text, _) = decode_auto(&bytes);
            let hit_path = path.to_string_lossy().into_owned();

            // 按 '\n' 切行，去掉行尾 '\r'，行号 1 起
            for (idx, raw) in text.split('\n').enumerate() {
                let line = raw.strip_suffix('\r').unwrap_or(raw);

                let found = if case_sensitive {
                    line.find(&needle)
                } else {
                    line.to_lowercase().find(&needle)
                };
                let byte_pos = match found {
                    Some(p) => p,
                    None => continue,
                };

                // 小写折叠可能改变字节长度，byte_pos 未必落在字符边界上，
                // 故用 char_indices 安全地数出匹配前的字符数（等价于前缀的 chars().count()）
                let mut column = line
                    .char_indices()
                    .take_while(|(i, _)| *i < byte_pos)
                    .count();

                let mut text = line.to_string();
                // 整行过长时从命中前方截取窗口，保证返回的 text 内仍含查询词
                if line.chars().count() > SEARCH_LINE_MAX {
                    let start = column.saturating_sub(SEARCH_LINE_LEAD);
                    let window: String = line.chars().skip(start).take(SEARCH_LINE_MAX).collect();
                    text = format!("…{window}");
                    // column 调整为相对该窗口的字符下标（"…" 为展示前缀，不计数）
                    column -= start;
                }

                hits.push(SearchHit {
                    path: hit_path.clone(),
                    line: (idx + 1) as u32,
                    column: column as u32,
                    text,
                });

                // 命中数达到上限立即停止后续扫描
                if hits.len() >= limit {
                    truncated = true;
                    break 'outer;
                }
            }
        }
    }

    Ok(SearchResult {
        hits,
        files,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 编码_id_与编码库双向一致() {
        for id in [
            "utf-8",
            "utf-16le",
            "utf-16be",
            "gb18030",
            "big5",
            "shift_jis",
            "euc-kr",
        ] {
            let enc = encoding_from_id(id).expect("已知编码");
            assert_eq!(id_from_encoding(enc), id, "编码 id 往返应保持一致：{id}");
        }
        // 「UTF-8 带 BOM」是保存差异，解码统一走 UTF-8
        assert_eq!(
            id_from_encoding(encoding_from_id("utf-8-bom").unwrap()),
            "utf-8"
        );
        assert!(encoding_from_id("no-such-encoding").is_none());
    }

    #[test]
    fn 按编码剥离_bom() {
        let utf8_bom = [0xEF, 0xBB, 0xBF, b'a'];
        assert_eq!(strip_bom(&utf8_bom, "utf-8-bom"), b"a");
        // 手动选「UTF-8（不带 BOM）」时，文件里的 BOM 同样要剥掉，避免正文多一个 U+FEFF
        assert_eq!(strip_bom(&utf8_bom, "utf-8"), b"a");
        // BOM 与所选编码不匹配时原样返回
        assert_eq!(strip_bom(&utf8_bom, "gb18030"), &utf8_bom[..]);

        let utf16le = [0xFF, 0xFE, 0x41, 0x00];
        assert_eq!(strip_bom(&utf16le, "utf-16le"), &[0x41, 0x00]);
    }

    #[test]
    fn 只过滤本程序生成的临时文件名() {
        // 本程序的原子写临时文件：`<目标>.<序号>.sticho.tmp`
        assert!(is_atomic_tmp_name("note.md.0.sticho.tmp"));
        assert!(is_atomic_tmp_name("笔记.md.123.sticho.tmp"));
        // 用户真实文件（后缀相同但序号段不是纯数字）不应被隐藏
        assert!(!is_atomic_tmp_name("笔记.sticho.tmp"));
        assert!(!is_atomic_tmp_name("note.md.sticho.tmp"));
        assert!(!is_atomic_tmp_name("note.md.x.sticho.tmp"));
        assert!(!is_atomic_tmp_name("note.md"));
        assert!(!is_atomic_tmp_name(""));
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
        assert_eq!((text.as_str(), id.as_str()), ("hi", "utf-8-bom"));

        let (text, id) = decode_auto(b"plain ascii");
        assert_eq!((text.as_str(), id.as_str()), ("plain ascii", "utf-8"));
    }

    #[test]
    fn 表外编码_id_取规范名且可互逆() {
        // 以前表外一律归一成 windows-1252：cp1251 之类的文件会被标错编码，
        // 保存时又按 windows-1252 编码 → 回读校验失败、保存直接报错。
        let w1251 = encoding_rs::WINDOWS_1251;
        assert_eq!(id_from_encoding(w1251), "windows-1251");
        assert_eq!(encoding_from_id("windows-1251"), Some(w1251));
        // 还原出的编码能把该语言文本原样编解码回去
        let (bytes, _, _) = w1251.encode("Привет");
        assert_eq!(w1251.decode_without_bom_handling(&bytes).0, "Привет");
        // 其余 chardetng 可能返回的编码经 for_label 兜底，都能还原
        for id in [
            "windows-1253",
            "windows-1255",
            "euc-jp",
            "iso-8859-2",
            "koi8-r",
        ] {
            let enc = encoding_from_id(id).unwrap_or_else(|| panic!("{id} 应可还原"));
            assert_eq!(id_from_encoding(enc), id, "编码 id 往返应保持一致：{id}");
        }
    }

    /// 临时测试目录：进程内唯一命名，Drop 时自动清理（并行运行互不冲突）。
    struct 临时目录(std::path::PathBuf);

    impl 临时目录 {
        fn new(名: &str) -> Self {
            use std::sync::atomic::{AtomicU32, Ordering};
            static 计数: AtomicU32 = AtomicU32::new(0);
            let 序号 = 计数.fetch_add(1, Ordering::Relaxed);
            let 时间 = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let 路径 = std::env::temp_dir().join(format!(
                "sticho_search_{名}_{}_{}_{}",
                std::process::id(),
                序号,
                时间
            ));
            fs::create_dir_all(&路径).expect("创建临时目录");
            Self(路径)
        }

        fn str(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for 临时目录 {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn 搜索_基本命中定位行列与文本() {
        let dir = 临时目录::new("basic");
        fs::write(dir.0.join("a.md"), "hello world\nfoo bar").unwrap();

        let r = search_files_blocking(&dir.str(), "world", true, 0).expect("搜索成功");
        assert_eq!(r.files, 1);
        assert!(!r.truncated);
        assert_eq!(r.hits.len(), 1);

        let h = &r.hits[0];
        assert!(h.path.ends_with("a.md"));
        assert_eq!(h.line, 1);
        assert_eq!(h.column, 6); // "hello " 共 6 个字符
        assert_eq!(h.text, "hello world");
    }

    #[test]
    fn 搜索_跳过集合内的目录() {
        let dir = 临时目录::new("skip");
        fs::write(dir.0.join("keep.md"), "needle").unwrap();
        let skip = dir.0.join("node_modules");
        fs::create_dir_all(&skip).unwrap();
        fs::write(skip.join("dep.md"), "needle").unwrap();

        let r = search_files_blocking(&dir.str(), "needle", true, 0).expect("搜索成功");
        assert_eq!(r.hits.len(), 1);
        assert!(r.hits[0].path.ends_with("keep.md"));
        assert!(r.hits.iter().all(|h| !h.path.contains("node_modules")));
    }

    #[test]
    fn 搜索_只扫描白名单扩展名() {
        let dir = 临时目录::new("ext");
        fs::write(dir.0.join("a.md"), "needle").unwrap();
        fs::write(dir.0.join("b.png"), "needle").unwrap();
        fs::write(dir.0.join("c.bin"), "needle").unwrap();

        let r = search_files_blocking(&dir.str(), "needle", true, 0).expect("搜索成功");
        assert_eq!(r.files, 1); // 仅 a.md 进入白名单被扫描
        assert_eq!(r.hits.len(), 1);
        assert!(r.hits[0].path.ends_with("a.md"));
    }

    #[test]
    fn 搜索_大小写敏感开关() {
        let dir = 临时目录::new("case");
        fs::write(dir.0.join("a.md"), "Hello World").unwrap();

        let 敏感 = search_files_blocking(&dir.str(), "hello", true, 0).unwrap();
        assert_eq!(敏感.hits.len(), 0, "区分大小写时不应命中小写查询");

        let 不敏感 = search_files_blocking(&dir.str(), "hello", false, 0).unwrap();
        assert_eq!(不敏感.hits.len(), 1);
        assert_eq!(不敏感.hits[0].column, 0);
    }

    #[test]
    fn 搜索_空查询返回空结果() {
        let dir = 临时目录::new("empty");
        fs::write(dir.0.join("a.md"), "anything").unwrap();

        let r = search_files_blocking(&dir.str(), "", true, 0).unwrap();
        assert!(r.hits.is_empty());
        assert_eq!(r.files, 0);
        assert!(!r.truncated);
    }

    #[test]
    fn 搜索_命中上限触发截断() {
        let dir = 临时目录::new("limit");
        fs::write(dir.0.join("a.md"), "hit\nhit\nhit").unwrap();

        let r = search_files_blocking(&dir.str(), "hit", true, 2).unwrap();
        assert_eq!(r.hits.len(), 2);
        assert!(r.truncated);
    }
}
