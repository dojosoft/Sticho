//! 诊断信息（帮助菜单 →「导出诊断信息…」）与前端日志上报
//!
//! 发布版无控制台、`panic = "abort"`，出问题时必须能一键取回可定位的环境快照。
//! 报告内容：应用/系统/WebView2/Pandoc 版本、数据目录、**脱敏后的设置**、日志尾部。

use serde_json::Value;
use tauri::AppHandle;

/// 前端把关键事件写入日志（例如 `showError` 弹错时同步落盘）。
#[tauri::command]
pub fn log_event(app: AppHandle, level: String, message: String) {
    crate::logging::log(&app, &level, &message);
}

/// 生成诊断报告并写入用户选定路径（路径由前端 save 对话框给出）。
#[tauri::command]
pub async fn export_diagnostics(app: AppHandle, path: String) -> Result<(), String> {
    let report = build_report(&app).await;
    super::file_io::atomic_write(&path, report.as_bytes())
}

/// 组装诊断报告文本。
async fn build_report(app: &AppHandle) -> String {
    let mut out = String::new();
    out.push_str("Sticho 诊断信息\n");
    out.push_str(&format!("生成时间：{}\n", crate::logging::now_stamp()));
    out.push_str(&format!(
        "应用版本：{}（{}/{}）\n",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    out.push_str(&format!(
        "系统版本：{}\n",
        crate::setup::os_version().unwrap_or_else(|| "未知".into())
    ));
    out.push_str(&format!(
        "WebView2：{}\n",
        crate::setup::webview2_version().unwrap_or_else(|| "未安装".into())
    ));

    // Pandoc 是可选的导入/导出后端，缺失只影响部分功能，如实标注
    let pandoc = super::pandoc::check_pandoc(app.clone()).await;
    out.push_str(&format!(
        "Pandoc：{}\n",
        pandoc.unwrap_or_else(|| "未安装".into())
    ));

    out.push_str(&format!(
        "数据目录：{}\n",
        super::config::data_root(app)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|e| format!("无法定位（{e}）"))
    ));
    out.push_str(&format!(
        "配置文件：{}\n",
        super::config::get_settings_path(app.clone())
            .unwrap_or_else(|e| format!("无法定位（{e}）"))
    ));

    out.push_str("\n—— 设置（已脱敏，剔除密钥类字段）——\n");
    out.push_str(&settings_dump(app));

    out.push_str("\n—— 日志尾部 ——\n");
    let tail = crate::logging::read_tail(app);
    if tail.trim().is_empty() {
        out.push_str("（暂无日志）\n");
    } else {
        out.push_str(&tail);
    }
    out
}

/// 读 settings.json 并做脱敏后格式化输出；读取失败时给出说明而非中断导出。
fn settings_dump(app: &AppHandle) -> String {
    let Ok(path) = super::config::get_settings_path(app.clone()) else {
        return "（无法定位配置文件）\n".into();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return "（配置文件尚未生成）\n".into();
    };
    let mut value: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return format!("（配置文件解析失败：{e}）\n"),
    };
    sanitize(&mut value);
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| text)
}

/// 递归把密钥类字段的值替换为 `***`。
///
/// 即使当前 WebDAV 密码已改用 DPAPI 存在 secrets.json（不在 settings 内），
/// 这里仍做脱敏：防止用户手改配置、或将来新增字段时明文密钥被随报告外泄。
fn sanitize(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                if is_sensitive_key(k) {
                    *v = Value::String("***".into());
                } else {
                    sanitize(v);
                }
            }
        }
        Value::Array(items) => {
            for v in items.iter_mut() {
                sanitize(v);
            }
        }
        _ => {}
    }
}

/// 键名是否属于密钥类（大小写不敏感的子串匹配）
fn is_sensitive_key(key: &str) -> bool {
    const MARKERS: [&str; 6] = ["password", "passwd", "secret", "token", "apikey", "api_key"];
    let lower = key.to_ascii_lowercase();
    MARKERS.iter().any(|m| lower.contains(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 敏感字段被脱敏且普通字段保留() {
        let mut v: Value = serde_json::from_str(
            r#"{"davUrl":"https://x","davPassword":"hunter2","nested":{"authToken":"abc"},"list":[{"secret":"s"}]}"#,
        )
        .unwrap();
        sanitize(&mut v);

        assert_eq!(v["davUrl"], "https://x");
        assert_eq!(v["davPassword"], "***");
        assert_eq!(v["nested"]["authToken"], "***");
        assert_eq!(v["list"][0]["secret"], "***");
    }

    #[test]
    fn 键名判定覆盖常见写法() {
        assert!(is_sensitive_key("davPassword"));
        assert!(is_sensitive_key("API_KEY"));
        assert!(is_sensitive_key("userToken"));
        assert!(!is_sensitive_key("davUrl"));
        assert!(!is_sensitive_key("recentFiles"));
    }
}