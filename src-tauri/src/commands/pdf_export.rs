//! 导出 PDF（任务书阶段 4）
//!
//! 技术路线（与开工前确认一致）：「HTML 打印转 PDF」——
//! 1. 前端把 Markdown 渲染为完整打印 HTML（含 @page 规则 + 中文字体声明）
//! 2. Rust 侧创建不可见 WebviewWindow 加载该 HTML
//! 3. 通过 WebView2 官方 COM 接口 ICoreWebView2_7::PrintToPdf 静默生成 PDF
//!    （WebView2 用系统 DirectWrite 渲染中文字体，零内嵌字体、零额外依赖）
//!
//! 说明：Tauri 2 未把该能力封装成跨平台 API（只有 print() 打印对话框），
//! 故直接使用 wry 暴露的 PlatformWebview（controller/environment）操作 COM。
//!
//! 批次八补充：WebView2 的 ICoreWebView2PrintSettings **没有**书签（PDF 大纲）
//! 相关能力，实测 PrintToPdf 产出的 PDF 里既无 /Outlines 也无 /StructTreeRoot。
//! 故改走 Chromium 的 CDP：`Page.printToPDF` 多一个 `generateDocumentOutline`
//! 参数，会按 HTML 里的 h1~h6 生成 PDF 书签；参数不被支持时 CDP 会忽略它
//! （只丢书签，PDF 本身照常生成），CDP 整体失败时再回落原生 PrintToPdf。

use std::fs;
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2CallDevToolsProtocolMethodCompletedHandler,
    ICoreWebView2CallDevToolsProtocolMethodCompletedHandler_Impl, ICoreWebView2Environment6,
    ICoreWebView2PrintToPdfCompletedHandler, ICoreWebView2PrintToPdfCompletedHandler_Impl,
    ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
};
use windows_core::{implement, Interface, BOOL, HSTRING, PCWSTR};

/// A4 纵向（英寸）。PrintSettings 的页宽/高/边距单位均为英寸。
const A4_WIDTH: f64 = 8.27;
const A4_HEIGHT: f64 = 11.69;
const MARGIN_INCH: f64 = 0.7; // ≈ 18mm 上下左右

/// 打印结果等待上限：超大文档渲染 + 生成 PDF 可能较慢
const TIMEOUT: Duration = Duration::from_secs(60);

/// 打印完成回调（COM）：把 WebView2 异步结果传回命令线程
#[implement(ICoreWebView2PrintToPdfCompletedHandler)]
struct PrintDoneHandler {
    tx: mpsc::Sender<Result<(), String>>,
}

impl ICoreWebView2PrintToPdfCompletedHandler_Impl for PrintDoneHandler_Impl {
    fn Invoke(&self, errorcode: windows_core::HRESULT, result: BOOL) -> windows_core::Result<()> {
        let outcome = if errorcode.is_ok() {
            if result.as_bool() {
                Ok(())
            } else {
                Err("Failed to generate PDF (WebView2 returned a failure status)".to_string())
            }
        } else {
            Err(format!(
                "Failed to generate PDF (error code 0x{:08X})",
                errorcode.0 as u32
            ))
        };
        let _ = self.tx.send(outcome);
        Ok(())
    }
}

/// CDP 打印完成回调：把返回的 JSON（含 base64 PDF）解码后原子写盘
#[implement(ICoreWebView2CallDevToolsProtocolMethodCompletedHandler)]
struct CdpDoneHandler {
    path: String,
    tx: mpsc::Sender<Result<(), String>>,
}

impl ICoreWebView2CallDevToolsProtocolMethodCompletedHandler_Impl for CdpDoneHandler_Impl {
    fn Invoke(
        &self,
        errorcode: windows_core::HRESULT,
        result: &PCWSTR,
    ) -> windows_core::Result<()> {
        let outcome = cdp_output(errorcode, result, &self.path);
        let _ = self.tx.send(outcome);
        Ok(())
    }
}

