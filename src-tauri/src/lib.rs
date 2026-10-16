//! Sticho - 主入口
//!
//! 阶段 2：注册 dialog 插件 + 文件读写命令。
//! 阶段 10：新增剪贴板插件（编辑菜单的剪切/复制/粘贴）与文件属性命令。
//! 阶段 11：编码检测/切换、文件关联、目录列举命令。
//! 环境自检：启动前检测 WebView2（见 setup 模块），缺 pandoc 的提示在前端做。

mod commands;
mod logging;
mod setup;

/// 应用唯一入口。main.rs 调用此处，便于单元测试与未来的多目标复用。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 建窗口之前先自检 WebView2：缺它连窗口都建不出来（没有界面可用），
    // 只能用原生对话框引导安装或转跳官网。
    setup::ensure_webview2_or_exit();

    // 单实例插件必须是**第一个**注册的插件：第二个实例启动时由它在其它插件初始化
    // 之前拦下，把命令行里的文件路径转发给已有窗口（前端监听 open-file 事件新开标签页）。
    //
    // 只有桌面需要它：移动端没有「第二个实例」这回事，该插件本身也只支持桌面
    // （见 Cargo.toml 的平台专属依赖段），故这里整块按 desktop 门控。
    #[cfg(desktop)]
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::{Emitter, Manager};

            // 已有窗口被最小化 / 压在其他窗口后面时，先还原并置前，让用户看到反馈
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }

            // argv[0] 是本程序自身的路径；其余参数才是双击文档 / 命令行传入的文件。
            // 以 '-' 开头的按开关参数忽略（WebView2 / Chromium 会注入 --allow-file-access 等）。
            let files: Vec<String> = argv
                .into_iter()
                .skip(1)
                .filter(|a| !a.starts_with('-'))
                .collect();
            if !files.is_empty() {
                let _ = app.emit("open-file", files);
            }
        }));
    #[cfg(not(desktop))]
    let builder = tauri::Builder::default();

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        // 安装 panic 钩子（abort 前仍会执行，崩溃原因可落日志）并记一条启动日志
        .setup(|app| {
            let handle = app.handle().clone();
            logging::install_panic_hook(handle.clone());
            logging::log(&handle, "INFO", "应用启动");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::file_io::read_text_file,
            commands::file_io::write_text_file,
            commands::file_io::write_file_base64,
            commands::file_io::read_pdf_base64,
            commands::file_io::read_image_base64,
            commands::file_io::get_file_info,
            commands::file_io::list_dir,
            commands::file_io::search_files,
            commands::file_io::get_startup_file,
            commands::file_io::reveal_in_explorer,
            commands::asset::save_image_asset,
            commands::asset::allow_asset_dir,
            commands::config::get_settings_path,
            commands::config::get_data_location,
            commands::config::get_data_root,
            commands::config::get_config_state,
            commands::config::setup_config_location,
            commands::config::check_data_location,
            commands::config::set_data_location,
            commands::config::restart_app,
            commands::config::clear_all_data,
            commands::file_assoc::get_file_association,
            commands::file_assoc::set_file_association,
            commands::file_assoc::file_assoc_info,
            commands::file_assoc::get_context_menu,
            commands::file_assoc::set_context_menu,
            commands::file_assoc::open_default_apps_settings,
            commands::file_assoc::clear_system_integration,
            commands::pdf_export::export_pdf,
            commands::recovery::write_recovery,
            commands::recovery::list_recovery,
            commands::recovery::read_recovery,
            commands::recovery::delete_recovery,
            commands::pandoc::check_pandoc,
            commands::pandoc::download_pandoc,
            commands::pandoc::import_docx,
            commands::pandoc::export_pandoc,
            commands::theme::load_themes,
            commands::theme::open_theme_dir,
            commands::packs::ensure_packs,
            commands::packs::load_locales,
            commands::packs::load_fonts,
            commands::packs::open_pack_dir,
            commands::webdav::webdav_test,
            commands::webdav::webdav_upload,
            commands::webdav::webdav_put,
            commands::webdav::webdav_list,
            commands::webdav::webdav_download,
            commands::webdav::webdav_stat,
            commands::secrets::save_dav_password,
            commands::secrets::load_dav_password,
            commands::system::open_url,
            commands::diagnostics::log_event,
            commands::diagnostics::export_diagnostics,
            commands::history::list_history,
            commands::history::read_history,
            commands::history::restore_history,
            commands::history::list_all_history,
            commands::history::delete_history,
            commands::history::prune_history,
            commands::bookmarks::bookmarks_save,
            commands::bookmarks::bookmarks_load,
            commands::bookmarks::bookmarks_delete,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            setup::report_startup_failure(&format!(
                "Failed to start the app UI:\n{e}\n\n\
                 If the WebView2 runtime is missing, install it and try again:\n\
                 https://developer.microsoft.com/microsoft-edge/webview2/"
            ));
            std::process::exit(1);
        });
}
