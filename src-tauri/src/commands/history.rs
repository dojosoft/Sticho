//! 本地版本历史（「文件」菜单 →「文件历史」）
//!
//! 每次保存覆盖前，把磁盘上的旧内容留一份档，用户误改 / 误保存时可就地回滚。
//! 与 WebDAV 的云端多版本互补：这里完全离线、无需配置。
//!
//! 存储布局：`<数据根>/history/<文档路径哈希前16位>/<yyyymmdd-HHMMSS>.<ext>`
//! - 用路径哈希而非文档名做目录：避免同名文件互相覆盖，也避免非法字符问题。
//! - 目录内另存 `meta.json` 记录原路径，便于日后清理悬挂版本。
//! - 保留份数由设置项 `historyKeep` 决定（默认 20）。

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tauri::AppHandle;

/// 默认保留的历史版本份数
const DEFAULT_KEEP: usize = 20;

/// 每个文档的历史目录内固定写入的元信息文件名
const META_FILE: &str = "meta.json";

/// 历史版本条目（时间与大小都在文件名/文件系统里，无需读正文）
#[derive(serde::Serialize)]
pub struct HistoryEntry {
    /// 快照文件名（回读 / 恢复时作为标识）
    pub file: String,
    /// 快照时间（Unix 秒，取自文件修改时间）
    pub saved_at: u64,
    /// 字节数
    pub size: u64,
}

// ---------------------------------------------------------------- 路径与哈希

/// 文档路径 → 历史目录名：路径归一化后的 SHA-256 前 16 位十六进制。
///
/// 归一化（反斜杠 + 小写）是因为 Windows 路径大小写不敏感，同一文件的不同写法
/// 必须落到同一个历史目录，否则「打开方式不同 → 历史分裂」。
fn doc_key(path: &str) -> String {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    let mut s = String::with_capacity(16);
    for b in &digest[..8] {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// 历史根目录：`<数据根>/history`
fn history_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(super::config::data_root(app)?.join("history"))
}

/// 某文档的历史目录（不创建）
fn doc_dir(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    Ok(history_root(app)?.join(doc_key(path)))
}

/// 快照文件名的合法性校验：只允许 `[A-Za-z0-9._-]`，且不得是 meta.json。
///
/// 这是安全边界——文件名来自前端，必须挡住 `..\..\` 之类的路径穿越。
fn is_valid_entry(name: &str) -> bool {
    !name.is_empty()
        && name != META_FILE
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

// ---------------------------------------------------------------- 留档

/// 保存前留档：目标已存在且与即将写入的内容不同时，才把旧内容存为新版本。
///
/// 任何失败都静默忽略——留档是「尽力而为」的辅助功能，绝不能阻断或干扰保存。
pub fn snapshot_if_changed(app: &AppHandle, path: &str, new_bytes: &[u8]) {
    let Ok(existing) = fs::read(path) else {
        return; // 目标不存在（新建文件）：没有旧内容可留
    };
    if existing == new_bytes {
        return; // 内容没变：不留重复档
    }
    let _ = save_snapshot(app, path, &existing);
}

/// 把一段字节存为该文档的一个历史版本，并按保留份数裁剪旧版本。
fn save_snapshot(app: &AppHandle, path: &str, bytes: &[u8]) -> Result<(), String> {
    let dir = doc_dir(app, path)?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建历史目录：{e}"))?;

    // 去重：与最新一份内容完全相同则跳过（例如连续恢复同一版本）
    if let Some(newest) = newest_entry(&dir) {
        if fs::read(dir.join(&newest)).map(|b| b == bytes).unwrap_or(false) {
            return Ok(());
        }
    }

    let secs = crate::logging::now_secs();
    let ext = ext_of(path);
    let name = unique_name(&dir, &crate::logging::compact_stamp(secs), &ext);
    let target = dir.join(&name);
    super::file_io::atomic_write(&target.to_string_lossy(), bytes)?;

    write_meta(&dir, path);
    prune(&dir, history_keep(app));
    Ok(())
}

/// 原文件扩展名（不含点）；无扩展名时用 `txt`
fn ext_of(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .filter(|e| !e.is_empty())
        .unwrap_or_else(|| "txt".into())
}

/// 避免同一秒内多次保存撞名：已存在时追加 `-1`、`-2`…
fn unique_name(dir: &Path, stamp: &str, ext: &str) -> String {
    let first = format!("{stamp}.{ext}");
    if !dir.join(&first).exists() {
        return first;
    }
    for n in 1..=1000 {
        let candidate = format!("{stamp}-{n}.{ext}");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    first
}

/// 记录该历史目录对应的原始文档路径（仅供人工排查，读取失败不影响主流程）
fn write_meta(dir: &Path, path: &str) {
    let meta = serde_json::json!({
        "path": path,
        "name": Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
    });
    let _ = super::file_io::atomic_write(
        &dir.join(META_FILE).to_string_lossy(),
        meta.to_string().as_bytes(),
    );
}

/// 目录内最新的快照文件名（按名字字典序，等同于按时间序）
fn newest_entry(dir: &Path) -> Option<String> {
    list_entries(dir)
        .ok()?
        .first()
        .map(|e| e.file.clone())
}

/// 保留最新 `keep` 份，删除其余。
fn prune(dir: &Path, keep: usize) {
    let Ok(entries) = list_entries(dir) else {
        return;
    };
    for e in entries.into_iter().skip(keep) {
        let _ = fs::remove_file(dir.join(&e.file));
    }
}

// ---------------------------------------------------------------- 列举与回读

/// 列出目录内的历史版本，按时间（名字）降序。
fn list_entries(dir: &Path) -> Result<Vec<HistoryEntry>, String> {
    let read = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()), // 目录不存在 = 暂无历史
    };

    let mut out = Vec::new();
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        if !is_valid_entry(&name) {
            continue;
        }
        let Ok(meta) = item.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let saved_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        out.push(HistoryEntry { file: name, saved_at, size: meta.len() });
    }
    out.sort_by(|a, b| b.file.cmp(&a.file));
    Ok(out)
}

