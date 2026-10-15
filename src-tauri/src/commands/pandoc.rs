//! 导入 Word（任务书阶段 5）—— Pandoc 子进程集成
//!
//! 许可证边界（任务书 2.2 例外条款）：Pandoc 为 GPL-2.0，只能以独立 exe
//! 形式通过 std::process::Command 子进程调用，绝不链接其源码/库。
//!
//! 分发策略：不随安装包分发（约 180MB），首次使用「导入 Word」时
//! 下载官方 release 到用户数据目录（app_data/pandoc/pandoc.exe）。
//! 用户 PATH 中自装的 pandoc 亦可被自动检测复用。

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

/// Pandoc 官方发行包（GitHub Releases，固定版本保证可复现）
const PANDOC_VERSION: &str = "3.6.3";
const PANDOC_RELEASE_PATH: &str =
    "jgm/pandoc/releases/download/3.6.3/pandoc-3.6.3-windows-x86_64.zip";
/// 下载源列表：官方 GitHub 直连优先，失败后回落公共加速镜像（部分网络环境无法直连 GitHub）
const PANDOC_DOWNLOAD_URLS: [&str; 3] = [
    "https://github.com",
    "https://ghfast.top/https://github.com",
    "https://gh-proxy.com/https://github.com",
];

/// pandoc 转换超时：正常文档秒级完成，卡死进程（如杀软拦截）60 秒后放弃
const PANDOC_TIMEOUT: Duration = Duration::from_secs(60);
/// 下载超时（35MB，慢网络预留 10 分钟）
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

/// 导入 docx 时单张媒体内联成 data URI 的体积上限。
///
/// 超过就放弃内联（保留原引用），避免一张超大图把正文撑爆、编辑器卡死。
const MAX_INLINE_MEDIA: u64 = 10 * 1024 * 1024;

/// 官方发行包 `pandoc-3.6.3-windows-x86_64.zip` 的 SHA256。
///
/// 下载后强校验：第三方加速镜像若被投毒，哈希必然不匹配，从而拒绝安装/执行。
/// 取值来自 Scoop Main bucket 对 v3.6.3 的已发布校验值。
const PANDOC_ZIP_SHA256: &str = "a31dc5b14a235efa1f2cf103f71f656eeb76ce1b458d22d24f390c66db7224f1";

// ---- pandoc 定位 ----

/// 创建 pandoc 子进程（所有调用统一走这里）。
///
/// 本程序是 GUI 子系统，没有控制台可供子进程继承，Windows 默认会为它
/// 新开一个命令行窗口（导入 Word 时闪黑框）。CREATE_NO_WINDOW 抑制之。
fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// 应用管理的 pandoc（用户数据目录下的 pandoc/）
fn managed_pandoc(app: &AppHandle) -> Option<PathBuf> {
    let p = crate::commands::config::data_root(app)
        .ok()?
        .join("pandoc")
        .join("pandoc.exe");
    p.exists().then_some(p)
}

/// 查找可用 pandoc：先应用数据目录，再系统 PATH
fn find_pandoc(app: &AppHandle) -> Option<PathBuf> {
    if let Some(p) = managed_pandoc(app) {
        return Some(p);
    }
    match command("pandoc").arg("--version").output() {
        Ok(o) if o.status.success() => Some(PathBuf::from("pandoc")),
        _ => None,
    }
}

/// 检测 pandoc 可用性，返回版本描述（None = 未安装）。
///
/// 同步命令在主线程执行，而拉起子进程 + 读输出可能有可感知停顿，故放后台线程。
#[tauri::command]
pub async fn check_pandoc(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pandoc = find_pandoc(&app)?;
        let out = command(&pandoc).arg("--version").output().ok()?;
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .map(str::to_string)
    })
    .await
    .ok()
    .flatten()
}

// ---- 下载与安装 ----

/// 下载 Pandoc 官方发行包并安装到用户数据目录。
/// 返回版本描述。阻塞式（前端 busy 状态覆盖等待期）。
#[tauri::command]
pub async fn download_pandoc(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download_pandoc_blocking(&app))
        .await
        .map_err(|e| format!("Download task spawn failed: {e}"))?
}

