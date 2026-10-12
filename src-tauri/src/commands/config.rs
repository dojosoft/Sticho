//! 配置数据保存位置（系统目录 / 指定目录 / 当前目录）
//!
//! 绿色版需求：允许把 `settings.json` + `recovery/` + `themes/` 放在**程序所在目录**，
//! 而不是默认的 `%APPDATA%\<identifier>`。
//!
//! 关键设计——**引导文件 `data-location.json` 永远固定在系统用户目录
//! `%APPDATA%\Sticho`**：如果它也放在可切换的目录里，就会出现「要先知道位置
//! 才能读到位置」的鸡生蛋问题。引导文件只记录一个 `mode` 字段，真正的数据根由它推导。
//!
//! 三种模式的数据根：
//! - 系统目录：`%APPDATA%\Sticho`
//! - 当前程序目录：`<exe 所在目录>\Sticho`
//! - 指定目录：`<用户所选目录>\Sticho`
//!
//! 参数名一律用单段小写词（mode）：Tauri v2 默认把 Rust 参数名按 camelCase 暴露给 JS，
//! 与 commands/recovery.rs 的既有约定一致。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 引导文件名（固定位于系统用户目录 `%APPDATA%\Sticho`）
const BOOTSTRAP_FILE: &str = "data-location.json";

/// 数据根目录名（系统目录即 `%APPDATA%\Sticho`；便携/自定义则在所选目录下新建同名子目录）。
///
/// 用产品名而非 identifier（`com.marvin.sticho`），便于用户辨认与备份。
const DATA_FOLDER: &str = "Sticho";

/// 迁移时搬运的数据项（引导文件 `data-location.json` 不在其中，必须留在原处）
const DATA_ITEMS: &[&str] = &["settings.json", "recovery", "themes", "pandoc"];

/// 可读写探测用的临时文件名
const WRITE_PROBE: &str = ".sticho-write-test";

/// 数据位置模式
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum DataLocation {
    /// 系统用户目录（`%APPDATA%\Sticho`，默认）
    User,
    /// 程序当前目录（绿色版）
    Portable,
    /// 用户指定的任意目录
    Custom(PathBuf),
}

impl DataLocation {
    /// 规范化的模式名（写引导文件 / 回报前端）
    fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Portable => "portable",
            Self::Custom(_) => "custom",
        }
    }

    /// 自定义目录的路径（非自定义模式返回 None）
    fn custom_path(&self) -> Option<PathBuf> {
        match self {
            Self::Custom(p) => Some(p.clone()),
            _ => None,
        }
    }
}

/// 校验模式名，返回规范化后的静态字符串
fn validate_mode(s: &str) -> Result<&'static str, String> {
    match s {
        "user" => Ok("user"),
        "portable" => Ok("portable"),
        "custom" => Ok("custom"),
        other => Err(format!("未知的配置位置：{other}")),
    }
}

/// 把前端传入的 (mode, path) 解析成规范化的 `DataLocation`。
///
/// `custom` 模式必须给出绝对路径，否则拒绝；供 `set_data_location` 与
/// `check_data_location` 共用，保证两处校验口径一致。
fn parse_target(mode: &str, path: Option<String>) -> Result<DataLocation, String> {
    match validate_mode(mode)? {
        "portable" => Ok(DataLocation::Portable),
        "custom" => {
            let raw = path.unwrap_or_default();
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err("请先选择用于保存配置的目录".to_string());
            }
            let p = PathBuf::from(trimmed);
            if !p.is_absolute() {
                return Err("请选择绝对路径的目录".to_string());
            }
            Ok(DataLocation::Custom(p))
        }
        _ => Ok(DataLocation::User),
    }
}

/// 引导文件结构
#[derive(Serialize, Deserialize)]
struct Bootstrap {
    mode: String,
    /// 仅 `custom` 模式使用：用户指定的目录绝对路径
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

// ---------------------------------------------------------------- 路径解析

/// 去掉 Windows verbatim 前缀（`\\?\D:\x` → `D:\x`）。
///
/// `current_exe()` 在个别场景下会返回带前缀的路径，带着前缀去拼文件名会让下游
/// 把 `\\?\` 当成目录名的一部分。
fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}

/// 程序（exe）所在目录。
///
/// 不用 `path().executable_dir()`：它在 Windows 上返回 `UnknownPath`（见 tauri 文档）。
fn exe_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法定位程序路径：{e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "程序路径没有父目录".to_string())?;
    Ok(strip_verbatim(dir))
}

