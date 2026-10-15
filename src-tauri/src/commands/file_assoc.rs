//! 文件关联（任务书阶段 11）
//!
//! 只写 `HKCU\Software\Classes`（当前用户级），不触碰 HKLM：
//! 无需管理员权限、不影响其他用户，卸载/关闭开关时也容易清理。
//!
//! 关闭关联时，仅当该扩展名当前仍指向本程序才删除，
//! 避免把用户后来指定的其他程序（如 VS Code）抢走。
//!
//! 本模块还提供两项「系统集成」开关：
//! - 右键菜单「用 Sticho 打开」：写 `HKCU\Software\Classes\*\shell\Sticho`；
//! - 打开系统「默认应用」设置页：把记事本改成 Sticho 的最终确认交给系统界面。

use std::ffi::c_void;
use std::os::windows::process::CommandExt;

use serde::Serialize;
use winreg::enums::*;
use winreg::{RegKey, RegValue};

/// `CREATE_NO_WINDOW`：启动 `cmd` 时不要闪一个控制台窗口
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 支持关联的扩展名清单：`(扩展名, 分组)`。
///
/// 分组只用于注册表的「类型」显示名，以及设置面板里的分块展示；
/// 顺序即界面顺序，刻意把常用格式排在前面。
const SUPPORTED_EXTS: &[(&str, &str)] = &[
    // 文档 / Markdown
    ("md", "doc"),
    ("markdown", "doc"),
    ("mdx", "doc"),
    ("tex", "doc"),
    // 网页
    ("html", "web"),
    ("htm", "web"),
    ("xhtml", "web"),
    ("svg", "web"),
    ("xsl", "web"),
    ("xsd", "web"),
    // 纯文本
    ("txt", "text"),
    ("text", "text"),
    ("log", "text"),
    // 配置 / 数据
    ("ini", "config"),
    ("cfg", "config"),
    ("conf", "config"),
    ("properties", "config"),
    ("env", "config"),
    ("toml", "config"),
    ("yaml", "config"),
    ("yml", "config"),
    ("json", "config"),
    ("jsonc", "config"),
    ("xml", "config"),
    ("plist", "config"),
    // 源代码
    ("py", "code"),
    ("pyw", "code"),
    ("js", "code"),
    ("mjs", "code"),
    ("cjs", "code"),
    ("jsx", "code"),
    ("ts", "code"),
    ("mts", "code"),
    ("cts", "code"),
    ("tsx", "code"),
    ("css", "code"),
    ("scss", "code"),
    ("less", "code"),
    ("c", "code"),
    ("h", "code"),
    ("cpp", "code"),
    ("cc", "code"),
    ("cxx", "code"),
    ("hpp", "code"),
    ("hh", "code"),
    ("hxx", "code"),
    ("cs", "code"),
    ("java", "code"),
    ("kt", "code"),
    ("kts", "code"),
    ("go", "code"),
    ("rs", "code"),
    ("php", "code"),
    ("rb", "code"),
    ("swift", "code"),
    ("lua", "code"),
    ("pl", "code"),
    ("sql", "code"),
    ("vue", "code"),
    ("svelte", "code"),
    // 脚本
    ("bat", "script"),
    ("cmd", "script"),
    ("dos", "script"),
    ("ps1", "script"),
    ("psm1", "script"),
    ("psd1", "script"),
    ("sh", "script"),
    ("bash", "script"),
    ("zsh", "script"),
    ("ksh", "script"),
    ("dash", "script"),
];

/// 「替代系统记事本」覆盖的扩展名：都是 Windows 记事本的典型默认处理对象。
/// 勾选该开关即对这批扩展名批量建立关联。
const NOTEPAD_EXTS: &[&str] = &[
    "txt",
    "text",
    "log",
    "ini",
    "cfg",
    "conf",
    "properties",
    "env",
];

/// 右键菜单在注册表里的位置（`*` = 所有文件）
const CTX_KEY: &str = "Software\\Classes\\*\\shell\\Sticho";

const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
const SHCNF_IDLIST: u32 = 0;

#[link(name = "shell32")]
extern "system" {
    /// 通知资源管理器刷新文件关联（shell32）
    fn SHChangeNotify(event: i32, flags: u32, item1: *const c_void, item2: *const c_void);
}

