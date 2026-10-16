//! 用户包目录：语言包 / 主题包 / 字体包（批次十二）
//!
//! 各类资源都放在**配置根目录**下的同名子目录里，用户把文件丢进去即可自动加载：
//! - `locales/*.json`：语言包，键为英文原文、值为译文，特殊键 `_label` 是语言显示名、
//!   `_version` 是释放时的软件版本（见下）；
//! - `themes/*.css`：主题包（列出与读取由 `theme.rs` 负责，这里只管默认释放与目录打开）；
//! - `fonts/*.{ttf,otf,woff,woff2}`：字体包，前端注册为 `@font-face` 后出现在「阅读排版 → 字体」。
//!
//! `docs/` 目录（欢迎页正文）已下线：程序不再释放也不读取它，存量安装里已释放的
//! `Welcome.<locale>.md` / `README.txt` 由 retire_removed_packs 一次性删掉。
//!
//! 「释放默认文件」由前端把内容传进来（TS 是内容的唯一真源，避免把整张词表在 Rust 里
//! 再抄一份）：不带 `version` 的文件（主题 / 字体 / 说明）目标**已存在时一律不覆盖**，
//! 用户的改动永远不会被升级冲掉。
//!
//! 自带语言包（内置 en-US / zh-CN，未来可增）统一带 `version`：目标缺失时释放补充，
//! 已存在且其中 `_version` 低于当前内置版本（软件版本号 + 词表指纹）时覆盖重写——保证内置词表始终跟到最新版本。
//! 该规则与语种、文件名无关，新增自带语言包沿用即可；用户自备的语言包不带 version，
//! 因此不会被覆盖。

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager as _;

/// 单个包文件体积上限（语言包 / 主题都是文本，异常大的直接跳过，防止读爆内存）
const MAX_PACK_BYTES: u64 = 2 * 1024 * 1024;

/// 包目录名（与 `config::DATA_ITEMS` 保持一致）
pub(crate) const LOCALES_DIR: &str = "locales";
pub(crate) const FONTS_DIR: &str = "fonts";
pub(crate) const THEMES_DIR: &str = "themes";
/// 已下线的欢迎页正文目录：不再读写，仅用于一次性清理存量文件（见 retire_removed_packs）
pub(crate) const DOCS_DIR: &str = "docs";

/// 支持的字体文件扩展名
const FONT_EXTS: &[&str] = &["ttf", "otf", "woff", "woff2"];

/// 曾经随程序释放、现已下线的内置示例主题文件名：启动时一次性删除，避免存量安装的
/// `themes/` 目录里残留已下线的文件（全新安装本就不会再释放它）。
const RETIRED_THEME_FILES: &[&str] = &["示例主题·护眼浅黄.css", "示例主题.css"];

/// 曾经随程序释放、现已下线的欢迎页正文文件名（配置根 `docs/` 下）：欢迎页下线后
/// 一并清掉，避免配置目录里留着程序不再使用的文件。
const RETIRED_DOCS_FILES: &[&str] = &["README.txt", "Welcome.zh-CN.md", "Welcome.en-US.md"];

/// 一次性清理标记文件名（写在配置根）：已存在即视为「清理过」，不再重复删，
/// 以免用户日后把同名文件放回来时被反复删除。
const RETIRED_MARKER: &str = ".retired-packs";

/// 存量欢迎页文件的清理标记：与 RETIRED_MARKER 分开，因为后者在「示例主题清理」那次
/// 就已经落盘，共用会让本次清理永远不执行。
const RETIRED_DOCS_MARKER: &str = ".retired-docs";

/// 解析包目录名 → 实际路径（不存在时创建）
fn pack_dir(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    let name = match kind {
        LOCALES_DIR => LOCALES_DIR,
        THEMES_DIR => THEMES_DIR,
        FONTS_DIR => FONTS_DIR,
        other => return Err(format!("Unknown pack directory: {other}")),
    };
    let dir = super::config::data_root(app)?.join(name);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {name} directory: {e}"))?;
    Ok(dir)
}

// ---------------------------------------------------------------- 释放默认包

/// 前端传入的默认包文件
#[derive(Deserialize)]
pub struct PackFile {
    /// 目标目录：`locales` | `themes` | `fonts`
    dir: String,
    /// 文件名（只允许文件名本身，不得含路径分隔符）
    name: String,
    /// 文件内容（UTF-8 文本）
    content: String,
    /// 自带语言包的版本（软件版本号 + 词表指纹，见前端 defaultPacks.ts）：文件已存在但其中 `_version` 低于该值时覆盖重写；
    /// 不带该字段的文件一律「已存在即跳过」。
    #[serde(default)]
    version: Option<String>,
}