/// 系统用户数据根：`%APPDATA%\Sticho`。
///
/// 刻意不用 `app_data_dir()`——它按 identifier 拼成 `%APPDATA%\com.marvin.sticho`，
/// 对用户不友好。这里直接用产品名，方便辨认与备份。
fn user_root() -> Result<PathBuf, String> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "无法定位 %APPDATA% 目录".to_string())?;
    Ok(base.join(DATA_FOLDER))
}

/// 引导文件绝对路径（固定位于系统用户目录；先确保该目录存在）
fn bootstrap_path() -> Result<PathBuf, String> {
    let dir = user_root()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录：{e}"))?;
    Ok(dir.join(BOOTSTRAP_FILE))
}

/// 读引导文件；不存在 / 解析失败一律回落到 `user`（保证默认行为不变）。
///
/// 「不存在」是正常的首次启动；「存在但损坏」则意味着用户此前选的绿色版位置丢了，
/// 此时静默回退会让设置看起来凭空消失，故明确打一条日志便于排查。
fn read_bootstrap() -> Result<DataLocation, String> {
    let path = bootstrap_path()?;
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(DataLocation::User);
    };
    let cfg = match serde_json::from_str::<Bootstrap>(&text) {
        Ok(c) => c,
        Err(e) => {
            eprintln!(
                "[config] 引导文件已损坏（{e}），本次回退到系统用户目录：{}",
                path.display()
            );
            return Ok(DataLocation::User);
        }
    };
    match cfg.mode.as_str() {
        "user" => Ok(DataLocation::User),
        "portable" => Ok(DataLocation::Portable),
        "custom" => match cfg.path {
            Some(p) if !p.trim().is_empty() => Ok(DataLocation::Custom(PathBuf::from(p))),
            _ => {
                eprintln!(
                    "[config] 引导文件为自定义模式但缺少路径，本次回退到系统用户目录：{}",
                    path.display()
                );
                Ok(DataLocation::User)
            }
        },
        other => {
            eprintln!(
                "[config] 引导文件内容无法识别（未知的配置位置：{other}），本次回退到系统用户目录：{}",
                path.display()
            );
            Ok(DataLocation::User)
        }
    }
}

/// 写引导文件（原子写，避免写一半崩溃后读不出位置）
fn write_bootstrap(loc: DataLocation) -> Result<(), String> {
    let cfg = Bootstrap {
        mode: loc.as_str().to_string(),
        path: loc.custom_path().map(|p| p.to_string_lossy().into_owned()),
    };
    let json = serde_json::to_string(&cfg).map_err(|e| format!("序列化失败：{e}"))?;
    let path = bootstrap_path()?;
    super::file_io::atomic_write(&path.to_string_lossy(), json.as_bytes())
}

/// 计算某个模式对应的数据根目录（不做迁移、不写引导文件）。
///
/// 便携 / 自定义模式统一在所选目录下再建一层 `Sticho` 子目录，
/// 避免把 settings.json 等文件散落在选定的文件夹根部。
fn root_for(loc: &DataLocation) -> Result<PathBuf, String> {
    match loc {
        DataLocation::Portable => Ok(exe_dir()?.join(DATA_FOLDER)),
        DataLocation::User => user_root(),
        DataLocation::Custom(p) => Ok(p.join(DATA_FOLDER)),
    }
}

/// 当前生效的数据根目录。`settings.json` / `recovery` / `themes` 都挂在它下面。
///
/// `user` 模式下顺带 `create_dir_all`，调用方可直接使用。
///
/// 结果做**会话级缓存**：位置切换本就约定「重启后生效」，缓存住首次解析结果，
/// 既省掉 recovery/theme/secrets 等高频命令的重复读盘，也保证同一会话内
/// 所有命令看到的根目录一致（切换引导文件后不会中途漂移到新根）。
static DATA_ROOT_CACHE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn data_root(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = DATA_ROOT_CACHE.get() {
        return Ok(dir.clone());
    }
    let loc = read_bootstrap()?;
    let dir = root_for(&loc)?;
    if loc == DataLocation::User {
        std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录：{e}"))?;
    }
    let _ = DATA_ROOT_CACHE.set(dir.clone());
    Ok(dir)
}

// ---------------------------------------------------------------- 迁移

