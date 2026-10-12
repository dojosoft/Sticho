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
    if bytes.len() >= 2 && bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    // WEBP：RIFF 容器，第 8-12 字节是 "WEBP"
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    None
}

/// 净化文件名主干：剔除 Windows 不允许的字符与控制字符，限长；全部被剔掉时退回 "image"。
fn sanitize_stem(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let cleaned: String = stem
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control())
        .take(MAX_STEM_CHARS)
        .collect();
    // 结尾的点和空格在 Windows 上会被静默丢弃，留着会与实际落盘的文件名对不上
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed
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
        .map_err(|e| format!("任务调度失败：{e}"))?
}

fn save_image_asset_blocking(path: &str, name: &str, data: &str) -> Result<String, String> {
    // 未保存的新文档没有落盘位置，前端也会先拦一道，这里再校验一次
    if path.trim().is_empty() || !Path::new(path).is_absolute() {
        return Err("请先保存文档，再插入图片".to_string());
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "图片数据解析失败".to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "图片超过 {} MB，无法插入",
            MAX_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let ext = detect_image_ext(&bytes).ok_or_else(|| "不是支持的图片格式（PNG/JPEG/GIF/BMP/WEBP）".to_string())?;

    let doc = Path::new(path);
    let dir = doc
        .parent()
        .ok_or_else(|| "文档路径无效".to_string())?
        .join(ASSET_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("创建 assets 目录失败：{e}"))?;

    let target = unique_path(&dir, &sanitize_stem(name), ext);
    let target = target
        .to_str()
        .ok_or_else(|| "图片路径包含无法处理的字符".to_string())?
        .to_string();
    atomic_write(&target, &bytes)?;
    Ok(target)
}