/// 点分数字版本比较：逐段按数字比，段数不同则缺段视作 0（`"0.1"` < `"0.1.1"`）。
fn compare_version(a: &str, b: &str) -> Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.split('.')
            .map(|part| part.trim().parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (left, right) = (parse(a), parse(b));
    for index in 0..left.len().max(right.len()) {
        let x = left.get(index).copied().unwrap_or(0);
        let y = right.get(index).copied().unwrap_or(0);
        match x.cmp(&y) {
            Ordering::Equal => continue,
            other => return other,
        }
    }
    Ordering::Equal
}

/// 判断已存在的包是否比当前版本旧：读不到 / 解析失败 / 缺 `_version` 一律视为旧（需覆盖）。
fn pack_is_older(path: &Path, current: &str) -> bool {
    let Ok(text) = fs::read_to_string(path) else {
        return true;
    };
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(&text)
    else {
        return true;
    };
    let Some(serde_json::Value::String(existing)) = map.get("_version") else {
        return true;
    };
    compare_version(existing, current) == Ordering::Less
}

/// 取小写扩展名
fn ext_of(name: &str) -> String {
    std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// 校验包文件名：不得含路径分隔符 / 上级目录 / 控制字符，且扩展名属于该目录允许集合。
///
/// 这些文件名来自自家前端，但仍按「不可信输入」处理——一旦被绕过，路径穿越会写到
/// 配置根目录之外。
fn validate_name(dir: &str, name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 128 {
        return Err("Invalid pack file name".to_string());
    }
    if name.contains(['\\', '/']) || name.contains("..") || name.chars().any(char::is_control) {
        return Err(format!("Invalid pack file name: {name}"));
    }
    let ext = ext_of(name);
    let ok = match dir {
        LOCALES_DIR => ext == "json" || ext == "txt",
        THEMES_DIR => ext == "css" || ext == "txt",
        FONTS_DIR => ext == "txt",
        _ => false,
    };
    if !ok {
        return Err(format!(
            "The {dir} directory does not support this file type: {name}"
        ));
    }
    Ok(())
}

/// 一次性删除历史上随程序释放、现已下线的内置文件（示例主题、欢迎页正文）。
///
/// 两份清单各有自己的标记文件：标记落盘后不再执行，尊重用户日后重新放回的同名文件。
/// 用不同标记而不是共用，是因为示例主题那次清理早已落盘，共用会让本次的欢迎页清理永不执行。
fn retire_removed_packs(app: &AppHandle) {
    let Ok(root) = super::config::data_root(app) else {
        return; // 位置未初始化（首启引导之前）：本就无存量文件可清
    };
    let marker = root.join(RETIRED_MARKER);
    if !marker.is_file() {
        let themes = root.join(THEMES_DIR);
        for name in RETIRED_THEME_FILES {
            let _ = fs::remove_file(themes.join(name));
        }
        let _ = fs::write(&marker, b"1");
    }
    // 欢迎页下线（本次新增）：删掉存量安装里已释放的 docs/ 默认文件；
    // 目录本身若已空则一并移除，用户往里放过的其它文件不受影响
    let docs_marker = root.join(RETIRED_DOCS_MARKER);
    if !docs_marker.is_file() {
        let docs = root.join(DOCS_DIR);
        for name in RETIRED_DOCS_FILES {
            let _ = fs::remove_file(docs.join(name));
        }
        let _ = fs::remove_dir(&docs); // 非空时失败，正好保住用户自己的文件
        let _ = fs::write(&docs_marker, b"1");
    }
}

/// 释放默认包文件：目标不存在时才写入；带 `version` 的自带语言包在已存在且版本更旧时覆盖。
///
/// 返回实际写入的文件名（含被覆盖更新的）。
///
/// 写多个文件、且语言包可能上 MB，放后台线程避免阻塞主线程。
#[tauri::command]
pub async fn ensure_packs(app: AppHandle, files: Vec<PackFile>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || ensure_packs_blocking(&app, files))
        .await
        .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn ensure_packs_blocking(app: &AppHandle, files: Vec<PackFile>) -> Result<Vec<String>, String> {
    retire_removed_packs(app);
    let mut written = Vec::new();
    for file in files {
        validate_name(&file.dir, &file.name)?;
        let dir = pack_dir(app, &file.dir)?;
        let target = dir.join(&file.name);
        if target.exists() {
            // 只有需要版本校验的包才允许覆盖，其余一律不碰用户文件
            let outdated = file
                .version
                .as_deref()
                .is_some_and(|current| pack_is_older(&target, current));
            if !outdated {
                continue;
            }
        }
        // 原子写：避免升级释放过程被中断时留下半截语言包（下次启动解析失败 → 语言回退英文）
        super::file_io::atomic_write(&target.to_string_lossy(), file.content.as_bytes())
            .map_err(|e| format!("Failed to write default pack file ({}): {e}", file.name))?;
        written.push(file.name);
    }
    Ok(written)
}

// ---------------------------------------------------------------- 语言包

/// 语言包：`id` = 文件名主干；`label` = JSON 里的 `_label`（缺省回落 id）；`entries` = 其余键值
#[derive(Serialize)]
pub struct LocalePack {
    id: String,
    label: String,
    entries: BTreeMap<String, String>,
}

/// 列出 `locales/*.json` 并解析成语言包；无法解析 / 超限 / 顶层非对象的一律跳过。
#[tauri::command]
pub async fn load_locales(app: AppHandle) -> Result<Vec<LocalePack>, String> {
    tauri::async_runtime::spawn_blocking(move || load_locales_blocking(&app))
        .await
        .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn load_locales_blocking(app: &AppHandle) -> Result<Vec<LocalePack>, String> {
    let dir = pack_dir(app, LOCALES_DIR)?;
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read locales directory: {e}"))?;

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || ext_of(&path.to_string_lossy()) != "json" {
            continue;
        }
        if entry
            .metadata()
            .map(|m| m.len() > MAX_PACK_BYTES)
            .unwrap_or(true)
        {
            continue;
        }
        let Some(id) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(&text)
        else {
            continue;
        };

        let mut label = id.clone();
        let mut entries = BTreeMap::new();
        for (key, value) in map {
            let serde_json::Value::String(text) = value else {
                continue;
            };
            // `_label` / `_version` 是包元信息（显示名、释放版本），不作为译文词条
            if key.starts_with('_') {
                if key == "_label" && !text.trim().is_empty() {
                    label = text;
                }
                continue;
            }
            entries.insert(key, text);
        }
        out.push(LocalePack { id, label, entries });
    }

    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

// ---------------------------------------------------------------- 字体包

/// 字体包：`name` = 文件名主干（同时用作 `@font-face` 的 family 名），`path` = 绝对路径
#[derive(Serialize)]
pub struct FontPack {
    name: String,
    path: String,
}

/// 列出 `fonts/` 下的字体文件，并把该目录放行给 asset 协议（前端据此建 `@font-face`）。
#[tauri::command]
pub async fn load_fonts(app: AppHandle) -> Result<Vec<FontPack>, String> {
    tauri::async_runtime::spawn_blocking(move || load_fonts_blocking(&app))
        .await
        .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn load_fonts_blocking(app: &AppHandle) -> Result<Vec<FontPack>, String> {
    let dir = pack_dir(app, FONTS_DIR)?;
    // asset 协议静态 scope 为空，这里按需放行字体目录（非递归：字体不放在子目录里）
    app.asset_protocol_scope()
        .allow_directory(&dir, false)
        .map_err(|e| format!("Failed to allow the fonts directory: {e}"))?;

    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read fonts directory: {e}"))?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !FONT_EXTS.contains(&ext_of(&path.to_string_lossy()).as_str()) {
            continue;
        }
        let Some(name) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        let Some(full) = path.to_str().map(str::to_string) else {
            continue;
        };
        out.push(FontPack { name, path: full });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 在资源管理器中打开某个包目录，返回其绝对路径（供界面提示）
#[tauri::command]
pub fn open_pack_dir(app: AppHandle, kind: String) -> Result<String, String> {
    let dir = pack_dir(&app, &kind)?;
    Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Failed to open the pack directory: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 文件名按目录白名单校验() {
        // 各目录允许的类型
        assert!(validate_name(LOCALES_DIR, "fr-FR.json").is_ok());
        assert!(validate_name(LOCALES_DIR, "README.txt").is_ok());
        assert!(validate_name(THEMES_DIR, "示例主题.css").is_ok());
        assert!(validate_name(FONTS_DIR, "README.txt").is_ok());
        // 类型不在本目录白名单内
        assert!(validate_name(LOCALES_DIR, "evil.css").is_err());
        assert!(validate_name(THEMES_DIR, "x.json").is_err());
        assert!(validate_name(FONTS_DIR, "font.ttf").is_err());
        // 已下线的 docs/ 目录不再接受任何释放请求
        assert!(validate_name(DOCS_DIR, "Welcome.zh-CN.md").is_err());
    }

    #[test]
    fn 文件名拒绝路径穿越与控制字符() {
        assert!(validate_name(LOCALES_DIR, "../evil.json").is_err());
        assert!(validate_name(LOCALES_DIR, "a/b.json").is_err());
        assert!(validate_name(LOCALES_DIR, "a\\b.json").is_err());
        assert!(validate_name(LOCALES_DIR, "").is_err());
        assert!(validate_name(LOCALES_DIR, "ok\u{0}.json").is_err());
        assert!(validate_name(LOCALES_DIR, &"x".repeat(129)).is_err());
    }

    #[test]
    fn 版本比较按点分段递增() {
        assert_eq!(compare_version("0.1.0", "0.1.0"), Ordering::Equal);
        assert_eq!(compare_version("0.1", "0.1.1"), Ordering::Less);
        assert_eq!(compare_version("0.2.0", "0.1.9"), Ordering::Greater);
        assert_eq!(compare_version("1.0", "0.9.9"), Ordering::Greater);
        // 非法段按 0 处理，不会 panic
        assert_eq!(compare_version("0.1.x", "0.1.0"), Ordering::Equal);
    }
}