#[link(name = "kernel32")]
extern "system" {
    /// 当前用户界面语言（LANGID：低 10 位为主语言 ID，高 6 位为子语言）
    fn GetUserDefaultUILanguage() -> u16;
}

/// `LANG_CHINESE`：LANGID 的主语言 ID（低 10 位）为 0x04 即中文（含简繁及各子语言）
const LANG_CHINESE: u16 = 0x04;

/// 右键菜单文案是否用中文：优先以操作系统当前 UI 语言为准；取不到时回落前端传入的
/// Sticho 界面语言（zh 开头即中文，其余一律英文）。
fn menu_label_is_chinese(locale: &str) -> bool {
    let langid = unsafe { GetUserDefaultUILanguage() };
    if langid != 0 {
        (langid & 0x03FF) == LANG_CHINESE
    } else {
        locale.trim().to_lowercase().starts_with("zh")
    }
}

/// 扩展名所属分组（不在清单内一律按纯文本处理）
fn group_of(ext: &str) -> &'static str {
    SUPPORTED_EXTS
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, g)| *g)
        .unwrap_or("text")
}

/// 规范化扩展名（去掉点号、转小写）并校验是否受支持
fn normalize(ext: &str) -> Result<String, String> {
    let ext = ext.trim_start_matches('.').to_lowercase();
    if !SUPPORTED_EXTS.iter().any(|(e, _)| *e == ext) {
        return Err(format!("Unsupported extension: .{ext}"));
    }
    Ok(ext)
}

/// 本程序为该扩展名注册的 ProgId
fn prog_id(ext: &str) -> String {
    format!("Sticho.{ext}")
}

/// 扩展名在 HKCU\Software\Classes 下的子键名（带前导点号：md → .md）。
///
/// 注意不能直接用 normalize 的结果当键名：注册表里扩展名键必须带点号，
/// 否则会写到 `...\Classes\md` 这种无效键上，系统不会认作文件关联。
fn ext_key(ext: &str) -> String {
    format!(".{ext}")
}

/// 资源管理器「类型」列显示的名称（按分组给一个统一的名字）
fn friendly_name(ext: &str) -> String {
    match ext {
        "md" | "markdown" | "mdx" => "Sticho Markdown Document",
        _ => match group_of(ext) {
            "web" => "Sticho Web Document",
            "config" => "Sticho Config File",
            "code" => "Sticho Source File",
            "script" => "Sticho Script File",
            _ => "Sticho Text Document",
        },
    }
    .to_string()
}

/// 程序（exe）绝对路径字符串。
///
/// 必须过一遍 `strip_verbatim`：`current_exe()` 在长路径 / 以 verbatim 形式启动时会返回
/// `\\?\C:\…` 形式。把带前缀的路径写进注册表的 `shell\open\command`，资源管理器拉起时
/// 不一定能解析该命令行，表现为「关联显示已设置、双击却打不开」——而 `get_context_menu`、
/// `DefaultIcon` 也都基于同一字符串，故统一在源头剥掉。
fn exe_string() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Failed to get program path: {e}"))?;
    Ok(crate::commands::config::strip_verbatim(&exe)
        .to_string_lossy()
        .into_owned())
}

/// 打开（必要时创建）HKCU\Software\Classes
///
/// 刻意不传 KEY_WOW64_*：winreg 默认按**本进程**的注册表视图访问，而本程序只出 64 位
/// 构建，视图即 64 位——资源管理器读的就是同一处，关联立刻生效。将来若出 32 位构建，
/// 这里必须补 KEY_WOW64_64KEY，否则会写进 Wow6432Node 而资源管理器读不到。
fn classes() -> Result<RegKey, String> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey("Software\\Classes")
        .map(|(key, _)| key)
        .map_err(|e| format!("Cannot access registry HKCU\\Software\\Classes: {e}"))
}

// ---------------------------------------------------------------- 扩展名清单

/// 一个可关联的扩展名（供设置面板渲染勾选网格）
#[derive(Serialize)]
pub struct AssocExt {
    /// 扩展名（不含点号，小写）
    pub ext: String,
    /// 分组：doc / web / text / config / code / script
    pub group: String,
}

/// 关联清单：全部可关联扩展名 + 「替代系统记事本」覆盖的扩展名
#[derive(Serialize)]
pub struct FileAssocInfo {
    pub exts: Vec<AssocExt>,
    pub notepad_exts: Vec<String>,
}