fn download_pandoc_blocking(app: &AppHandle) -> Result<String, String> {
    let data_dir = crate::commands::config::data_root(app)
        .map_err(|e| format!("Failed to locate user data directory: {e}"))?;
    let pandoc_dir = data_dir.join("pandoc");
    fs::create_dir_all(&pandoc_dir)
        .map_err(|e| format!("Failed to create pandoc directory: {e}"))?;

    let target = pandoc_dir.join("pandoc.exe");
    if target.exists() {
        return Ok(PANDOC_VERSION.into());
    }

    // 1. 下载 zip 到临时文件（多源依次重试：官方 → 加速镜像）
    let zip_path = pandoc_dir.join("pandoc-download.zip");
    let mut last_err = String::new();
    let mut ok = false;
    for base in PANDOC_DOWNLOAD_URLS {
        let url = format!("{base}/{PANDOC_RELEASE_PATH}");
        match download_file(&url, &zip_path) {
            Ok(()) => {
                ok = true;
                break;
            }
            Err(e) => last_err = e,
        }
    }
    if !ok {
        let _ = fs::remove_file(&zip_path); // 清掉可能残留的半包
        return Err(format!(
            "Download failed (both the official and mirror sources are unreachable): {last_err}"
        ));
    }

    // 2. 校验 SHA256：加速镜像若被投毒，哈希必然不匹配，从而拒绝安装与执行
    let actual = sha256_file(&zip_path)?;
    if !actual.eq_ignore_ascii_case(PANDOC_ZIP_SHA256) {
        let _ = fs::remove_file(&zip_path);
        return Err(format!(
            "Download package verification failed (SHA256 mismatch); installation aborted to avoid running a tampered program: expected {PANDOC_ZIP_SHA256}, actual {actual}"
        ));
    }

    // 3. 解压出 pandoc.exe（流式落盘，避免把上百 MB 的 exe 整个读进内存）
    let file =
        fs::File::open(&zip_path).map_err(|e| format!("Failed to open download package: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Download package is corrupted (zip parse failed): {e}"))?;

    let mut found = false;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read download package: {e}"))?;
        if entry.name().replace('\\', "/").ends_with("pandoc.exe") {
            let mut out = fs::File::create(&target)
                .map_err(|e| format!("Failed to write pandoc.exe: {e}"))?;
            let copied = std::io::copy(&mut entry, &mut out).and_then(|_| out.flush());
            drop(out);
            if let Err(e) = copied {
                // 解压失败不能留下半截 exe：否则下次启动会误判成「已安装」
                let _ = fs::remove_file(&target);
                return Err(format!("Failed to extract pandoc: {e}"));
            }
            found = true;
            break;
        }
    }
    let _ = fs::remove_file(&zip_path); // 清理下载包

    if !found {
        return Err("Unexpected download package structure (pandoc.exe not found)".to_string());
    }

    // 4. 验证可执行
    let out = command(&target).arg("--version").output().map_err(|e| {
        format!("pandoc.exe cannot run (it may be blocked by security software): {e}")
    })?;
    if !out.status.success() {
        return Err("pandoc.exe exited with an error".to_string());
    }
    let first = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .unwrap_or(PANDOC_VERSION)
        .to_string();
    Ok(first)
}

/// 计算文件 SHA256（十六进制小写；分块读，避免整包进内存）。
fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|e| format!("Failed to read download package: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Failed to read download package: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// 下载单个 URL 到文件（带超时与状态码校验）
fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let resp = ureq::get(url)
        .timeout(DOWNLOAD_TIMEOUT)
        .call()
        .map_err(|e| format!("Download failed (check your network connection): {e}"))?;
    if resp.status() != 200 {
        return Err(format!("Download failed (HTTP {})", resp.status()));
    }
    let mut reader = resp.into_reader();
    let mut file = fs::File::create(dest)
        .map_err(|e| format!("Failed to create temporary download file: {e}"))?;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("Failed to write download file: {e}"))?;
    }
    file.flush()
        .map_err(|e| format!("Failed to write download file: {e}"))?;
    Ok(())
}

// ---- docx → markdown ----

/// 导入 Word 文档：pandoc 转 GFM，媒体图片内联为 data URI（随文档走、编辑器直接可见）。
///
/// pandoc 是可能跑到超时的外部进程，放后台线程执行，避免阻塞主线程。
#[tauri::command]
pub async fn import_docx(app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || import_docx_blocking(&app, &path))
        .await
        .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn import_docx_blocking(app: &AppHandle, path: &str) -> Result<String, String> {
    let pandoc = find_pandoc(app).ok_or("Pandoc is not installed (please click download first)")?;
    let src = Path::new(path);
    if !src.exists() {
        return Err(format!("File does not exist: {path}"));
    }

    // 临时工作目录（--extract-media 的媒体输出位置）
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let work = std::env::temp_dir().join(format!("sticho-import-{nanos}"));
    fs::create_dir_all(&work).map_err(|e| format!("Failed to create temporary directory: {e}"))?;

    // 带超时的子进程调用（线程 + 通道，避免卡死主线程）
    let mut cmd = command(&pandoc);
    cmd.args([
        "-f",
        "docx",
        "-t",
        "gfm",
        "--wrap=none",
        "--extract-media=media",
    ])
    .arg(path)
    .current_dir(&work);
    let out = match run_with_timeout(cmd, PANDOC_TIMEOUT) {
        Ok(out) => out,
        Err(e) => {
            // 超时/启动失败同样要清临时媒体，否则每次失败都在 %TEMP% 里留一份
            let _ = fs::remove_dir_all(&work);
            return Err(e);
        }
    };

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let _ = fs::remove_dir_all(&work); // 转换失败也要清临时媒体
        return Err(format!(
            "Pandoc conversion failed: {}",
            stderr.trim().chars().take(300).collect::<String>()
        ));
    }

    let md = String::from_utf8_lossy(&out.stdout).to_string();
    // 图片相对引用 → data URI 内联
    let inlined = inline_media(&md, &work);

    let _ = fs::remove_dir_all(&work); // 清理临时媒体
    Ok(inlined)
}