/// 探测目录可读写：写入一个临时文件、读回校验、再删掉。
///
/// 只测「可写」不够——某些挂载点能创建文件却读不回来，故读写一起验。
fn probe_read_write(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let probe = dir.join(WRITE_PROBE);
    std::fs::write(&probe, b"sticho")?;
    let read_back = std::fs::read(&probe);
    let _ = std::fs::remove_file(&probe);
    if read_back? != b"sticho" {
        return Err(std::io::Error::other("临时文件读回内容不一致"));
    }
    Ok(())
}

/// 复制单个文件；源不存在或目标已存在则跳过（不覆盖）。
fn copy_file_if_absent(src: &Path, dst: &Path, warnings: &mut Vec<String>) {
    if !src.is_file() || dst.exists() {
        return;
    }
    if let Some(parent) = dst.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            warnings.push(format!("{}：创建目录失败（{e}）", parent.display()));
            return;
        }
    }
    if let Err(e) = std::fs::copy(src, dst) {
        warnings.push(format!("{}：复制失败（{e}）", src.display()));
    }
}

/// 递归复制目录，逐文件跳过已存在项。
fn copy_dir_if_absent(src: &Path, dst: &Path, warnings: &mut Vec<String>) {
    if let Err(e) = std::fs::create_dir_all(dst) {
        warnings.push(format!("{}：创建目录失败（{e}）", dst.display()));
        return;
    }
    let Ok(entries) = std::fs::read_dir(src) else {
        warnings.push(format!("{}：读取失败", src.display()));
        return;
    };
    for entry in entries.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_if_absent(&from, &to, warnings);
        } else {
            copy_file_if_absent(&from, &to, warnings);
        }
    }
}

/// 把旧数据根下的全部 `DATA_ITEMS` 复制到新数据根，并返回 (是否完整, 告警)。
///
/// 尽力而为：目标已存在则跳过，单项失败只记录不中断。复制后再逐文件比对
/// （`diff_covered`）判定完整性——只有完整时才允许清理旧目录。
fn migrate_data(old: &Path, new: &Path) -> (bool, Vec<String>) {
    let mut warnings = Vec::new();

    for name in DATA_ITEMS {
        let src = old.join(name);
        if src.is_dir() {
            copy_dir_if_absent(&src, &new.join(name), &mut warnings);
        } else if src.is_file() {
            copy_file_if_absent(&src, &new.join(name), &mut warnings);
        }
    }

    let complete = warnings.is_empty() && diff_covered(old, new);
    (complete, warnings)
}

/// 逐项比对：旧根的每个数据项是否都已在新根中存在且内容大小一致。
fn diff_covered(old: &Path, new: &Path) -> bool {
    DATA_ITEMS
        .iter()
        .all(|name| item_covered(&old.join(name), &new.join(name)))
}

/// 单项覆盖判断：源不存在视为已覆盖；文件比对字节大小；目录递归比对成员。
fn item_covered(src: &Path, dst: &Path) -> bool {
    if src.is_file() {
        match (std::fs::metadata(src), std::fs::metadata(dst)) {
            (Ok(a), Ok(b)) => a.len() == b.len(),
            _ => false,
        }
    } else if src.is_dir() {
        let Ok(entries) = std::fs::read_dir(src) else {
            return true;
        };
        entries
            .flatten()
            .all(|e| item_covered(&e.path(), &dst.join(e.file_name())))
    } else {
        true
    }
}

/// 清理旧数据根：删除 `DATA_ITEMS` 各项，随后仅当目录已空才删掉目录本身。
///
/// 引导文件 `data-location.json` 不在 `DATA_ITEMS` 中，故系统目录（`%APPDATA%\Sticho`）
/// 永远不会被误删；便携 / 自定义目录删空后会被移除。返回逐项删除的告警。
fn remove_data_items(root: &Path) -> Vec<String> {
    let mut warnings = Vec::new();

    for name in DATA_ITEMS {
        let p = root.join(name);
        if !p.exists() {
            continue;
        }
        let r = if p.is_dir() {
            std::fs::remove_dir_all(&p)
        } else {
            std::fs::remove_file(&p)
        };
        if let Err(e) = r {
            warnings.push(format!("{}：删除失败（{e}）", p.display()));
        }
    }

    // 目录空了才删除（仍留有引导文件时会失败，属正常）
    let _ = std::fs::remove_dir(root);
    warnings
}

// ---------------------------------------------------------------- 命令

/// `settings.json` 的绝对路径。
///
/// plugin-store 的 `load` 内部按 `BaseDirectory::AppData` 解析相对路径；Windows 上
/// push 绝对路径会整体替换 base，因此这里直接给绝对路径即可定位到自定义位置。
#[tauri::command]
pub fn get_settings_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_root(&app)?.join("settings.json").to_string_lossy().into_owned())
}

