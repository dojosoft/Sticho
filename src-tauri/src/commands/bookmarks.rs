//! 书签持久化命令。
//!
//! 书签存在本地配置目录下的**独立文件夹** `<数据根目录>/bookmarks/`，与
//! `history`（版本历史）、`recovery`（自动保存草稿）平级，互不干扰。
//!
//! 存储布局：`<数据根目录>/bookmarks/<owner 哈希前 16 位>.json`
//! - `owner` 是「文档身份」：已保存的文档用绝对路径，未命名文档用草稿 id
//!   （草稿 id 在会话恢复后保持不变，故未命名文档的书签也能跨重启保留）。
//! - 文件名用哈希而非原文：既避开非法字符，也不把用户路径暴露在配置目录里。
//! - 一个文档一个 JSON 文件，内容由前端自行序列化，这里只做原样存取。

use std::fs;
use std::path::PathBuf;

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::file_io::atomic_write;

/// owner 的长度上限（防御性校验；owner 只参与哈希，不会拼进文件名）
const MAX_OWNER_LEN: usize = 4096;

/// 书签根目录：`<数据根>/bookmarks`，不存在则创建
fn bookmarks_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = super::config::data_root(app)?.join("bookmarks");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create bookmarks directory: {e}"))?;
    Ok(dir)
}

/// 文档身份 → 文件名：归一化（反斜杠 + 小写）后的 SHA-256 前 16 位十六进制。
///
/// 归一化是为了让 Windows 上同一路径的不同写法落到同一个文件（大小写不敏感）。
fn owner_key(owner: &str) -> String {
    let normalized = owner.replace('/', "\\").to_ascii_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    let mut s = String::with_capacity(16);
    for b in &digest[..8] {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// owner 合法性校验（空串或超长直接拒绝）
fn check_owner(owner: &str) -> Result<(), String> {
    if owner.is_empty() || owner.len() > MAX_OWNER_LEN {
        return Err("Invalid bookmark owner".to_string());
    }
    Ok(())
}

/// 某文档的书签文件路径
fn entry_path(app: &AppHandle, owner: &str) -> Result<PathBuf, String> {
    Ok(bookmarks_root(app)?.join(format!("{}.json", owner_key(owner))))
}

/// 保存书签（覆盖写；`data` 是前端序列化好的 JSON）
#[tauri::command]
pub async fn bookmarks_save(app: AppHandle, owner: String, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_owner(&owner)?;
        let path = entry_path(&app, &owner)?;
        atomic_write(&path.to_string_lossy(), data.as_bytes())
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
}

/// 读取书签；文件不存在或内容为空都返回 `None`
#[tauri::command]
pub async fn bookmarks_load(app: AppHandle, owner: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_owner(&owner)?;
        let path = entry_path(&app, &owner)?;
        match fs::read_to_string(&path) {
            Ok(text) if !text.trim().is_empty() => Ok(Some(text)),
            Ok(_) => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("Failed to read bookmarks: {e}")),
        }
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
}

/// 删除该书签文件（清空全部书签时调用；不存在也算成功）
#[tauri::command]
pub async fn bookmarks_delete(app: AppHandle, owner: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_owner(&owner)?;
        let path = entry_path(&app, &owner)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Failed to delete bookmarks: {e}")),
        }
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
}
