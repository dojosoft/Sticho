//! 配置数据保存位置（系统目录 / 程序目录）
//!
//! 绿色版便携性：把 `settings.json` + `recovery/` + `themes/` 等放在**程序所在目录**的
//! `Sticho` 子目录里，随程序一起搬移，不向宿主系统写入任何文件（文件关联 / 右键菜单
//! 写注册表仍照常支持）。
//!
//! **位置自动探测**（无需用户先配置）：
//! 1. `<exe>\Sticho\` 或 `<exe>\` 已含配置 → 程序目录（便携）——两处都算便携，
//!    规范子目录 `<exe>\Sticho\` 优先（见 `portable_root`）；
//! 2. 否则 `%APPDATA%\Sticho` 已含配置 → 系统目录；
//! 3. 两者都没有 → 未初始化：由前端在启动界面引导用户二选一，选定后写入位置标记与
//!    初始配置，程序位置固定为上述两种（不再支持任意「指定目录」）。
//!
//! 位置标记 `data-location.json` 只记录一个 `mode` 字段，写在**当前生效的数据根内**，
//! 是「切换位置」后的权威记录（旧位置只删标记、不清数据，避免误删用户文件）。
//!
//! 参数名一律用单段小写词（mode）：Tauri v2 默认把 Rust 参数名按 camelCase 暴露给 JS，
//! 与 commands/recovery.rs 的既有约定一致。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// 位置标记文件名（写在当前生效的数据根内，只记录一个 mode）
const BOOTSTRAP_FILE: &str = "data-location.json";

/// 数据根目录名（系统目录即 `%APPDATA%\Sticho`；程序目录则为 `<exe>\Sticho`）。
///
/// 用产品名而非 identifier（`com.marvin.sticho`），便于用户辨认与备份。
const DATA_FOLDER: &str = "Sticho";

/// 判定「已含配置」的入口文件名（先于位置标记落盘，作为无标记时的兜底信号）
const SETTINGS_FILE: &str = "settings.json";

/// WebDAV 凭据文件名（与 commands/secrets.rs 保持一致）。
///
/// 它是用户数据的一部分：兼容布局（配置直接放 `<exe>\`）下走白名单枚举，
/// 若漏掉它，切换位置时 WebDAV 密码不会随迁、清理时也清不掉（静默丢失）。
const SECRETS_FILE: &str = "secrets.json";

// 迁移与清理都不维护硬编码的数据项清单：配置根目录里除位置标记 `data-location.json`
// 外的所有内容都算用户数据（settings.json、recovery、themes、locales、fonts、docs、
// pandoc、bookmarks、history、logs…），统一由 `data_entries` 枚举整个目录处理——
// 这样日后新增目录会自动纳入，不会再出现「迁移漏掉新文件夹」的问题。
//
// 唯一例外：兼容布局下配置**直接放在程序目录本身**（`<exe>\`）时，该目录混着 exe / dll
// 等程序文件，`data_entries` 改用 `PROGRAM_DIR_DATA_ITEMS` 白名单，避免误动程序文件。

/// 可读写探测用的临时文件名
const WRITE_PROBE: &str = ".sticho-write-test";

/// 数据位置模式（「指定目录」已移除，仅保留系统 / 程序两种）
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DataLocation {
    /// 系统用户目录（`%APPDATA%\Sticho`）
    User,
    /// 程序当前目录（`<exe>\Sticho`，绿色版便携）
    Portable,
}

impl DataLocation {
    /// 规范化的模式名（写位置标记 / 回报前端）
    fn as_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Portable => "portable",
        }
    }
}

/// 校验模式名，返回规范化后的静态字符串
fn validate_mode(s: &str) -> Result<&'static str, String> {
    match s {
        "user" => Ok("user"),
        "portable" => Ok("portable"),
        other => Err(format!("Unknown config location: {other}")),
    }
}

/// 把前端传入的 mode 解析成 `DataLocation`。
fn parse_target(mode: &str) -> Result<DataLocation, String> {
    match validate_mode(mode)? {
        "portable" => Ok(DataLocation::Portable),
        _ => Ok(DataLocation::User),
    }
}