/// 当前位置模式："user" | "portable" | "custom"
#[tauri::command]
pub fn get_data_location(_app: tauri::AppHandle) -> Result<String, String> {
    Ok(read_bootstrap()?.as_str().to_string())
}

/// 当前数据根目录的绝对路径（供设置界面只读展示）
#[tauri::command]
pub fn get_data_root(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_root(&app)?.to_string_lossy().into_owned())
}

/// 按目标模式给出可读的探测失败原因（提示用户换目录或换位置）。
fn probe_error(target: &DataLocation, e: &std::io::Error) -> String {
    match target {
        DataLocation::User => format!("系统用户目录不可读写：{e}"),
        DataLocation::Portable => format!(
            "程序所在目录不可读写（可能安装在 Program Files 或被安全软件保护），请继续使用系统用户目录：{e}"
        ),
        DataLocation::Custom(_) => {
            format!("所选目录不可读写（可能没有权限或被安全软件保护），请换一个目录：{e}")
        }
    }
}

/// 切换数据保存位置的结果（供前端判断是否需要提示迁移不完整等）。
#[derive(Serialize)]
pub struct SetLocationResult {
    /// 新的数据根目录绝对路径
    pub root: String,
    /// 是否实际执行了迁移（新旧目录不同且用户选择了迁移）
    pub migrated: bool,
    /// 迁移是否完整（未迁移时恒为 true）
    pub complete: bool,
    /// 旧数据是否已清理（迁移完整时才会尝试）
    pub cleaned: bool,
    /// 迁移 / 清理过程中的告警
    pub warnings: Vec<String>,
}

/// 检测目标位置可读写，成功返回其数据根目录绝对路径。
///
/// 供前端在**真正切换前**预检：失败即提示并回退，不落任何文件、不改引导文件。
#[tauri::command]
pub fn check_data_location(mode: String, path: Option<String>) -> Result<String, String> {
    let target = parse_target(&mode, path)?;
    let root = root_for(&target)?;
    probe_read_write(&root).map_err(|e| probe_error(&target, &e))?;
    Ok(root.to_string_lossy().into_owned())
}

/// 切换数据保存位置，返回结构化结果。
///
/// - `mode` = "user" / "portable" / "custom"；`custom` 时必须给出 `path`（绝对路径）；
/// - 切换前先探测目标目录可读写，失败则**整体拒绝**（不落任何文件、不改设置）；
/// - `migrate` 为 true 时把旧位置的数据复制到新位置，复制后校验完整性，
///   完整才清理旧目录（`data-location.json` 不在清理范围内）。
#[tauri::command]
pub fn set_data_location(
    app: tauri::AppHandle,
    mode: String,
    path: Option<String>,
    migrate: Option<bool>,
) -> Result<SetLocationResult, String> {
    let target = parse_target(&mode, path)?;
    let migrate = migrate.unwrap_or(false);

    let old_root = data_root(&app)?;
    let new_root = root_for(&target)?;

    if new_root == old_root {
        write_bootstrap(target)?;
        return Ok(SetLocationResult {
            root: new_root.to_string_lossy().into_owned(),
            migrated: false,
            complete: true,
            cleaned: false,
            warnings: Vec::new(),
        });
    }

    std::fs::create_dir_all(&new_root).map_err(|e| format!("无法创建目标目录：{e}"))?;

    if let Err(e) = probe_read_write(&new_root) {
        return Err(probe_error(&target, &e));
    }

    let mut migrated = false;
    let mut complete = true;
    let mut cleaned = false;
    let mut warnings = Vec::new();

    if migrate {
        let (ok, w) = migrate_data(&old_root, &new_root);
        migrated = true;
        complete = ok;
        warnings = w;

        if complete {
            let clean_warnings = remove_data_items(&old_root);
            cleaned = clean_warnings.is_empty();
            warnings.extend(clean_warnings);
        } else {
            eprintln!("[config] 迁移不完整，已保留原目录作为备份：{}", old_root.display());
        }
    }

    for w in &warnings {
        eprintln!("[config] 迁移告警：{w}");
    }

    write_bootstrap(target)?;

    Ok(SetLocationResult {
        root: new_root.to_string_lossy().into_owned(),
        migrated,
        complete,
        cleaned,
        warnings,
    })
}

/// 立即重启应用（用于让新的配置位置生效）。
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