// ---- markdown → LaTeX / Epub ----

/// 导出目标：kind → (pandoc 目标格式, 附加参数)
fn export_target(kind: &str) -> Option<(&'static str, &'static [&'static str])> {
    match kind {
        // -s：独立可编译的 .tex（含文档导言区）
        "latex" => Some(("latex", &["-s"])),
        // --toc：Epub 自带章节导航
        "epub" => Some(("epub3", &["--toc"])),
        _ => None,
    }
}

/// 导出为 Pandoc 支持的格式（LaTeX .tex / Epub .epub）。
///
/// 正文由前端传入（Markdown），base 为源文档所在目录——
/// 正文里的相对路径图片（如 `assets/a.png`）靠它解析，未保存文档传 None。
#[tauri::command]
pub async fn export_pandoc(
    app: AppHandle,
    path: String,
    content: String,
    kind: String,
    base: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_pandoc_blocking(&app, &path, &content, &kind, base.as_deref())
    })
    .await
    .map_err(|e| format!("Task spawn failed: {e}"))?
}

fn export_pandoc_blocking(
    app: &AppHandle,
    path: &str,
    content: &str,
    kind: &str,
    base: Option<&str>,
) -> Result<(), String> {
    let (to, extra) =
        export_target(kind).ok_or_else(|| format!("Unsupported export format: {kind}"))?;
    let pandoc = find_pandoc(app).ok_or(
        "Pandoc is not installed (please click download in \"File -> Import Word\" first)",
    )?;

    // 正文落临时文件（pandoc 从文件读，避免命令行长度与编码问题）
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_md = std::env::temp_dir().join(format!("sticho-export-{nanos}.md"));
    fs::write(&tmp_md, content.as_bytes())
        .map_err(|e| format!("Failed to write temporary file: {e}"))?;

    let mut cmd = command(&pandoc);
    cmd.args(["-f", "gfm", "-t", to])
        .args(extra)
        .arg(&tmp_md)
        .arg("-o")
        .arg(path);
    if let Some(dir) = base.filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    let out = run_with_timeout(cmd, PANDOC_TIMEOUT);
    let _ = fs::remove_file(&tmp_md);
    let out = out?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "Pandoc export failed: {}",
            stderr.trim().chars().take(300).collect::<String>()
        ));
    }
    Ok(())
}

/// 子进程超时执行（std::process 无原生超时，用线程 + 通道实现）。
///
/// 超时必须**先真正终止子进程**再回收等待线程：`wait_with_output` 会一直阻塞到子进程退出，
/// 只做 `join()` 而不杀进程会让本函数永不返回（进而冻结调用它的命令）。
fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<std::process::Output, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = cmd.spawn().map_err(|e| {
        format!("Failed to start Pandoc (it may be blocked by security software): {e}")
    })?;
    let pid = child.id();

    let (tx, rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        let result = child.wait_with_output();
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(out)) => Ok(out),
        Ok(Err(e)) => Err(format!("Failed to wait for Pandoc: {e}")),
        Err(_) => {
            kill_tree(pid);
            let _ = handle.join(); // 进程已终止，等待线程随即返回
            Err("Pandoc conversion timed out (60 seconds); the child process has been terminated. Please check whether the document is corrupted".to_string())
        }
    }
}

