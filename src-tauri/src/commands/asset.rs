//! 图片落盘命令（批次三：图片资源管理）
//!
//! 为什么不再把图片读成 data URI 内联进正文：一张 3MB 的照片转成 base64 后正文要涨
//! 4MB，文档随之臃肿、保存与渲染都变慢。改为把二进制写进「文档同级 assets 目录」，
//! 正文只留相对路径 `assets/xxx.png`——文档连同 assets 目录整体拷走仍能正常显示，
//! 与 Typora 的 `./assets` 习惯一致。
//!
//! 参数名全部使用单段词（path / name / data）：Tauri v2 默认把 Rust 命令参数按
//! camelCase 暴露给 JS，多词参数名容易两边对不上，单段词没有这个歧义。

use std::fs;
use std::path::Path;

use base64::Engine as _;
use tauri::Manager as _;

use super::file_io::atomic_write;

/// 图片体积硬上限 20MB（前端另有 5MB 的软限制，这里防的是绕过前端的直接调用）
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// 文件名主干长度上限（字符数，不是字节数：中文名按字算才不会截成半个字）
const MAX_STEM_CHARS: usize = 64;

/// 落盘目录名（与文档同级）
const ASSET_DIR_NAME: &str = "assets";

/// 按魔数判断图片类型并给出扩展名。
///
/// 不信任前端传来的扩展名：把 .exe 改名成 .png 也能选进来，只看扩展名就等于允许
/// 往 assets 目录里塞任意二进制。
fn detect_image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("png");
    }
    if bytes.len() >= 3 && bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("jpg");
    }
    if bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return Some("gif");
    }
    if bytes.len() >= 18
        && bytes.starts_with(b"BM")
        // 只认 "BM" 会把以 BM 开头的文本文件误判成图片；真正的 BMP 还有两个特征：
        // 保留字段（偏移 6-9）通常为 0，且 DIB 头尺寸（偏移 14-17，小端）是已知取值。
        && bytes[6..10].iter().all(|b| *b == 0)
        && matches!(
            u32::from_le_bytes([bytes[14], bytes[15], bytes[16], bytes[17]]),
            12 | 40 | 52 | 56 | 64 | 108 | 124
        )
    {
        return Some("bmp");
    }
    // WEBP：RIFF 容器，第 8-12 字节是 "WEBP"
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    None
}

/// Windows 保留设备名（不区分大小写，带任何扩展名也算）不能作为文件名主干。
///
/// `CON` / `PRN` / `AUX` / `NUL` 与 `COM1`~`COM9`、`LPT1`~`LPT9` 指向系统设备，
/// 用它们建文件会被系统静默拒绝或指向设备，导致插图写入失败。
fn is_reserved_stem(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    for prefix in ["COM", "LPT"] {
        if let Some(rest) = upper.strip_prefix(prefix) {
            if let Ok(n) = rest.parse::<u8>() {
                return (1..=9).contains(&n);
            }
        }
    }
    false
}

/// 净化文件名主干：剔除 Windows 不允许的字符与控制字符，限长；全部被剔掉时退回 "image"。
fn sanitize_stem(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let cleaned: String = stem
        .chars()
        .filter(|c| {
            !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control()
        })
        .take(MAX_STEM_CHARS)
        .collect();
    // 结尾的点和空格在 Windows 上会被静默丢弃，留着会与实际落盘的文件名对不上
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    let stem = if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed
    };
    // 保留设备名无法落盘，加下划线前缀规避
    if is_reserved_stem(&stem) {
        format!("_{stem}")
    } else {
        stem
    }
}

/// 依次尝试 `stem.ext`、`stem-1.ext`、`stem-2.ext`…，返回一个尚未被占用的路径。
fn unique_path(dir: &Path, stem: &str, ext: &str) -> std::path::PathBuf {
    let mut candidate = dir.join(format!("{stem}.{ext}"));
    let mut index = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{stem}-{index}.{ext}"));
        index += 1;
    }
    candidate
}