/// 位置标记结构
#[derive(Serialize, Deserialize)]
struct Bootstrap {
    mode: String,
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
    let exe = std::env::current_exe().map_err(|e| format!("Failed to locate program path: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "Program path has no parent directory".to_string())?;
    Ok(strip_verbatim(dir))
}

/// 系统用户数据根：`%APPDATA%\Sticho`。
///
/// 刻意不用 `app_data_dir()`——它按 identifier 拼成 `%APPDATA%\com.marvin.sticho`，
/// 对用户不友好。这里直接用产品名，方便辨认与备份。
fn user_root() -> Result<PathBuf, String> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "Failed to locate %APPDATA% directory".to_string())?;
    Ok(base.join(DATA_FOLDER))
}

/// 便携数据根的两个候选（按优先级）：规范子目录 `<exe>\Sticho` 在前，
/// 「配置直接放在程序目录」的 `<exe>\` 在后——两种布局都算便携运行。
fn portable_candidates() -> Result<[PathBuf; 2], String> {
    let exe = exe_dir()?;
    let sub = exe.join(DATA_FOLDER);
    Ok([sub, exe])
}

/// 某目录是否已有配置：位置标记或 `settings.json` 任一存在即算。
fn has_config(dir: &Path) -> bool {
    dir.join(BOOTSTRAP_FILE).is_file() || dir.join(SETTINGS_FILE).is_file()
}

/// 当前应采用的便携数据根。
///
/// 已有配置的候选优先，且**规范子目录优先于程序目录本身**（两处都有配置时以子目录为准）；
/// 两处都没有配置时返回规范子目录 `<exe>\Sticho`，作为新建便携配置的落点
/// （避免把 settings.json / bookmarks 等散落到 exe 旁边）。
fn portable_root() -> Result<PathBuf, String> {
    let [sub, exe] = portable_candidates()?;
    if has_config(&sub) {
        return Ok(sub);
    }
    if has_config(&exe) {
        return Ok(exe);
    }
    Ok(sub)
}

/// 计算某个模式对应的数据根目录（不做迁移、不写位置标记）。
///
/// - 便携模式：`portable_root()`——规范子目录 `<exe>\Sticho`，或兼容的 `<exe>\`
///   （配置直接放在程序目录本身时视作便携并就地加载）；
/// - 系统目录：`%APPDATA%\Sticho`。
fn root_for(loc: DataLocation) -> Result<PathBuf, String> {
    match loc {
        DataLocation::Portable => portable_root(),
        DataLocation::User => user_root(),
    }
}

/// 读某个数据根下位置标记的 mode（缺失 / 损坏返回 None）。
fn marker_mode_at(dir: &Path) -> Option<String> {
    let path = dir.join(BOOTSTRAP_FILE);
    let text = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<Bootstrap>(&text) {
        Ok(cfg) => Some(cfg.mode),
        Err(e) => {
            eprintln!("[config] 位置标记已损坏（{e}）：{}", path.display());
            None
        }
    }
}

/// 某目录下的位置标记是否与期望模式一致。
fn has_marker(dir: &Path, expected: &str) -> bool {
    matches!(marker_mode_at(dir).as_deref(), Some(m) if m == expected)
}

/// 启动探测：返回当前应使用的位置；两处都未初始化时返回 None。
///
/// 两轮判断：
/// 1. **位置标记优先**——它是「切换位置」后的权威记录。旧位置只删标记不清数据，
///    若反过来先看 settings.json，会把旧位置又判成生效位置。
/// 2. 无标记时**回退按已有配置**（`settings.json`）判断，兼容手动拷贝 Sticho 文件夹、
///    或早期版本留下的、没有标记的配置。
///
/// 旧版「指定目录」的标记 `mode` 为 `custom`，两轮都不匹配，因此不会被误判——
/// 这类用户会重新走首次运行引导（原目录文件保留、不删除）。
fn detect_location() -> Result<Option<DataLocation>, String> {
    let portable = root_for(DataLocation::Portable)?;
    let user = root_for(DataLocation::User)?;

    if has_marker(&portable, "portable") {
        return Ok(Some(DataLocation::Portable));
    }
    if has_marker(&user, "user") {
        return Ok(Some(DataLocation::User));
    }
    if portable.join(SETTINGS_FILE).is_file() {
        return Ok(Some(DataLocation::Portable));
    }
    if user.join(SETTINGS_FILE).is_file() {
        return Ok(Some(DataLocation::User));
    }
    Ok(None)
}