// ---------------------------------------------------------------- 单元测试

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一个独占的临时目录（不引入 tempfile 依赖）
    fn tmp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let mut p = std::env::temp_dir();
        p.push(format!("sticho-cfg-{tag}-{nanos}"));
        p
    }

    #[test]
    fn validate_mode_ok_and_err() {
        assert_eq!(validate_mode("user").unwrap(), "user");
        assert_eq!(validate_mode("portable").unwrap(), "portable");
        assert_eq!(validate_mode("custom").unwrap(), "custom");
        assert!(validate_mode("nope").is_err());
    }

    #[test]
    fn strip_verbatim_removes_prefix() {
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\D:\apps\md")),
            PathBuf::from(r"D:\apps\md")
        );
        assert_eq!(
            strip_verbatim(Path::new(r"D:\apps\md")),
            PathBuf::from(r"D:\apps\md")
        );
    }

    #[test]
    fn copy_file_does_not_overwrite() {
        let base = tmp_dir("copy");
        let src = base.join("src");
        let dst = base.join("dst");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        std::fs::write(src.join("a.txt"), b"new").unwrap();
        std::fs::write(dst.join("a.txt"), b"old").unwrap();

        let mut w = Vec::new();
        copy_file_if_absent(&src.join("a.txt"), &dst.join("a.txt"), &mut w);

        assert_eq!(std::fs::read_to_string(dst.join("a.txt")).unwrap(), "old");
        assert!(w.is_empty());
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn parse_target_modes() {
        assert_eq!(parse_target("user", None).unwrap(), DataLocation::User);
        assert_eq!(parse_target("portable", None).unwrap(), DataLocation::Portable);
        assert!(parse_target("custom", None).is_err());
        assert!(parse_target("custom", Some("rel".into())).is_err());
        assert_eq!(
            parse_target("custom", Some(r"D:\x".into())).unwrap(),
            DataLocation::Custom(PathBuf::from(r"D:\x"))
        );
        assert!(parse_target("nope", None).is_err());
    }

    #[test]
    fn migrate_copies_settings_and_dirs() {
        let base = tmp_dir("migrate");
        let old = base.join("old");
        let new = base.join("new");
        std::fs::create_dir_all(old.join("recovery")).unwrap();
        std::fs::create_dir_all(old.join("themes")).unwrap();
        std::fs::write(old.join("settings.json"), b"{\"a\":1}").unwrap();
        std::fs::write(old.join("recovery").join("d1.json"), b"x").unwrap();
        std::fs::write(old.join("themes").join("t.css"), b"body{}").unwrap();

        let (complete, warnings) = migrate_data(&old, &new);

        assert!(warnings.is_empty(), "意外告警：{warnings:?}");
        assert!(complete, "迁移应判定为完整");
        assert!(new.join("settings.json").is_file());
        assert!(new.join("recovery").join("d1.json").is_file());
        assert!(new.join("themes").join("t.css").is_file());
        // 旧文件保留为备份（清理是调用方的职责）
        assert!(old.join("settings.json").is_file());
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn diff_covered_detects_size_mismatch() {
        let base = tmp_dir("diff");
        let old = base.join("old");
        let new = base.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("settings.json"), b"12345").unwrap();
        std::fs::write(new.join("settings.json"), b"123").unwrap();
        assert!(!diff_covered(&old, &new));

        std::fs::write(new.join("settings.json"), b"12345").unwrap();
        assert!(diff_covered(&old, &new));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn remove_data_items_keeps_bootstrap() {
        let base = tmp_dir("clean");
        std::fs::create_dir_all(base.join("recovery")).unwrap();
        std::fs::write(base.join("settings.json"), b"x").unwrap();
        std::fs::write(base.join("recovery").join("d1.json"), b"x").unwrap();
        std::fs::write(base.join(BOOTSTRAP_FILE), b"{}").unwrap();

        let warnings = remove_data_items(&base);

        assert!(warnings.is_empty(), "意外告警：{warnings:?}");
        assert!(!base.join("settings.json").exists());
        assert!(!base.join("recovery").exists());
        // 引导文件保留，目录因此不被删除
        assert!(base.join(BOOTSTRAP_FILE).is_file());
        assert!(base.is_dir());
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn probe_read_write_ok_on_temp() {
        let base = tmp_dir("probe");
        std::fs::create_dir_all(&base).unwrap();
        assert!(probe_read_write(&base).is_ok());
        // 探测文件不应残留
        assert!(!base.join(WRITE_PROBE).exists());
        std::fs::remove_dir_all(&base).ok();
    }
}