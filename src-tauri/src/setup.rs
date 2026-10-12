//! 运行环境自检与原生安装引导（**在建窗口之前**执行）
//!
//! 为什么必须在建窗口之前做：WebView2 就是渲染引擎本身。缺它时应用连窗口都建不
//! 出来，**没有任何界面可用**——所以这里只能用系统原生 MessageBox 与用户交互，
//! 而不能像 pandoc 那样在应用内弹对话框（pandoc 的启动提示放在前端做）。
//!
//! 安装版另有 NSIS 的 downloadBootstrapper 在安装期兜底；本模块覆盖绿色版，
//! 以及安装期被跳过或失败的情况。

// ---------------------------------------------------------------- 对外入口

/// 启动前自检 WebView2：缺失则引导安装，或转跳官网；无论如何都给出可见的反馈，
/// 绝不静默退出（GUI 子系统没有控制台，「双击没反应」是最糟的结果）。
///
/// 环境正常时立即返回，交给 Tauri 继续建窗口。
#[cfg(windows)]
pub fn ensure_webview2_or_exit() {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let locations: [(windows_sys::Win32::System::Registry::HKEY, &str); 3] = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
    ];

    // 微软给原生应用推荐的检测方式：Edge 更新器把版本号写在注册表 `pv` 值里。
    // 三处任一命中即视为已安装（64 位视图 / 32 位视图 / 按用户安装）。
    let installed = locations.iter().any(|(root, subkey)| {
        match read_reg_string(*root, subkey, "pv") {
            // 0.0.0.0 是「已卸载 / 占位」的标记值，不能当作已安装
            Some(v) => !v.is_empty() && v != "0.0.0.0",
            None => false,
        }
    });
    if installed {
        return;
    }

    // 已自动装过一轮仍检测不到：不再重复自动安装，直接引导到官网（防死循环）
    if std::env::var_os(RETRY_GUARD).is_some() {
        if message_box(
            "仍未检测到 WebView2 运行时，程序无法启动。\n\n是否打开官方下载页面手动安装？",
            BoxIcon::Error,
            true,
        ) {
            open_url(WEBVIEW2_PAGE);
        }
        std::process::exit(1);
    }

    let auto_install = message_box(
        "本程序需要「Microsoft Edge WebView2 运行时」，但在当前系统中未检测到。\n\n\
         · 选择「是」：自动下载并静默安装（约 2MB，需要联网）\n\
         · 选择「否」：打开官方下载页面手动安装",
        BoxIcon::Warning,
        true,
    );

    if !auto_install {
        open_url(WEBVIEW2_PAGE);
        std::process::exit(1);
    }

    match install_webview2() {
        Ok(()) => {
            info_box("WebView2 运行时安装完成，程序即将重新启动。");
            relaunch_and_exit();
        }
        Err(e) => {
            // 自动安装失败 → 转跳官网下载页（需求要求的兜底出口）
            let go = message_box(
                &format!("自动安装 WebView2 失败：\n{e}\n\n是否打开官方下载页面手动安装？"),
                BoxIcon::Error,
                true,
            );
            if go {
                open_url(WEBVIEW2_PAGE);
            }
            std::process::exit(1);
        }
    }
}

#[cfg(not(windows))]
pub fn ensure_webview2_or_exit() {}

/// Tauri 建窗口 / 事件循环返回 Err 时的兜底提示。
///
/// 走到这里说明 WebView2 检测通过但仍初始化失败（运行时损坏、被安全软件拦截等），
/// 或其它启动期错误。用原生框把原因显示出来，而不是 panic 掉什么都不留。
pub fn report_startup_failure(msg: &str) {
    error_box(msg);
}