/// CDP 结果处理：错误码 → JSON.error → data 字段的 base64 → 落盘。
/// 所有错误都带 `[CDP]` 前缀，调用方据此决定是否回落原生 PrintToPdf。
fn cdp_output(errorcode: windows_core::HRESULT, result: &PCWSTR, path: &str) -> Result<(), String> {
    if !errorcode.is_ok() {
        return Err(format!("[CDP] Print failed (0x{:08X})", errorcode.0 as u32));
    }
    let json = unsafe { result.to_string() }
        .map_err(|e| format!("[CDP] Failed to read print result: {e}"))?;
    let value: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| format!("[CDP] Failed to parse print result: {e}"))?;
    if let Some(message) = value
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
    {
        return Err(format!("[CDP] Print rejected: {message}"));
    }
    let data = value
        .get("data")
        .and_then(|d| d.as_str())
        .ok_or("[CDP] No PDF data in the print result")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|e| format!("[CDP] Failed to decode PDF data: {e}"))?;
    crate::commands::file_io::atomic_write(path, &bytes)
}

#[tauri::command]
pub async fn export_pdf(app: AppHandle, path: String, html_b64: String) -> Result<(), String> {
    // 1. 解码前端传来的打印 HTML，落临时文件
    let html = base64::engine::general_purpose::STANDARD
        .decode(html_b64.trim())
        .map_err(|e| format!("Failed to decode print data: {e}"))?;

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_html = std::env::temp_dir().join(format!("sticho-print-{nanos}.html"));
    fs::write(&tmp_html, &html)
        .map_err(|e| format!("Failed to write temporary print file: {e}"))?;

    let label = format!("pdf-print-{nanos}");
    let url = match tauri::Url::from_file_path(&tmp_html) {
        Ok(u) => u,
        Err(_) => {
            // 临时 HTML 已落盘，提前返回前必须清掉，否则每次失败都在临时目录留一份拷贝
            let _ = fs::remove_file(&tmp_html);
            return Err("The temporary file path cannot be converted to a URL".to_string());
        }
    };

    // 2. 结果通道
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    // 3. 不可见窗口加载打印 HTML
    let pdf_path = path.clone();
    if let Err(e) = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .title("Sticho Print")
        .inner_size(794.0, 1123.0) // A4 @96dpi 比例，仅影响布局视口
        .visible(false)
        .skip_taskbar(true)
        .on_page_load(move |webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let tx_inner = tx.clone();
                let pdf_path = pdf_path.clone();
                // 主线程回调内 with_webview 为同步派发（send_user_message 直通），无死锁
                if let Err(e) = webview.with_webview(move |pw| {
                    if let Err(err) = print_via_cdp(&pw, &pdf_path, tx_inner.clone()) {
                        let _ = tx_inner.send(Err(err));
                    }
                }) {
                    let _ = tx.send(Err(format!("[CDP] Failed to access WebView: {e}")));
                }
            }
        })
        .build()
    {
        // 同上：窗口没建起来也要清掉临时 HTML
        let _ = fs::remove_file(&tmp_html);
        return Err(format!("Failed to create print view: {e}"));
    }

    // 4. 等待打印完成（handler 回调发送结果）
    let mut result = rx
        .recv_timeout(TIMEOUT)
        .unwrap_or_else(|_| Err("PDF generation timed out (60 seconds)".to_string()));

    // CDP 通路整体不可用（接口拿不到、方法调用失败、结果异常）时回落原生 PrintToPdf：
    // 丢掉书签，但 PDF 仍能导出。CDP 通路出来的错误一律带 "[CDP]" 前缀，据此判定。
    if matches!(&result, Err(e) if e.starts_with("[CDP]")) {
        if let Some(window) = app.get_webview_window(&label) {
            let (tx2, rx2) = mpsc::channel::<Result<(), String>>();
            let pdf_path = path.clone();
            if window
                .with_webview(move |pw| {
                    if let Err(e) = print_via_webview2(&pw, &pdf_path, tx2.clone()) {
                        let _ = tx2.send(Err(e));
                    }
                })
                .is_ok()
            {
                result = rx2
                    .recv_timeout(TIMEOUT)
                    .unwrap_or_else(|_| Err("PDF generation timed out (60 seconds)".to_string()));
            }
        }
    }

    // 5. 清理：关窗口 + 删临时文件
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.destroy();
    }
    let _ = fs::remove_file(&tmp_html);

    result
}