/// 写位置标记到指定模式的数据根内（原子写），并清掉另一个位置上的旧标记。
///
/// 只删旧位置的标记文件、不动其数据——万一用户想回头，旧配置仍在原处。
fn write_bootstrap(loc: DataLocation) -> Result<(), String> {
    let json = serde_json::to_string(&Bootstrap {
        mode: loc.as_str().to_string(),
    })
    .map_err(|e| format!("Serialization failed: {e}"))?;

    let target = root_for(loc)?.join(BOOTSTRAP_FILE);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {e}"))?;
    }
    super::file_io::atomic_write(&target.to_string_lossy(), json.as_bytes())?;

    // 清掉另一个位置上的旧标记，避免两边并存时探测结果产生歧义
    let other = match loc {
        DataLocation::Portable => DataLocation::User,
        DataLocation::User => DataLocation::Portable,
    };
    let _ = std::fs::remove_file(root_for(other)?.join(BOOTSTRAP_FILE));
    Ok(())
}

/// 当前生效的数据根目录。`settings.json` / `recovery` / `themes` 都挂在它下面。
///
/// 结果做**会话级缓存**（可被 `setup_config_location` / `set_data_location` 覆盖）：位置切换约定「重启后生效」，
/// 缓存住首次解析结果，既省掉 recovery/theme/packs 等高频命令的重复读盘，也保证同一会话内
/// 所有命令看到的根目录一致。
///
/// **未初始化时返回 Err**：此时还没确定数据根，任何写入都必须等前端引导用户选定位置
/// （`setup_config_location`）之后，避免把文件落进用户尚未选定的位置。
static DATA_ROOT_CACHE: Mutex<Option<PathBuf>> = Mutex::new(None);

/// 取缓存锁；锁中毒（理论不会发生）时取回内部值继续，不让一次 panic 卡死整个应用。
fn cache_lock() -> std::sync::MutexGuard<'static, Option<PathBuf>> {
    DATA_ROOT_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn data_root(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 全程持锁：读缓存 → （未命中才）探测位置 → 建目录 → 回写缓存。
    // 若像早期那样「先查一次缓存、解锁、再回写」，两个线程并发首次进入时都会 miss，
    // 各自探测一次并各写一次缓存（此时若位置标记正被切换，晚写者可能覆盖成旧值）。
    let mut cache = cache_lock();
    if let Some(dir) = cache.as_ref() {
        return Ok(dir.clone());
    }
    let Some(loc) = detect_location()? else {
        return Err("Config location not initialized yet".to_string());
    };
    let dir = root_for(loc)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;
    *cache = Some(dir.clone());
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
        return Err(std::io::Error::other(
            "Temp file read-back content mismatch",
        ));
    }
    Ok(())
}

/// 预检用：探测可读写，但**不产生任何副作用**（不新建目标目录，不残留探针文件）。
///
/// 与 `probe_read_write` 的唯一区别是「目标目录尚不存在」时的处理：那里不去创建它，
/// 而是向上找到最近的**已存在**目录，只在其内写一个探针再删掉。`check_data_location`
/// 是切换前的预检，用户随后可能放弃切换，此时若已建出空目录（如 `%APPDATA%\Sticho`）
/// 就属于不该有的副作用。
fn probe_read_write_clean(dir: &Path) -> std::io::Result<()> {
    if dir.is_dir() {
        return probe_read_write(dir);
    }
    let mut ancestor = dir.parent();
    while let Some(p) = ancestor {
        if p.is_dir() {
            return probe_read_write(p);
        }
        ancestor = p.parent();
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
            warnings.push(format!(
                "{}: failed to create directory ({e})",
                parent.display()
            ));
            return;
        }
    }
    if let Err(e) = std::fs::copy(src, dst) {
        warnings.push(format!("{}: copy failed ({e})", src.display()));
    }
}