/// 返回可关联的扩展名清单（设置面板据此渲染，避免前后端各维护一份白名单）
#[tauri::command]
pub fn file_assoc_info() -> FileAssocInfo {
    FileAssocInfo {
        exts: SUPPORTED_EXTS
            .iter()
            .map(|(ext, group)| AssocExt {
                ext: (*ext).to_string(),
                group: (*group).to_string(),
            })
            .collect(),
        notepad_exts: NOTEPAD_EXTS.iter().map(|s| (*s).to_string()).collect(),
    }
}

// ---------------------------------------------------------------- 文件关联

/// 查询某扩展名是否已关联到本程序
#[tauri::command]
pub fn get_file_association(ext: String) -> Result<bool, String> {
    let ext = normalize(&ext)?;
    let classes = classes()?;

    let current: String = match classes.open_subkey(ext_key(&ext)) {
        Ok(key) => key.get_value("").unwrap_or_default(),
        Err(_) => return Ok(false), // 未注册过该扩展名
    };
    Ok(current == prog_id(&ext))
}

/// 撤下某扩展名的关联（供关闭开关与「清理系统写入」共用）。
///
/// 只在该扩展名当前仍指向本程序时移除默认值与「可用处理程序」登记，避免把用户后来
/// 指定的其他程序抢走；ProgId 键则总是删除（那是本程序自己的登记，不存在误删风险）。
fn unbind(classes: &RegKey, ext: &str) {
    let prog_id = prog_id(ext);
    let ours = classes
        .open_subkey(ext_key(ext))
        .ok()
        .and_then(|key| key.get_value::<String, _>("").ok())
        .map(|current| current == prog_id)
        .unwrap_or(false);
    if ours {
        // 只删默认值，保留 .ext 键下其他系统写入的值（如 Content Type）
        if let Ok(key) = classes.open_subkey_with_flags(ext_key(ext), KEY_SET_VALUE) {
            let _ = key.delete_value("");
        }
        // 一并撤下「可用处理程序」清单里的登记
        if let Ok(owp) = classes
            .open_subkey_with_flags(format!("{}\\OpenWithProgids", ext_key(ext)), KEY_SET_VALUE)
        {
            let _ = owp.delete_value(&prog_id);
        }
    }
    let _ = classes.delete_subkey_all(&prog_id);
}