/// 在 with_webview 回调内执行：走 CDP 的 Page.printToPDF。
///
/// 参数与原生 PrintToPdf 刻意保持一致（页宽高/边距/背景），增量有两处：
/// 1. `generateDocumentOutline`——按 h1~h6 生成 PDF 书签
/// 2. `displayHeaderFooter` + 自定义页眉页脚模板——页眉出文档名（取自打印 HTML 的
///    `<title>`），页脚出「第 N / M 页」。
///
/// 模板里的样式必须**内联**：页眉页脚不在文档的 CSS 作用域内，
/// 且 Chromium 要求显式给出 font-size（不给会是 0 或异常大）。
/// 左右 padding 与页边距一致，让页眉页脚与正文左右对齐。
fn print_via_cdp(
    pw: &tauri::webview::PlatformWebview,
    pdf_path: &str,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    unsafe {
        let core = pw
            .controller()
            .CoreWebView2()
            .map_err(|e| format!("[CDP] Failed to get WebView core interface: {e}"))?;

        let params = format!(
            concat!(
                r#"{{"paperWidth":{},"paperHeight":{},"marginTop":{},"marginBottom":{},"#,
                r#""marginLeft":{},"marginRight":{},"printBackground":true,"#,
                r#""displayHeaderFooter":true,"preferCSSPageSize":false,"#,
                r#""generateDocumentOutline":true,"transferMode":"ReturnAsBase64","#,
                r#""headerTemplate":"<div style=\"font-size:9px;width:100%;padding:0 0.7in;color:#8a8f98;white-space:nowrap;overflow:hidden;\"><span class=\"title\"></span></div>","#,
                r#""footerTemplate":"<div style=\"font-size:9px;width:100%;text-align:center;color:#8a8f98;\">Page <span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span></div>"}}"#
            ),
            A4_WIDTH, A4_HEIGHT, MARGIN_INCH, MARGIN_INCH, MARGIN_INCH, MARGIN_INCH
        );

        let handler: ICoreWebView2CallDevToolsProtocolMethodCompletedHandler = CdpDoneHandler {
            path: pdf_path.to_string(),
            tx,
        }
        .into();
        core.CallDevToolsProtocolMethod(
            &HSTRING::from("Page.printToPDF"),
            &HSTRING::from(params.as_str()),
            &handler,
        )
        .map_err(|e| format!("[CDP] {}", com_err(e)))?;
    }
    Ok(())
}

/// 在 with_webview 回调内执行：拿 COM 接口 → 配置打印 → 发起 PrintToPdf
fn print_via_webview2(
    pw: &tauri::webview::PlatformWebview,
    pdf_path: &str,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    unsafe {
        let controller = pw.controller();
        let core = controller
            .CoreWebView2()
            .map_err(|e| format!("Failed to get WebView core interface: {e}"))?;

        let core7: ICoreWebView2_7 = core.cast().map_err(|_| {
            "The current WebView2 runtime is too old to support printing to PDF (ICoreWebView2_7)".to_string()
        })?;

        let env6: ICoreWebView2Environment6 = pw.environment().cast().map_err(|_| {
            "The current WebView2 runtime is too old to support print settings (Environment6)"
                .to_string()
        })?;

        let settings = env6
            .CreatePrintSettings()
            .map_err(|e| format!("Failed to create print settings: {e}"))?;

        // A4 + 边距 + 打印背景色（代码块/表头底色必须保留）+ 页眉页脚
        settings.SetPageWidth(A4_WIDTH).map_err(com_err)?;
        settings.SetPageHeight(A4_HEIGHT).map_err(com_err)?;
        settings.SetMarginTop(MARGIN_INCH).map_err(com_err)?;
        settings.SetMarginBottom(MARGIN_INCH).map_err(com_err)?;
        settings.SetMarginLeft(MARGIN_INCH).map_err(com_err)?;
        settings.SetMarginRight(MARGIN_INCH).map_err(com_err)?;
        settings.SetShouldPrintBackgrounds(true).map_err(com_err)?;
        // 原生接口只能整体开关页眉页脚，样式与内容由 WebView2 固定（页脚含页码，
        // 同时会带上日期与临时文件 URL），不支持 CDP 那套自定义模板。
        // 这里仍开启，是为了「宁可样式差一点，也别丢了页码」——该分支只在 CDP 整体失败时走到。
        settings
            .SetShouldPrintHeaderAndFooter(true)
            .map_err(com_err)?;
        settings
            .SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)
            .map_err(com_err)?;
        settings.SetScaleFactor(1.0).map_err(com_err)?;

        let handler: ICoreWebView2PrintToPdfCompletedHandler = PrintDoneHandler { tx }.into();
        core7
            .PrintToPdf(&HSTRING::from(pdf_path), &settings, &handler)
            .map_err(com_err)?;
    }
    Ok(())
}

fn com_err(e: windows_core::Error) -> String {
    format!("WebView2 print interface call failed: {e}")
}