/// 列出某文档的全部历史版本（降序）。
#[tauri::command]
pub fn list_history(app: AppHandle, path: String) -> Result<Vec<HistoryEntry>, String> {
    let dir = doc_dir(&app, &path)?;
    list_entries(&dir)
}

/// 读取某个历史版本的正文（按原文件编码自动检测解码）。
#[tauri::command]
pub fn read_history(app: AppHandle, path: String, file: String) -> Result<String, String> {
    if !is_valid_entry(&file) {
        return Err("历史版本标识非法".into());
    }
    let target = doc_dir(&app, &path)?.join(&file);
    let bytes = fs::read(&target).map_err(|e| format!("读取历史版本失败：{e}"))?;
    let (content, _encoding) = super::file_io::decode_auto(&bytes);
    Ok(content)
}

/// 恢复某个历史版本：先把**当前磁盘内容**再留一份档（保证「恢复」本身可撤销），
/// 然后返回历史正文，由前端载入编辑器。
#[tauri::command]
pub fn restore_history(app: AppHandle, path: String, file: String) -> Result<String, String> {
    let content = read_history(app.clone(), path.clone(), file)?;
    if let Ok(current) = fs::read(&path) {
        let _ = save_snapshot(&app, &path, &current);
    }
    Ok(content)
}

/// 某个文档的历史版本分组（恢复中心用，见 `list_all_history`）
#[derive(serde::Serialize)]
pub struct HistoryDoc {
    /// 原文档绝对路径（来自 meta.json）
    pub path: String,
    /// 文档名（文件名）
    pub name: String,
    /// 该文档的历史版本（按时间降序）
    pub entries: Vec<HistoryEntry>,
}

