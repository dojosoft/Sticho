//! 自定义 CSS 主题（批次八）
//!
//! 用户在 `%APPDATA%\<identifier>\themes\` 下放任意 `.css`，皮肤菜单即会列出；
//! 选中后由前端把内容注入 `<style id="md-studio-user-theme">`，无需重启。
//! 本模块只负责「目录在哪 / 有哪些主题 / 打开目录」，不解析 CSS。

use std::fs;
use std::process::Command;

use serde::Serialize;
use tauri::AppHandle;

/// 单个主题文件（名称 + 内容）
#[derive(Serialize)]
pub struct ThemeFile {
    name: String,
    css: String,
}

/// 主题目录（不存在时创建）。数据根目录由 `config::data_root` 决定。
fn themes_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = super::config::data_root(app)?.join("themes");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create themes directory: {e}"))?;
    Ok(dir)
}

/// 列出主题目录下的全部 .css（按文件名排序，含内容）
///
/// 主题目录可能有几十个文件、每个都要读盘，放后台线程避免阻塞主线程。
#[tauri::command]
pub async fn load_themes(app: AppHandle) -> Result<Vec<ThemeFile>, String> {
    tauri::async_runtime::spawn_blocking(move || load_themes_blocking(&app))
        .await
        .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn load_themes_blocking(app: &AppHandle) -> Result<Vec<ThemeFile>, String> {
    let dir = themes_dir(app)?;
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read themes directory: {e}"))?;

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_css = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("css"))
            .unwrap_or(false);
        if !is_css {
            continue;
        }
        // 主题 css 不该很大；异常大文件或读不到元信息的一律跳过
        let size = match entry.metadata() {
            Ok(m) => m.len(),
            Err(_) => continue,
        };
        if size > 2 * 1024 * 1024 {
            continue;
        }
        let Some(name) = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        // 编码按 UTF-8 宽松解码：主题里偶有非 UTF-8 注释也不该整体失效
        let css = String::from_utf8_lossy(
            &fs::read(&path).map_err(|e| format!("Failed to read theme: {e}"))?,
        )
        .into_owned();
        out.push(ThemeFile { name, css });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 在资源管理器中打开主题目录，返回目录绝对路径（供界面提示）
#[tauri::command]
pub fn open_theme_dir(app: AppHandle) -> Result<String, String> {
    let dir = themes_dir(&app)?;
    Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Failed to open themes directory: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}
