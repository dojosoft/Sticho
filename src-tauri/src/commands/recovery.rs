//! 恢复草稿命令（批次四：自动保存与崩溃恢复）
//!
//! 为什么不复用 plugin-store：settings.json 每次 save 都是整量重写，且没有原子写。
//! 一篇 3MB 的文档每 30 秒全量重写一次既慢又可能在写一半时崩溃。改为「一份草稿一个
//! 文件 + 原子写」，单份损坏也不影响其他草稿。
//!
//! 参数名全部使用单段词（app / id / path / title / kind / encoding / content）：
//! Tauri v2 默认把 Rust 命令参数按 camelCase 暴露给 JS，多词参数名容易两边对不上。

use std::path::PathBuf;

use super::file_io::atomic_write;

/// 草稿 id 的最大长度（同时限制文件名长度）
const MAX_ID_LEN: usize = 64;

/// 草稿正文文件的扩展名。
///
/// 正文与元信息**分开存放**：`list_recovery` 只读体积很小的元信息 JSON，
/// 不必为拿几个字段就把整篇大文档读进内存。
const CONTENT_EXT: &str = "txt";

/// 取草稿目录：`<数据根目录>/recovery`，不存在则创建。
///
/// 数据根目录由 `config::data_root` 决定（用户目录或程序目录）。
fn recovery_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = super::config::data_root(app)?.join("recovery");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create drafts directory: {e}"))?;
    Ok(dir)
}

/// 校验草稿 id：只允许 `[A-Za-z0-9._-]` 且长度 ≤ 64。
///
/// id 会拼进文件名，不校验就等于把路径穿越的钥匙交给前端（`../../x`）。
fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return Err(format!("Invalid draft id: {id}"));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(format!("Invalid draft id: {id}"));
    }
    Ok(())
}

/// 草稿元信息（不含正文）。`list_recovery` 只返回它，避免把大文档整体读进列表。
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct RecoveryMeta {
    pub id: String,
    /// 原文件绝对路径；未命名文档为 None
    pub path: Option<String>,
    pub title: String,
    /// "markdown" | "html"
    pub kind: String,
    pub encoding: String,
    /// Unix 秒
    pub saved_at: u64,
    /// 正文字符数
    pub chars: usize,
}

/// 旧版草稿结构：元信息与正文同在 `.json` 里。仅用于兼容读取历史草稿。
///
/// 只取 `content`：元信息那部分字段（id/title/…）当前不需要，serde 默认忽略未知字段。
#[derive(serde::Deserialize)]
struct LegacyRecoveryFile {
    content: String,
}

/// 写入一份恢复草稿（原子写，避免写一半崩溃留下半截草稿）。
///
/// 自动保存定时每 30 秒就可能触发一次，大文档（数 MB）的序列化与两次
/// 原子写不能占用主线程——同步命令在 Tauri v2 里跑在主线程，会卡 UI。
#[tauri::command]
pub async fn write_recovery(
    app: tauri::AppHandle,
    id: String,
    path: Option<String>,
    title: String,
    kind: String,
    encoding: String,
    content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_recovery_blocking(&app, &id, path, title, kind, encoding, content)
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn write_recovery_blocking(
    app: &tauri::AppHandle,
    id: &str,
    path: Option<String>,
    title: String,
    kind: String,
    encoding: String,
    content: String,
) -> Result<(), String> {
    check_id(id)?;

    let saved_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let dir = recovery_dir(app)?;
    let meta = RecoveryMeta {
        id: id.to_string(),
        path,
        title,
        kind,
        encoding,
        saved_at,
        chars: content.chars().count(),
    };

    // 正文单独存一份（列表阶段不必再读它），元信息随后原子写。
    // 顺序上先写正文后写元信息：这样「能被列出来的草稿」一定已经有正文。
    let content_path = dir.join(format!("{id}.{CONTENT_EXT}"));
    atomic_write(&content_path.to_string_lossy(), content.as_bytes())?;

    let json =
        serde_json::to_string(&meta).map_err(|e| format!("Failed to serialize draft: {e}"))?;
    let target = dir.join(format!("{id}.json"));
    atomic_write(&target.to_string_lossy(), json.as_bytes())
}

/// 列出全部草稿元信息，按 `saved_at` 降序（最近的在前）。
///
/// 解析失败的文件直接跳过：一份坏草稿不应该让恢复提示整体消失。
#[tauri::command]
pub async fn list_recovery(app: tauri::AppHandle) -> Result<Vec<RecoveryMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || list_recovery_blocking(&app))
        .await
        .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn list_recovery_blocking(app: &tauri::AppHandle) -> Result<Vec<RecoveryMeta>, String> {
    let dir = recovery_dir(app)?;

    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("Failed to read drafts directory: {e}"))?;

    let mut list: Vec<RecoveryMeta> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        // 直接按元信息反序列化：新版元信息 JSON 本就只有这些字段；
        // 旧版草稿多出的 content 字段会被 serde 忽略，因此同样能读出。
        let Ok(meta) = serde_json::from_str::<RecoveryMeta>(&text) else {
            continue;
        };
        list.push(meta);
    }

    list.sort_by_key(|a| std::cmp::Reverse(a.saved_at));
    Ok(list)
}

/// 读取一份草稿的正文；文件不存在返回 `Ok(None)`（不算错误）。
#[tauri::command]
pub async fn read_recovery(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || read_recovery_blocking(&app, &id))
        .await
        .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn read_recovery_blocking(app: &tauri::AppHandle, id: &str) -> Result<Option<String>, String> {
    check_id(id)?;
    let dir = recovery_dir(app)?;

    // 新版：正文单独存在 .txt 里
    let content_path = dir.join(format!("{id}.{CONTENT_EXT}"));
    match std::fs::read_to_string(&content_path) {
        Ok(t) => return Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to read draft: {e}")),
    }

    // 兼容旧版：正文内嵌在 .json 里
    let legacy = dir.join(format!("{id}.json"));
    let text = match std::fs::read_to_string(&legacy) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Failed to read draft: {e}")),
    };
    let file: LegacyRecoveryFile =
        serde_json::from_str(&text).map_err(|e| format!("Draft content is corrupted: {e}"))?;
    Ok(Some(file.content))
}

/// 删除一份草稿（元信息 + 正文两个文件）。文件本就不存在时返回 `Ok(())`（幂等）。
#[tauri::command]
pub async fn delete_recovery(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_recovery_blocking(&app, &id))
        .await
        .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn delete_recovery_blocking(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    check_id(id)?;
    let dir = recovery_dir(app)?;

    let mut first_err: Option<String> = None;
    for ext in ["json", CONTENT_EXT] {
        match std::fs::remove_file(dir.join(format!("{id}.{ext}"))) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(format!("Failed to delete draft: {e}"));
                }
            }
        };
    }
    match first_err {
        Some(msg) => Err(msg),
        None => Ok(()),
    }
}