/// 递归复制目录，逐文件跳过已存在项。
fn copy_dir_if_absent(src: &Path, dst: &Path, warnings: &mut Vec<String>) {
    if let Err(e) = std::fs::create_dir_all(dst) {
        warnings.push(format!(
            "{}: failed to create directory ({e})",
            dst.display()
        ));
        return;
    }
    let Ok(entries) = std::fs::read_dir(src) else {
        warnings.push(format!("{}: read failed", src.display()));
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

/// 「配置直接放在程序目录」兼容布局下认可的数据项白名单。
///
/// 程序目录不像规范子目录那样只有数据——里面还混着 exe / dll 等程序文件，
/// 因此该布局不能整体枚举，只能按名字白名单处理，避免误动程序文件。
const PROGRAM_DIR_DATA_ITEMS: &[&str] = &[
    SETTINGS_FILE,
    SECRETS_FILE,
    "recovery",
    "themes",
    "locales",
    "fonts",
    "docs",
    "pandoc",
    "bookmarks",
    "history",
    "logs",
];

/// 两个路径是否指向同一目录。
///
/// Windows 上路径比较**必须大小写不敏感**（`PathBuf` 的 `==` 是逐字节区分大小写的），
/// 否则 `D:\App` 与 `d:\app` 会被判成两个目录，进而把程序目录误当普通数据根处理。
/// 优先用 `canonicalize`（可解析 8.3 短名与符号链接）；任一侧失败则退回
/// 「去尾部分隔符 + 统一小写」的字符串比较。
fn same_dir(a: &Path, b: &Path) -> bool {
    if let (Ok(ca), Ok(cb)) = (a.canonicalize(), b.canonicalize()) {
        return ca == cb;
    }
    norm_case(a) == norm_case(b)
}

/// 路径的归一化小写字符串（去尾部分隔符），供大小写不敏感比较。
fn norm_case(p: &Path) -> String {
    p.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_lowercase()
}

/// 枚举数据根下需要迁移 / 清理的顶层条目。
///
/// 规范子目录下刻意**不做硬编码清单**：除位置标记 `data-location.json` 外的所有内容
/// 都算数据，日后新增目录（bookmarks / history / logs …）会自动纳入，不会漏迁。
/// 唯一例外：数据根就是程序目录本身时改用 `PROGRAM_DIR_DATA_ITEMS` 白名单。
///
/// 判定程序目录布局需要 exe 路径：**拿不到 exe 路径时直接拒绝枚举**（返回 `None`）。
/// 若此时误走「非白名单」分支枚举整个目录，`remove_data_items` 会把 exe / dll 当
/// 用户数据删掉——宁可放弃迁移/清理，也不能有这种误删。
fn data_entries(root: &Path) -> Option<Vec<PathBuf>> {
    let exe = exe_dir().ok()?;
    if same_dir(&exe, root) {
        return Some(
            PROGRAM_DIR_DATA_ITEMS
                .iter()
                .map(|name| root.join(name))
                .filter(|p| p.exists())
                .collect(),
        );
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return None;
    };
    Some(
        entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .map(|n| n != std::ffi::OsStr::new(BOOTSTRAP_FILE))
                    .unwrap_or(false)
            })
            .collect(),
    )
}

/// 把旧数据根下的**全部内容**（位置标记除外）复制到新数据根，返回 (是否完整, 告警)。
///
/// 尽力而为：目标已存在则跳过，单项失败只记录不中断（例如 `logs/` 正被写入、
/// Windows 文件锁导致个别文件读不到，都按非致命处理）。复制后再逐文件比对
/// （`diff_covered`）判定完整性——只有完整时才允许清理旧目录。
fn migrate_data(old: &Path, new: &Path) -> (bool, Vec<String>) {
    let mut warnings = Vec::new();

    let Some(entries) = data_entries(old) else {
        warnings.push(format!("{}: read failed", old.display()));
        return (false, warnings);
    };

    for from in entries {
        let Some(name) = from.file_name() else {
            continue;
        };
        let to = new.join(name);
        if from.is_dir() {
            copy_dir_if_absent(&from, &to, &mut warnings);
        } else if from.is_file() {
            copy_file_if_absent(&from, &to, &mut warnings);
        }
    }

    let complete = warnings.is_empty() && diff_covered(old, new);
    (complete, warnings)
}

/// 逐项比对：旧根的每个数据项（位置标记除外）是否都已在新根中存在且**内容一致**。
fn diff_covered(old: &Path, new: &Path) -> bool {
    match data_entries(old) {
        Some(entries) => entries.iter().all(|src| {
            let Some(name) = src.file_name() else {
                return false;
            };
            item_covered(src, &new.join(name))
        }),
        None => false,
    }
}