/// 已安装的 WebView2 运行时版本（注册表 `pv` 值）；未安装返回 None。
///
/// 供「导出诊断信息」使用——WebView2 是渲染引擎，其版本是排查渲染问题的首要信息。
#[cfg(windows)]
pub fn webview2_version() -> Option<String> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let locations: [(windows_sys::Win32::System::Registry::HKEY, &str); 3] = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
        (
            HKEY_CURRENT_USER,
            r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
    ];
    locations
        .iter()
        .filter_map(|(root, subkey)| read_reg_string(*root, subkey, "pv"))
        .find(|v| !v.is_empty() && v != "0.0.0.0")
}

#[cfg(not(windows))]
pub fn webview2_version() -> Option<String> {
    None
}

/// 系统版本描述（如 `Windows 10 Pro 22H2 (build 19045)`）；读不到返回 None。
#[cfg(windows)]
pub fn os_version() -> Option<String> {
    use windows_sys::Win32::System::Registry::HKEY_LOCAL_MACHINE;

    const KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let product = read_reg_string(HKEY_LOCAL_MACHINE, KEY, "ProductName")?;
    // Win10 21H2 起把 ReleaseId 换成了 DisplayVersion，两者取其一
    let release = read_reg_string(HKEY_LOCAL_MACHINE, KEY, "DisplayVersion")
        .or_else(|| read_reg_string(HKEY_LOCAL_MACHINE, KEY, "ReleaseId"))
        .unwrap_or_default();
    let build = read_reg_string(HKEY_LOCAL_MACHINE, KEY, "CurrentBuild").unwrap_or_default();

    let mut s = product;
    if !release.is_empty() {
        s.push(' ');
        s.push_str(&release);
    }
    if !build.is_empty() {
        s.push_str(&format!(" (build {build})"));
    }
    Some(s)
}

#[cfg(not(windows))]
pub fn os_version() -> Option<String> {
    None
}

/// 用系统默认程序打开 http/https 链接。
pub fn open_url(url: &str) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let op = wide("open");
        let u = wide(url);
        // SAFETY: 两个字符串均已 NUL 结尾且在本调用期间存活；lpparameters/lpdirectory
        // 传空表示不需要附加参数与工作目录。返回值（HINSTANCE）只用于判断成败，
        // 这里无需分支——失败时系统自身会给出提示。
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                u.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
        }
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

// ---------------------------------------------------------------- Windows 实现

#[cfg(windows)]
use std::path::Path;

/// WebView2 Evergreen Bootstrapper 官方固定短链（始终指向最新稳定版，约 2MB）
#[cfg(windows)]
const WEBVIEW2_BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/// WebView2 官方下载页（自动安装不可用时的兜底出口）
#[cfg(windows)]
const WEBVIEW2_PAGE: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

/// 已自动安装过一次的守卫变量：避免「装完仍检测不到 → 又拉起 → 又安装」的死循环
#[cfg(windows)]
const RETRY_GUARD: &str = "STICHO_WEBVIEW2_RETRIED";

/// 原生对话框统一使用的标题
#[cfg(windows)]
const APP_TITLE: &str = "Sticho";