/// 强制结束整棵进程树（Windows 用 `taskkill /T` 连子进程一起杀）。
#[cfg(windows)]
fn kill_tree(pid: u32) {
    let _ = command("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(windows))]
fn kill_tree(pid: u32) {
    let _ = command("kill").args(["-9", &pid.to_string()]).status();
}

/// 把 pandoc 输出里的相对媒体引用安全地解析到 `base` 之内。
///
/// `rel` 直接来自 pandoc 输出的正文，未校验就 `base.join(rel)` 会有目录穿越面：
/// 恶意 docx 可让关系目标写成 `media/../../…`，读盘后内容以 data URI 回传前端。
/// 这里只接受普通相对片段（拒绝绝对/盘符前缀、`.`、`..`、空段），并对结果
/// `canonicalize` 校验仍位于 `base` 之下，顺带挡住符号链接绕行。
fn safe_media_path(base: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.replace('\\', "/");
    if rel.is_empty() || rel.starts_with('/') || rel.contains(':') {
        return None;
    }
    if rel.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return None;
    }
    let canon = base.join(&rel).canonicalize().ok()?;
    let base_canon = base.canonicalize().ok()?;
    canon.starts_with(&base_canon).then_some(canon)
}

/// 把 markdown 中的媒体引用内联为 data URI，覆盖两种形式：
/// - `](media/xxx)`：markdown 图片/链接语法
/// - `src="media/xxx"`：pandoc 对带尺寸图片输出的原生 HTML `<img>` 标签
///
/// 找不到文件或类型不支持时保留原引用（信息不丢失）
fn inline_media(md: &str, base: &Path) -> String {
    let pass1 = replace_media_refs(md, base, b"](media/", b')');
    replace_media_refs(&pass1, base, b"src=\"media/", b'"')
}

/// 单次扫描替换：needle 定位引用起点，terminator 定位终点，路径为两者之间
fn replace_media_refs(md: &str, base: &Path, needle: &[u8], terminator: u8) -> String {
    let mut out = String::with_capacity(md.len());
    let bytes = md.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i..].starts_with(needle) {
            // 路径起点：needle 尾部的 "media/" 之前（引用可写作 media/xxx）
            let rel_start = i + needle.len() - b"media/".len();
            let end = match bytes[rel_start..].iter().position(|&b| b == terminator) {
                Some(p) => rel_start + p,
                None => {
                    out.push_str(&md[i..]);
                    break;
                }
            };
            let rel = &md[rel_start..end];

            // 经安全解析后再读盘：不可信（越界）或读不到的引用一律原样保留。
            if let Some(data_uri) = safe_media_path(base, rel).and_then(|f| read_as_data_uri(&f)) {
                out.push_str(&md[i..rel_start]); // 前缀 ]( 或 src="
                out.push_str(&data_uri);
                out.push(terminator as char); // 终止符 ) 或 "（ASCII，按字节取即可，不再对切片取字符）
            } else {
                out.push_str(&md[i..end + 1]); // 原样保留
            }
            i = end + 1;
        } else {
            // i 始终落在字符边界上（推进方式见上），此处必有字符；用 let-else 代替 unwrap
            let Some(ch) = md[i..].chars().next() else {
                break;
            };
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/// 读图片文件 → data URI（仅浏览器可显示的类型）
///
/// 单张体积超过 [`MAX_INLINE_MEDIA`] 时不内联：docx 里塞进一张几十 MB 的图，
/// base64 后会让正文膨胀数倍并拖垮编辑器；这类图片保持原样丢弃引用即可。
fn read_as_data_uri(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        // emf/wmf 浏览器不支持，跳过
        _ => return None,
    };
    let meta = fs::metadata(path).ok()?;
    if meta.len() > MAX_INLINE_MEDIA {
        return None;
    }
    let data = fs::read(path).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(data);
    Some(format!("data:{mime};base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// 构造含一个 PNG 文件的独立临时目录（每个测试唯一，避免并发竞态）
    fn fixture() -> (std::path::PathBuf, String) {
        static SEQ: AtomicU32 = AtomicU32::new(0);
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("sticho-inline-media-test-{n}"));
        fs::create_dir_all(dir.join("media/media")).unwrap();
        // 1x1 透明 PNG
        let png: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89,
        ];
        fs::write(dir.join("media/media/img1.png"), png).unwrap();
        // 期望的 data URI 前缀（base64 编码后内容）
        let b64 = base64::engine::general_purpose::STANDARD.encode(png);
        (dir, format!("data:image/png;base64,{b64}"))
    }

    #[test]
    fn markdown_img_inlined() {
        let (dir, uri) = fixture();
        let out = inline_media("前文\n\n![alt](media/media/img1.png)\n\n后文", &dir);
        assert!(out.contains(&format!("![alt]({uri})")), "实际：{out}");
        assert!(out.starts_with("前文") && out.ends_with("后文"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn html_img_inlined() {
        let (dir, uri) = fixture();
        let src = r#"<img src="media/media/img1.png" style="width:1.25in" />"#;
        let out = inline_media(src, &dir);
        assert!(out.contains(&format!(r#"src="{uri}""#)), "实际：{out}");
        assert!(out.contains(r#"style="width:1.25in""#), "样式应保留：{out}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_file_kept_as_is() {
        let (dir, _) = fixture();
        let src = "![alt](media/media/不存在.png)";
        assert_eq!(inline_media(src, &dir), src);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsupported_type_kept_as_is() {
        let (dir, _) = fixture();
        fs::write(dir.join("media/media/图1.emf"), b"emf").unwrap();
        let src = "![alt](media/media/图1.emf)";
        assert_eq!(inline_media(src, &dir), src);
        let _ = fs::remove_dir_all(&dir);
    }
}