/// 文件内容的稳定指纹（FNV-1a 64 位，流式读取，不整文件进内存）。
fn file_fingerprint(p: &Path) -> Option<u64> {
    use std::io::Read;
    let mut f = std::fs::File::open(p).ok()?;
    let mut buf = [0u8; 64 * 1024];
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        for &b in &buf[..n] {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    Some(h)
}

/// 单项覆盖判断：源不存在视为已覆盖；文件先比大小、再比内容哈希；目录递归比对成员。
///
/// **只比大小是不够的**：目标位置若已存在同名同大小的**不同**文件（`copy_file_if_absent`
/// 遇已存在即跳过），仅比大小会误判为「已覆盖」，随后调用方清空旧根 → 旧数据被永久
/// 删除，新位置留下的却是别的内容。故大小相同后再逐字节比对哈希。
fn item_covered(src: &Path, dst: &Path) -> bool {
    if src.is_file() {
        match (std::fs::metadata(src), std::fs::metadata(dst)) {
            (Ok(a), Ok(b)) if a.len() == b.len() => matches!(
                (file_fingerprint(src), file_fingerprint(dst)),
                (Some(x), Some(y)) if x == y
            ),
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

/// 清理旧数据根：删除除位置标记外的**全部内容**，随后仅当目录已空才删掉目录本身。
///
/// 位置标记 `data-location.json` 始终保留，故系统目录（`%APPDATA%\Sticho`）永远不会
/// 被误删；程序目录若清空则会被移除。返回逐项删除的告警。
fn remove_data_items(root: &Path) -> Vec<String> {
    let mut warnings = Vec::new();

    let Some(entries) = data_entries(root) else {
        return warnings;
    };

    for p in entries {
        let r = if p.is_dir() {
            std::fs::remove_dir_all(&p)
        } else {
            std::fs::remove_file(&p)
        };
        if let Err(e) = r {
            warnings.push(format!("{}: delete failed ({e})", p.display()));
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
    Ok(data_root(&app)?
        .join("settings.json")
        .to_string_lossy()
        .into_owned())
}

/// 当前位置模式："user" | "portable"
///
/// 解析顺序与 `data_root` 保持一致：**先看会话缓存**（切换位置、重启前同一会话内立即一致），
/// 缓存未命中再回落磁盘探测。否则会出现「`data_root` 已是新位置、`get_data_location`
/// 仍报旧位置」的互相矛盾。两处都未初始化时退回 "user"（仅作展示兜底，真正的首次运行
/// 引导由 `get_config_state` 负责，它会如实返回 "unset"）。
#[tauri::command]
pub fn get_data_location(_app: tauri::AppHandle) -> Result<String, String> {
    if let Some(dir) = cache_lock().as_ref() {
        let portable = root_for(DataLocation::Portable)?;
        return Ok(if same_dir(dir, &portable) {
            "portable"
        } else {
            "user"
        }
        .to_string());
    }
    Ok(detect_location()?
        .unwrap_or(DataLocation::User)
        .as_str()
        .to_string())
}

/// 当前数据根目录的绝对路径（供设置界面只读展示）
#[tauri::command]
pub fn get_data_root(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_root(&app)?.to_string_lossy().into_owned())
}

/// 按目标模式给出可读的探测失败原因（提示用户换位置）。
fn probe_error(target: DataLocation, e: &std::io::Error) -> String {
    match target {
        DataLocation::User => format!("System user directory is not readable/writable: {e}"),
        DataLocation::Portable => format!(
            "The program directory is not readable/writable (it may be installed under Program Files or protected by security software). Please choose the system user directory instead: {e}"
        ),
    }
}

/// 首次运行引导用的配置状态："portable" | "user" | "unset"。
///
/// 与 `get_data_location` 的区别：这里**如实返回未初始化**，前端据此决定是否弹出
/// 首次运行引导（选择配置文件保存位置）。
#[tauri::command]
pub fn get_config_state(_app: tauri::AppHandle) -> Result<String, String> {
    Ok(match detect_location()? {
        Some(loc) => loc.as_str().to_string(),
        None => "unset".to_string(),
    })
}

/// 首次运行：写入用户选定的配置位置（位置标记 + 初始 settings.json）并立即生效。
///
/// 仅在两处都未初始化时允许调用（防止误改已生效位置）；成功后写入会话缓存，
/// 前端无需重启即可继续启动流程。
#[tauri::command]
pub fn setup_config_location(_app: tauri::AppHandle, mode: String) -> Result<String, String> {
    let loc = parse_target(&mode)?;
    if detect_location()?.is_some() {
        return Err("Config location is already initialized; no need to choose again".to_string());
    }
    let root = root_for(loc)?;
    probe_read_write(&root).map_err(|e| probe_error(loc, &e))?;
    let settings = root.join(SETTINGS_FILE);
    if !settings.is_file() {
        std::fs::write(&settings, b"{}\n")
            .map_err(|e| format!("Failed to write initial config file: {e}"))?;
    }
    write_bootstrap(loc)?;
    *cache_lock() = Some(root.clone());
    Ok(root.to_string_lossy().into_owned())
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
/// 供前端在**真正切换前**预检：失败即提示并回退，不落任何文件、不改位置标记。
#[tauri::command]
pub fn check_data_location(mode: String) -> Result<String, String> {
    let target = parse_target(&mode)?;
    let root = root_for(target)?;
    // 预检用「无副作用」版本：即便用户放弃切换，也不留下空目录或探针文件
    probe_read_write_clean(&root).map_err(|e| probe_error(target, &e))?;
    Ok(root.to_string_lossy().into_owned())
}

/// 切换数据保存位置，返回结构化结果。
///
/// - `mode` = "user" / "portable"；
/// - 切换前先探测目标目录可读写，失败则**整体拒绝**（不落任何文件、不改设置）；
/// - `migrate` 为 true 时把旧位置的数据复制到新位置，复制后校验完整性，
///   完整才清理旧目录（位置标记 `data-location.json` 不在清理范围内）。
#[tauri::command]
pub fn set_data_location(
    app: tauri::AppHandle,
    mode: String,
    migrate: Option<bool>,
) -> Result<SetLocationResult, String> {
    let target = parse_target(&mode)?;
    let migrate = migrate.unwrap_or(false);

    let old_root = data_root(&app)?;
    let new_root = root_for(target)?;

    // 必须用 same_dir：Windows 路径大小写不敏感，字节比较会把「同一个目录」判成不同目录，
    // 那样迁移后清理会把新根（即旧根）的数据一并删掉
    if same_dir(&new_root, &old_root) {
        write_bootstrap(target)?;
        return Ok(SetLocationResult {
            root: new_root.to_string_lossy().into_owned(),
            migrated: false,
            complete: true,
            cleaned: false,
            warnings: Vec::new(),
        });
    }

    std::fs::create_dir_all(&new_root)
        .map_err(|e| format!("Failed to create target directory: {e}"))?;

    if let Err(e) = probe_read_write(&new_root) {
        return Err(probe_error(target, &e));
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
            eprintln!(
                "[config] 迁移不完整，已保留原目录作为备份：{}",
                old_root.display()
            );
        }
    }

    for w in &warnings {
        eprintln!("[config] 迁移告警：{w}");
    }

    // 位置切换约定「重启后生效」，但会话缓存必须**立即**指向新根：否则切换后同一会话里
    // data_root()（读缓存，仍是旧根）与磁盘位置标记（已指向新根）结论不一致；且完整迁移后
    // 旧根的 settings.json 已被清理，继续读旧根会让后续命令拿到默认值。
    let target_settings = new_root.join(SETTINGS_FILE);
    if !target_settings.is_file() {
        // 迁移时已复制；这里兜底「不迁移」的情形，保证目标根始终有一份可用配置。
        let seed =
            std::fs::read(old_root.join(SETTINGS_FILE)).unwrap_or_else(|_| b"{}\n".to_vec());
        let _ = std::fs::write(&target_settings, seed);
    }
    write_bootstrap(target)?;
    *cache_lock() = Some(new_root.clone());

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

/// 一键清理配置根目录下的**全部用户数据**（位置标记 `data-location.json` 保留，
/// 因此当前的位置选择不丢）。内置包（主题 / 语言包 / 说明 / 欢迎页）会在下次启动时
/// 自动重新释放；用户自建的主题 / 语言包 / 书签 / 草稿 / 历史版本等会永久删除。
///
/// 前端负责在调用前做两次确认；返回逐项删除的告警（多为日志文件被占用等非致命情况）。
#[tauri::command]
pub fn clear_all_data(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let root = data_root(&app)?;
    Ok(remove_data_items(&root))
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
        // 旧版「指定目录」模式已移除
        assert!(validate_mode("custom").is_err());
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
        assert_eq!(parse_target("user").unwrap(), DataLocation::User);
        assert_eq!(parse_target("portable").unwrap(), DataLocation::Portable);
        assert!(parse_target("custom").is_err());
        assert!(parse_target("nope").is_err());
    }

    #[test]
    fn marker_detection_matches_mode() {
        let base = tmp_dir("marker");
        std::fs::create_dir_all(&base).unwrap();
        // 无标记
        assert_eq!(marker_mode_at(&base), None);
        assert!(!has_marker(&base, "portable"));
        // 写入便携标记
        let json = serde_json::to_string(&Bootstrap {
            mode: "portable".to_string(),
        })
        .unwrap();
        std::fs::write(base.join(BOOTSTRAP_FILE), json).unwrap();
        assert_eq!(marker_mode_at(&base).as_deref(), Some("portable"));
        assert!(has_marker(&base, "portable"));
        assert!(!has_marker(&base, "user"));
        // 损坏标记不 panic，判为无标记
        std::fs::write(base.join(BOOTSTRAP_FILE), b"not json").unwrap();
        assert_eq!(marker_mode_at(&base), None);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn migrate_copies_settings_and_dirs() {
        let base = tmp_dir("migrate");
        let old = base.join("old");
        let new = base.join("new");
        std::fs::create_dir_all(old.join("recovery")).unwrap();
        std::fs::create_dir_all(old.join("themes")).unwrap();
        // 后来才新增的目录（bookmarks / history / logs）也要随迁，不能漏
        std::fs::create_dir_all(old.join("bookmarks")).unwrap();
        std::fs::create_dir_all(old.join("history")).unwrap();
        std::fs::create_dir_all(old.join("logs")).unwrap();
        std::fs::write(old.join("settings.json"), b"{\"a\":1}").unwrap();
        std::fs::write(old.join("recovery").join("d1.json"), b"x").unwrap();
        std::fs::write(old.join("themes").join("t.css"), b"body{}").unwrap();
        std::fs::write(old.join("bookmarks").join("bm.json"), b"[]").unwrap();
        std::fs::write(old.join("history").join("h1.md"), b"v1").unwrap();
        std::fs::write(old.join("logs").join("app.log"), b"log").unwrap();
        // 位置标记不是数据，绝不能被搬到新位置
        std::fs::write(old.join(BOOTSTRAP_FILE), b"{\"mode\":\"user\"}").unwrap();

        let (complete, warnings) = migrate_data(&old, &new);

        assert!(warnings.is_empty(), "意外告警：{warnings:?}");
        assert!(complete, "迁移应判定为完整");
        assert!(new.join("settings.json").is_file());
        assert!(new.join("recovery").join("d1.json").is_file());
        assert!(new.join("themes").join("t.css").is_file());
        assert!(new.join("bookmarks").join("bm.json").is_file());
        assert!(new.join("history").join("h1.md").is_file());
        assert!(new.join("logs").join("app.log").is_file());
        assert!(!new.join(BOOTSTRAP_FILE).exists(), "位置标记不应被迁移");
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
    fn diff_covered_detects_same_size_different_content() {
        // 目标位置已有同名同大小、但内容不同的文件：旧版只比大小会误判为「已覆盖」，
        // 随后清空旧根 → 数据被永久删除。改为内容哈希后必须判为「未覆盖」。
        let base = tmp_dir("diff-same-size");
        let old = base.join("old");
        let new = base.join("new");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("settings.json"), b"AAAAA").unwrap();
        std::fs::write(new.join("settings.json"), b"BBBBB").unwrap();
        assert!(!diff_covered(&old, &new), "同大小不同内容不应判定为已覆盖");

        std::fs::write(new.join("settings.json"), b"AAAAA").unwrap();
        assert!(diff_covered(&old, &new), "内容一致才判定为已覆盖");
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
        // 位置标记保留，目录因此不被删除
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

    #[test]
    fn 预检不创建目标目录() {
        let base = tmp_dir("probe-clean");
        std::fs::create_dir_all(&base).unwrap();
        let missing = base.join("not-yet-created");

        assert!(probe_read_write_clean(&missing).is_ok());
        // 预检只探测最近的已存在祖先，不得把目标目录建出来
        assert!(!missing.exists(), "预检不应创建目标目录");
        assert!(!base.join(WRITE_PROBE).exists(), "预检不应残留探针文件");

        // 目录已存在时与 probe_read_write 行为一致
        assert!(probe_read_write_clean(&base).is_ok());
        assert!(!base.join(WRITE_PROBE).exists());
        std::fs::remove_dir_all(&base).ok();
    }
}