/// 图片落盘：把 base64 图片写进「文档同级 assets 目录」，返回写入的绝对路径。
///
/// 前端据此算出 Markdown 里的相对路径，以及预览要用的 asset URL
/// （相对路径若含 `..` 会被 asset 协议的 SafePathBuf 拒绝，故两边都基于绝对路径）。
///
/// base64 解码可放大到 20MB、写盘也要时间，放后台线程避免卡住主线程。
#[tauri::command]
pub async fn save_image_asset(path: String, name: String, data: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || save_image_asset_blocking(&path, &name, &data))
        .await
        .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn save_image_asset_blocking(path: &str, name: &str, data: &str) -> Result<String, String> {
    // 未保存的新文档没有落盘位置，前端也会先拦一道，这里再校验一次
    if path.trim().is_empty() || !Path::new(path).is_absolute() {
        return Err("Please save the document before inserting an image".to_string());
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "Failed to parse image data".to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "Image exceeds {} MB and cannot be inserted",
            MAX_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let ext = detect_image_ext(&bytes)
        .ok_or_else(|| "Unsupported image format (PNG/JPEG/GIF/BMP/WEBP)".to_string())?;

    let doc = Path::new(path);
    let dir = doc
        .parent()
        .ok_or_else(|| "Invalid document path".to_string())?
        .join(ASSET_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create assets directory: {e}"))?;

    let target = unique_path(&dir, &sanitize_stem(name), ext);
    let target = target
        .to_str()
        .ok_or_else(|| "Image path contains unsupported characters".to_string())?
        .to_string();
    atomic_write(&target, &bytes)?;
    Ok(target)
}

/// 目录本身或其上层是系统目录：`lower` 与 `base`（或 `base\` 前缀）相等才算命中，
/// 纯 starts_with 会把 `C:\Windows.old`、`C:\Program Files (x86)\自助工具` 这类
/// 用户目录误判成系统目录
fn under_or_eq(lower: &str, base: &str) -> bool {
    lower == base || lower.starts_with(&format!("{base}\\"))
}

/// 根目录 / Windows 系统目录不应放行给 asset 协议。
///
/// 放行的目的是让文档里的相对路径图片能显示；盘符根（`D:\`）与系统目录里不存在
/// 这种相对资源，放行只会无谓扩大「预览区 XSS → 读文件」的暴露面，故直接拒绝。
fn is_forbidden_asset_dir(dir: &Path) -> bool {
    // 盘符根 / 无父路径：`D:\` 的 parent() 为 None
    if dir.parent().is_none() {
        return true;
    }
    let lower = dir
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    let windir = std::env::var("SystemRoot")
        .unwrap_or_else(|_| "C:\\Windows".to_string())
        .replace('/', "\\")
        .to_ascii_lowercase();
    under_or_eq(&lower, &windir)
        || under_or_eq(&lower, "c:\\windows")
        || under_or_eq(&lower, "c:\\program files")
        || under_or_eq(&lower, "c:\\program files (x86)")
}

/// 把「某个文档所在目录」（含子目录）放行给 asset 协议读取。
///
/// 静态 scope 已收窄为空（`tauri.conf.json` 的 `assetProtocol.scope` 为 `[]`），
/// 打开 / 另存文档时由前端调用本命令放行该文档目录，正文里的相对路径图片
/// （含应用插图写入的同级 `assets/` 子目录）才能经 asset 协议加载。
///
/// 只累积不放行回收：Tauri 的 `Scope` 只有 allow / forbid 两组 glob，
/// 且 forbid **永久生效、无撤销接口**（见 tauri 源码 `scope/fs.rs` 的
/// `forbid_directory` 注释），用它「回收」旧目录会让再次打开该目录永远失败，
/// 故此处只累积。放行集合 = 本次运行中真正打开过的文档目录，仍远小于
/// 原先的整盘 `**/*`，把「预览区 XSS → 读整盘文件」的链路收窄到已打开的目录。
///
/// 含 `..` 段的路径直接拒绝：`D:\Docs\..\..\Windows` 的字符串前缀并不是系统目录，
/// 能骗过 `is_forbidden_asset_dir`，但按路径语义展开后真正放行的却是系统目录。
#[tauri::command]
pub fn allow_asset_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    if dir.trim().is_empty() {
        return Ok(());
    }
    // 先挡住 `..` 段（必须在系统目录判定之前：判定用的是字符串前缀，绕得过去）
    if Path::new(&dir)
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("This directory is not allowed to be opened for image preview".to_string());
    }
    if is_forbidden_asset_dir(Path::new(&dir)) {
        return Err("This directory is not allowed to be opened for image preview".to_string());
    }
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|e| format!("Failed to allow the image directory: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 保留设备名会被加前缀规避() {
        assert!(is_reserved_stem("CON"));
        assert!(is_reserved_stem("con"));
        assert!(is_reserved_stem("COM1"));
        assert!(is_reserved_stem("lpt9"));
        assert!(!is_reserved_stem("COM0"));
        assert!(!is_reserved_stem("COM10"));
        assert!(!is_reserved_stem("CONTEXT"));
        assert_eq!(sanitize_stem("CON"), "_CON");
        assert_eq!(sanitize_stem("aux.png"), "_aux");
    }

    #[test]
    fn bmp_头部校验挡住误判() {
        // 合法 BMP：BM + 保留字段为 0 + DIB 头 40
        let mut bmp = vec![b'B', b'M', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        bmp.extend_from_slice(&40u32.to_le_bytes());
        assert_eq!(detect_image_ext(&bmp), Some("bmp"));

        // 仅以 "BM" 开头的文本（保留字段非 0）不应被当成图片
        assert_eq!(detect_image_ext(b"BMW is a car brand"), None);
    }

    #[test]
    fn 盘符根与系统目录被拒() {
        assert!(is_forbidden_asset_dir(Path::new("D:\\")));
        assert!(!is_forbidden_asset_dir(Path::new("D:\\trae-projects")));
    }
}
