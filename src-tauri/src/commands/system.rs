//! 系统级小工具命令
//!
//! 目前只有「用默认浏览器打开链接」——pandoc 自动下载失败时要转跳官网，
//! 这类外链不能在 WebView 里直接开（会把应用本身导航走），必须交给系统浏览器。

/// 用系统默认浏览器打开 http/https 链接。
///
/// 只放行 http/https：ShellExecute 会把任意字符串当协议/文件处理，
/// 不加白名单等于给前端开了一个「执行任意本地文件」的口子。
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只允许打开 http / https 链接".to_string());
    }
    crate::setup::open_url(url);
    Ok(())
}