/// 读一个 REG_SZ 注册表值；键不存在或类型不符返回 None。
#[cfg(windows)]
fn read_reg_string(
    root: windows_sys::Win32::System::Registry::HKEY,
    subkey: &str,
    value: &str,
) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};

    let sub = wide(subkey);
    let val = wide(value);
    let mut buf = [0u16; 256];
    let mut size = std::mem::size_of_val(&buf) as u32;

    // SAFETY: 两个入参字符串均已 NUL 结尾并在本次调用期间存活；接收缓冲区是本地
    // 定长数组，size 传入其字节容量，内核写入不会超过这个上限。
    let rc = unsafe {
        RegGetValueW(
            root,
            sub.as_ptr(),
            val.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buf.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if rc != 0 {
        return None; // 非 ERROR_SUCCESS 一律当作「读不到」
    }
    // size 是字节数且含结尾 NUL：换算为字符数后去掉它
    let n = (size as usize / 2).saturating_sub(1).min(buf.len());
    Some(String::from_utf16_lossy(&buf[..n]))
}

/// 下载 Evergreen Bootstrapper 并静默安装，装完以注册表为准复验。
#[cfg(windows)]
fn install_webview2() -> Result<(), String> {
    let setup = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");
    download(WEBVIEW2_BOOTSTRAPPER_URL, &setup)?;

    // /silent /install 是微软文档给出的静默安装参数；需要提权时系统会自行弹 UAC。
    let status = new_command(&setup)
        .args(["/silent", "/install"])
        .status()
        .map_err(|e| format!("无法运行安装程序：{e}"))?;
    let _ = std::fs::remove_file(&setup); // 清理下载到的安装包

    if !status.success() {
        return Err(format!("安装程序返回失败（退出码 {:?}）", status.code()));
    }
    // 装没装上不轻信安装程序的返回值，以上述注册表检测为准
    Ok(())
}

/// 下载单个 URL 到文件（带超时与状态码校验）
#[cfg(windows)]
fn download(url: &str, dest: &Path) -> Result<(), String> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(300))
        .call()
        .map_err(|e| format!("下载失败（请检查网络连接）：{e}"))?;
    if resp.status() != 200 {
        return Err(format!("下载失败（HTTP {}）", resp.status()));
    }
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(dest).map_err(|e| format!("创建临时文件失败：{e}"))?;
    std::io::copy(&mut reader, &mut file).map_err(|e| format!("写入临时文件失败：{e}"))?;
    Ok(())
}

/// 重新拉起本程序并退出（带守卫变量，防止「装完仍检测不到」时的无限循环）
#[cfg(windows)]
fn relaunch_and_exit() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = new_command(&exe).env(RETRY_GUARD, "1").spawn();
    }
    std::process::exit(0);
}

/// 构造子进程命令并抑制控制台窗口（GUI 子系统不需要，避免黑框闪现）
#[cfg(windows)]
fn new_command(program: &Path) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut cmd = std::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 原生对话框图标
#[cfg(windows)]
#[derive(Clone, Copy)]
enum BoxIcon {
    Info,
    Warning,
    Error,
}

/// 弹原生消息框。`yes_no` 为 true 时是「是 / 否」询问，返回是否选了「是」。
#[cfg(windows)]
fn message_box(text: &str, icon: BoxIcon, yes_no: bool) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_ICONERROR, MB_ICONINFORMATION, MB_ICONQUESTION, MB_OK,
        MB_SETFOREGROUND, MB_SYSTEMMODAL, MB_YESNO,
    };

    let icon_flag = match icon {
        BoxIcon::Info => MB_ICONINFORMATION,
        BoxIcon::Warning => MB_ICONQUESTION,
        BoxIcon::Error => MB_ICONERROR,
    };
    let buttons = if yes_no { MB_YESNO } else { MB_OK };
    let t = wide(text);
    let c = wide(APP_TITLE);

    // SAFETY: 两个字符串均已 NUL 结尾且在本调用期间存活；无属主窗口传空句柄是允许的。
    // MB_SYSTEMMODAL 保证对话框置顶，不会被其它窗口压住。
    let r = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            t.as_ptr(),
            c.as_ptr(),
            buttons | icon_flag | MB_SYSTEMMODAL | MB_SETFOREGROUND,
        )
    };
    r == IDYES
}

#[cfg(windows)]
fn info_box(text: &str) {
    message_box(text, BoxIcon::Info, false);
}

#[cfg(windows)]
fn error_box(text: &str) {
    message_box(text, BoxIcon::Error, false);
}

/// 转成 Windows 需要的 NUL 结尾 UTF-16 缓冲区
#[cfg(windows)]
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// ---------------------------------------------------------------- 非 Windows 兜底

#[cfg(not(windows))]
fn info_box(text: &str) {
    eprintln!("{text}");
}

#[cfg(not(windows))]
fn error_box(text: &str) {
    eprintln!("Sticho 启动失败：{text}");
}