/// 删除右键菜单项（不存在时视为成功，返回是否真的删了点东西）。
fn remove_context_menu() -> Result<bool, std::io::Error> {
    match RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(CTX_KEY) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

/// 打开 / 关闭某扩展名的文件关联
#[tauri::command]
pub fn set_file_association(ext: String, enable: bool) -> Result<(), String> {
    let ext = normalize(&ext)?;
    let classes = classes()?;
    let prog_id = prog_id(&ext);

    if enable {
        let exe = exe_string()?;

        // .ext → ProgId
        let ext_reg_key = classes
            .create_subkey(ext_key(&ext))
            .map_err(|e| format!("Failed to write registry ({}): {e}", ext_key(&ext)))?
            .0;
        ext_reg_key
            .set_value("", &prog_id)
            .map_err(|e| format!("Failed to write registry: {e}"))?;

        // .ext\OpenWithProgids → ProgId
        // 只写 .ext 的默认值在 Windows 11 上不够：缺少这份「可用处理程序」清单时，
        // 双击文档会弹「选取应用」让用户自己挑程序，而不是直接用本程序打开。
        ext_reg_key
            .create_subkey("OpenWithProgids")
            .map_err(|e| {
                format!(
                    "Failed to write registry ({} \\OpenWithProgids): {e}",
                    ext_key(&ext)
                )
            })?
            .0
            .set_raw_value(
                &prog_id,
                &RegValue {
                    bytes: Vec::new(),
                    vtype: REG_NONE,
                },
            )
            .map_err(|e| format!("Failed to write registry: {e}"))?;

        // ProgId → 显示名 / 图标 / 打开命令
        let (prog_key, _) = classes
            .create_subkey(&prog_id)
            .map_err(|e| format!("Failed to write registry ({prog_id}): {e}"))?;
        prog_key
            .set_value("", &friendly_name(&ext))
            .map_err(|e| format!("Failed to write registry: {e}"))?;

        let (icon_key, _) = prog_key
            .create_subkey("DefaultIcon")
            .map_err(|e| format!("Failed to write registry: {e}"))?;
        icon_key
            .set_value("", &format!("\"{exe}\",0"))
            .map_err(|e| format!("Failed to write registry: {e}"))?;

        let (cmd_key, _) = prog_key
            .create_subkey("shell\\open\\command")
            .map_err(|e| format!("Failed to write registry: {e}"))?;
        cmd_key
            .set_value("", &format!("\"{exe}\" \"%1\""))
            .map_err(|e| format!("Failed to write registry: {e}"))?;
    } else {
        unbind(&classes, &ext);
    }

    notify_shell();
    Ok(())
}

// ---------------------------------------------------------------- 右键菜单

/// 查询是否已注册「用 Sticho 打开」右键菜单项
#[tauri::command]
pub fn get_context_menu() -> Result<bool, String> {
    // 只认「当前这个 exe 路径」：程序换到别处后，旧位置留下的登记仍在注册表里，
    // 但这里的判定会返回 false（面板显示「未开启」），用户重新勾选即可覆盖旧登记。
    let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey(format!("{CTX_KEY}\\command")) {
        Ok(k) => k,
        Err(_) => return Ok(false),
    };
    let cmd: String = key.get_value("").unwrap_or_default();
    let exe = exe_string()?;
    Ok(cmd.to_lowercase().contains(&exe.to_lowercase()))
}

/// 打开 / 关闭「用 Sticho 打开」右键菜单项（作用于所有文件）。
///
/// 菜单文案的语种以操作系统当前语言为准，取不到时以 `locale`（Sticho 界面语言）为准：
/// 中文环境写中文，其余一律英文。
#[tauri::command]
pub fn set_context_menu(enable: bool, locale: String) -> Result<(), String> {
    let base = RegKey::predef(HKEY_CURRENT_USER);
    if enable {
        let exe = exe_string()?;
        let label = if menu_label_is_chinese(&locale) {
            "用 Sticho 打开"
        } else {
            "Open with Sticho"
        };
        let (key, _) = base
            .create_subkey(CTX_KEY)
            .map_err(|e| format!("Failed to write registry ({CTX_KEY}): {e}"))?;
        key.set_value("", &label.to_string())
            .map_err(|e| format!("Failed to write registry: {e}"))?;
        key.set_value("Icon", &format!("\"{exe}\",0"))
            .map_err(|e| format!("Failed to write registry: {e}"))?;
        let (cmd_key, _) = key
            .create_subkey("command")
            .map_err(|e| format!("Failed to write registry: {e}"))?;
        cmd_key
            .set_value("", &format!("\"{exe}\" \"%1\""))
            .map_err(|e| format!("Failed to write registry: {e}"))?;
    } else {
        let _ = base.delete_subkey_all(CTX_KEY);
    }
    notify_shell();
    Ok(())
}

// ---------------------------------------------------------------- 系统集成

/// 打开系统「默认应用」设置页（把记事本改成 Sticho 需要用户在该界面确认）
#[tauri::command]
pub fn open_default_apps_settings() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", "ms-settings:defaultapps"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Failed to open the system default apps settings: {e}"))?;
    Ok(())
}

/// 清理本程序对系统做过的全部改动，把软件恢复到「便携」状态：
/// - 撤销所有扩展名的文件关联（含「替代系统记事本」写入的那批）；
/// - 删除右键菜单「用 Sticho 打开」。
///
/// 只清 `HKCU\Software\Classes` 下属于本程序的登记，不动用户后来指定的其他程序；
/// 返回逐项清理过程中的告警（正常为空）。
#[tauri::command]
pub fn clear_system_integration() -> Result<Vec<String>, String> {
    let mut warnings = Vec::new();

    let classes = classes()?;
    for (ext, _) in SUPPORTED_EXTS {
        unbind(&classes, ext);
    }

    if let Err(e) = remove_context_menu() {
        warnings.push(format!("Failed to delete the context menu item: {e}"));
    }

    notify_shell();
    Ok(warnings)
}

/// 通知资源管理器立即刷新关联（否则可能要等其自身刷新或重启才生效）
fn notify_shell() {
    unsafe {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED,
            SHCNF_IDLIST,
            std::ptr::null(),
            std::ptr::null(),
        )
    }
}