/// 从某历史目录的 meta.json 取出原文档路径与文件名。
///
/// 拿不到路径就返回 None：没有原路径既不能回读正文，也不能恢复 / 另存，
/// 列到界面上只会误导用户。
fn read_meta(dir: &Path) -> Option<(String, String)> {
    let text = fs::read_to_string(dir.join(META_FILE)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let path = v.get("path")?.as_str()?.to_string();
    if path.is_empty() {
        return None;
    }
    let name = match v.get("name").and_then(|n| n.as_str()) {
        Some(n) if !n.is_empty() => n.to_string(),
        _ => Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
    };
    Some((path, name))
}

/// 列出**全部文档**的本地历史版本，按最近有改动排序（恢复中心）。
///
/// 与 `list_history` 的区别：那条只认单个路径（文件菜单 →「文件历史」），
/// 这条遍历整个 `history/` 目录，供「恢复中心」一次性呈现所有留档。
#[tauri::command]
pub fn list_all_history(app: AppHandle) -> Result<Vec<HistoryDoc>, String> {
    let root = history_root(&app)?;
    let read = match fs::read_dir(&root) {
        Ok(r) => r,
        Err(_) => return Ok(Vec::new()), // 还没有任何历史，不算错误
    };

    let mut docs: Vec<HistoryDoc> = Vec::new();
    for item in read.flatten() {
        let dir = item.path();
        if !dir.is_dir() {
            continue;
        }
        let Some((path, name)) = read_meta(&dir) else { continue };
        let entries = list_entries(&dir)?;
        if entries.is_empty() {
            continue;
        }
        docs.push(HistoryDoc { path, name, entries });
    }

    // 最近有改动的文档排前面（entries 已降序，取首条时间即可）
    docs.sort_by(|a, b| {
        let at = a.entries.first().map(|e| e.saved_at).unwrap_or(0);
        let bt = b.entries.first().map(|e| e.saved_at).unwrap_or(0);
        bt.cmp(&at)
    });
    Ok(docs)
}

/// 删除某个历史版本（幂等：文件本就不存在时返回 `Ok(())`）。
#[tauri::command]
pub fn delete_history(app: AppHandle, path: String, file: String) -> Result<(), String> {
    if !is_valid_entry(&file) {
        return Err("历史版本标识非法".into());
    }
    let target = doc_dir(&app, &path)?.join(&file);
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除历史版本失败：{e}")),
    }
}

/// 保留份数：读设置项 `historyKeep`，缺失或非法时用默认值（并夹在 1..=200）。
fn history_keep(app: &AppHandle) -> usize {
    super::config::get_settings_path(app.clone())
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("historyKeep").and_then(|n| n.as_u64()))
        .map(|n| n.clamp(1, 200) as usize)
        .unwrap_or(DEFAULT_KEEP)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 路径哈希归一化大小写与斜杠() {
        let a = doc_key(r"D:\Docs\A.md");
        let b = doc_key(r"d:/docs/a.md");
        assert_eq!(a, b, "同一文件的不同写法必须落到同一历史目录");
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn 不同文档哈希不同() {
        assert_ne!(doc_key(r"D:\a.md"), doc_key(r"D:\b.md"));
    }

    #[test]
    fn 文件名校验挡住路径穿越() {
        assert!(is_valid_entry("20260101-120000.md"));
        assert!(is_valid_entry("20260101-120000-1.md"));
        assert!(!is_valid_entry("meta.json"));
        assert!(!is_valid_entry(r"..\..\windows\system32"));
        assert!(!is_valid_entry("a/b.md"));
        assert!(!is_valid_entry(""));
    }

    #[test]
    fn 扩展名兜底与提取() {
        assert_eq!(ext_of(r"D:\a.md"), "md");
        assert_eq!(ext_of(r"D:\README"), "txt");
    }

    #[test]
    fn 读取历史目录元信息() {
        let dir = std::env::temp_dir().join(format!("sticho-meta-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        assert!(read_meta(&dir).is_none(), "没有 meta.json 时应返回 None");

        fs::write(dir.join(META_FILE), r#"{"path":"D:\\Docs\\A.md","name":"A.md"}"#).unwrap();
        assert_eq!(read_meta(&dir), Some((r"D:\Docs\A.md".to_string(), "A.md".to_string())));

        // name 缺失 / 为空时用文件名兜底
        fs::write(dir.join(META_FILE), r#"{"path":"D:\\Docs\\B.md"}"#).unwrap();
        assert_eq!(read_meta(&dir), Some((r"D:\Docs\B.md".to_string(), "B.md".to_string())));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 裁剪只保留最新若干份() {
        let dir = std::env::temp_dir().join(format!("sticho-hist-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // 名字字典序即时间序：造 5 份
        for stamp in ["20260101-000001", "20260101-000002", "20260101-000003", "20260101-000004", "20260101-000005"] {
            fs::write(dir.join(format!("{stamp}.md")), stamp.as_bytes()).unwrap();
        }
        prune(&dir, 3);

        let left = list_entries(&dir).unwrap();
        assert_eq!(left.len(), 3);
        assert_eq!(left[0].file, "20260101-000005.md", "最新的保留在最前");
        assert_eq!(left[2].file, "20260101-000003.md");

        let _ = fs::remove_dir_all(&dir);
    }
}