//! 诊断日志（基础设施模块）
//!
//! 目的：发布版是 `panic = "abort"` + 无控制台的 GUI 程序，出问题时用户只看到
//! 「闪退 / 没反应」，没有任何线索。这里把关键事件（启动、错误提示、panic）追加
//! 写入 `<数据根>/logs/sticho.log`，并在帮助菜单提供「导出诊断信息」一键取回。
//!
//! 设计取舍：
//! - **追加写 + 大小轮转**（当前文件 + 一个 `.1` 备份，各约 1MB），不做复杂日志框架，
//!   不引入外部依赖。
//! - **时间戳用纯 Rust 计算 UTC**（不引 chrono）：既是零依赖，也让格式化函数可单测。
//!   日志统一标注 UTC（后缀 Z），排查跨时区问题时不会歧义。
//! - 日志写入**绝不影响主流程**：任何 IO 失败都静默忽略（日志本身不能成为故障源）。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

/// 日志子目录名（挂在数据根下，随数据位置设置一起搬移）
const LOG_DIR: &str = "logs";

/// 当前日志文件名
const LOG_FILE: &str = "sticho.log";

/// 单个日志文件的大小上限：超过即轮转（1MB 足够容纳数千行）
const MAX_LOG_BYTES: u64 = 1024 * 1024;

/// 导出诊断时附带的日志尾部字节数（过大对用户/客服都是负担）
const TAIL_BYTES: u64 = 64 * 1024;

/// 日志文件绝对路径（顺带确保目录存在）。
pub fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::commands::config::data_root(app)?.join(LOG_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建日志目录：{e}"))?;
    Ok(dir.join(LOG_FILE))
}

/// 写一条日志。失败一律吞掉——日志系统自身不能拖垮应用。
pub fn log(app: &AppHandle, level: &str, message: &str) {
    let Ok(path) = log_path(app) else {
        return;
    };
    let _ = append_to(&path, level, message, now_secs(), MAX_LOG_BYTES);
}

/// 当前时刻的 UTC 时间戳串（`YYYY-MM-DD HH:MM:SSZ`），供诊断报告复用。
pub fn now_stamp() -> String {
    format_timestamp(now_secs())
}

/// 当前 Unix 秒（历史版本文件名等需要与日志同源的时间）
pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `YYYYMMDD-HHMMSS`（UTC），用作本地版本历史的快照文件名（可字典序排序）。
pub fn compact_stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// 把一条记录追加到指定日志文件（供单测直接调用，隔离 AppHandle）。
fn append_to(
    path: &Path,
    level: &str,
    message: &str,
    secs: u64,
    max_bytes: u64,
) -> std::io::Result<()> {
    rotate_if_needed(path, max_bytes)?;
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "[{}] [{}] {}", format_timestamp(secs), level, message)
}

/// 超过上限时把当前日志改名为 `<name>.1`（覆盖旧的 `.1`），保证最多两份文件。
fn rotate_if_needed(path: &Path, max_bytes: u64) -> std::io::Result<()> {
    let len = match fs::metadata(path) {
        Ok(m) => m.len(),
        Err(_) => return Ok(()), // 文件还不存在，无需轮转
    };
    if len < max_bytes {
        return Ok(());
    }
    let rotated = rotated_path(path);
    let _ = fs::remove_file(&rotated);
    fs::rename(path, &rotated)
}

/// `sticho.log` → `sticho.log.1`
fn rotated_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".1");
    PathBuf::from(s)
}

/// 读取日志尾部（含轮转备份的尾部），供「导出诊断信息」使用。
pub fn read_tail(app: &AppHandle) -> String {
    let Ok(path) = log_path(app) else {
        return String::new();
    };
    let mut out = String::new();
    let rotated = rotated_path(&path);
    if let Some(part) = read_tail_of(&rotated, TAIL_BYTES) {
        out.push_str(&part);
    }
    if let Some(part) = read_tail_of(&path, TAIL_BYTES) {
        out.push_str(&part);
    }
    out
}

/// 读取单个文件的末尾若干字节（按行界对齐会让首行残缺，诊断场景可接受）。
fn read_tail_of(path: &Path, max_bytes: u64) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let start = bytes.len().saturating_sub(max_bytes as usize);
    Some(String::from_utf8_lossy(&bytes[start..]).into_owned())
}

/// 安装 panic 钩子：`panic = "abort"` 下钩子仍会在 abort 前执行，
/// 因此崩溃原因能落进日志（这是本模块相对默认行为的关键收益）。
pub fn install_panic_hook(app: AppHandle) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log(&app, "PANIC", &info.to_string());
        previous(info);
    }));
}

// ---------------------------------------------------------------- 时间格式化

/// Unix 秒 → `YYYY-MM-DD HH:MM:SSZ`（UTC）。
fn format_timestamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// 「以 1970-01-01 为第 0 天」的天数 → (年, 月, 日)。
///
/// Howard Hinnant 的 civil_from_days 算法：把 3 月当作一年的起点处理闰日，
/// 全程整数运算、无分支表查表，是公历换算的经典写法。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as i64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]，0 = 三月
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 时间戳格式化对齐已知时刻() {
        // 0 秒 = 1970-01-01 00:00:00Z；1700000000 = 2023-11-14 22:13:20Z
        assert_eq!(format_timestamp(0), "1970-01-01 00:00:00Z");
        assert_eq!(format_timestamp(1_700_000_000), "2023-11-14 22:13:20Z");
    }

    #[test]
    fn 闰年二月末尾处理正确() {
        // 2024-02-29 00:00:00Z
        assert_eq!(format_timestamp(1_709_164_800), "2024-02-29 00:00:00Z");
        // 2024-03-01 00:00:00Z
        assert_eq!(format_timestamp(1_709_251_200), "2024-03-01 00:00:00Z");
    }

    #[test]
    fn 轮转超过上限才发生() {
        let dir = std::env::temp_dir().join(format!("sticho-log-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sticho.log");

        append_to(&path, "INFO", "一", 0, 64).unwrap();
        assert!(path.exists());
        assert!(!rotated_path(&path).exists(), "未到上限不应轮转");

        // 继续写到超过 64 字节上限，触发一次轮转
        for _ in 0..10 {
            append_to(&path, "INFO", "填充填充填充", 0, 64).unwrap();
        }
        assert!(rotated_path(&path).exists(), "超过上限应生成 .1 备份");

        let _ = fs::remove_dir_all(&dir);
    }
}