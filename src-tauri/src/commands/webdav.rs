//! WebDAV 云同步与多版本文档管理
//!
//! 设计要点：
//! - 所有网络 I/O、路径映射、版本号计算都在 Rust 侧完成，前端只负责配置与展示。
//! - 复用既有依赖：ureq（rustls + webpki-roots）发 HTTP，base64 构造 Basic Auth。
//!   **不引入新依赖**。
//! - 命令参数一律用单段小写词（url / user / password / root / local / keep / path / remote / n）：
//!   Tauri v2 默认把 Rust 参数名按 camelCase 暴露给 JS，多词参数名两边容易对不上
//!   （与 commands/recovery.rs 的既有约定一致）。
//!
//! 已知限制：rustls 走 webpki-roots，**无法验证自签名 / 私有 CA 证书**，
//! 因此 https 仅支持公网 CA 签发的证书；内网自建服务请用 http 地址。

use std::io::Read;
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;

/// 单次请求超时。连接超时另设更短的值，避免地址写错时干等。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// 下载 / PROPFIND 响应的读取上限（防止异常响应把内存吃满）
const MAX_RESPONSE_BYTES: u64 = 64 * 1024 * 1024;

/// 版本目录名（放在远端根目录下的隐藏目录里）
const VERSION_DIR: &str = ".mdstudio-versions";

/// 版本目录标识的最大长度（远端文件名长度限制不一，留足余量）
const MAX_DOC_ID_LEN: usize = 90;

/// 冲突判定容差（秒）：远端 size 相同、modified 相差不超过此值，视为「就是自己刚传的那份」。
///
/// WebDAV 服务器写入后回填的 Last-Modified 与本地记录可能有 1 秒级抖动，
/// 不给容差会把「自己刚上传的文件」误判成冲突，白白多出冲突副本。
const CONFLICT_TOLERANCE_SECS: u64 = 2;

/// PROPFIND 请求体：只取列目录需要的 4 个属性
const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
  </d:prop>
</d:propfind>"#;

// ---------------------------------------------------------------- 数据结构

/// 上传结果（`webdav_upload` 的返回值）。
///
/// 由 `String` 扩为结构体：前端不仅要展示短文案，还要据 `status` 决定是否提示冲突、
/// 据 `size`/`modified` 回填同步索引（下次上传据此判定远端是否被别人改过）。
#[derive(Serialize, Clone)]
pub struct UploadResult {
    /// `ok` = 正常上传；`conflict` = 检测到冲突并另存了副本
    pub status: String,
    /// 实际写入的远端路径；冲突时是冲突副本路径
    pub remote: String,
    /// 上传后远端文件字节数
    pub size: u64,
    /// 上传后远端 Last-Modified（Unix 秒；无法解析为 0）
    pub modified: u64,
    /// 可直接展示给用户的短文案
    pub message: String,
}

/// 云端目录项（供前端浏览）
#[derive(Serialize, Clone)]
pub struct WebdavEntry {
    /// 条目名（不含路径）
    pub name: String,
    /// 远端路径（相对 base，含根前缀，未做百分号编码）
    pub path: String,
    pub is_dir: bool,
    /// 字节数；目录为 0
    pub size: u64,
}

/// 历史版本项
#[derive(Serialize, Clone)]
pub struct VersionEntry {
    pub n: u32,
    /// 版本文件的远端路径，可直接交给 `webdav_download`
    pub path: String,
    pub size: u64,
    /// Unix 秒；服务器没给可解析的 Last-Modified 时为 0
    pub saved_at: u64,
}

// ---------------------------------------------------------------- 纯函数

/// URL 路径段百分号编码：只放过 `[A-Za-z0-9._-]`，其余按 UTF-8 逐字节 `%XX`。
///
/// 自写而不引入 percent-encoding：规则就这么点，省一个依赖。
fn encode_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for b in seg.as_bytes() {
        let c = *b as char;
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
            out.push(c);
        } else {
            out.push('%');
            out.push_str(&format!("{b:02X}"));
        }
    }
    out
}

/// 百分号解码。编码不合法时原样保留，不报错（宁可路径怪一点也别整个列表失败）。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 还原 XML 实体（`&amp;` 必须最后替换）
fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// 极简 XML 局部名查找：返回所有局部名等于 `local` 的元素内容（忽略命名空间前缀与大小写）。
///
/// `lower` 必须是 `xml` 的 ASCII 小写副本（逐字节等长、下标一一对应）：查找在小写副本上
/// 做，**返回值仍切自 `xml` 原文**——href 这类内容对大小写敏感，不能被顺手小写掉。
/// 拆成参数是为了让同一段内容按多个名字查找时只需小写一次。
fn find_elements_in<'a>(xml: &'a str, lower: &str, local: &str) -> Vec<&'a str> {
    let bytes = lower.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }
        // 跳过闭合标签、XML 声明、注释
        if matches!(bytes.get(i + 1), Some(b'/') | Some(b'?') | Some(b'!')) {
            i += 1;
            continue;
        }
        let Some(gt_rel) = lower[i..].find('>') else { break };
        let gt = i + gt_rel;
        let raw_tag = &lower[i + 1..gt];
        let name = raw_tag.split_whitespace().next().unwrap_or("");
        if name.is_empty() {
            i = gt + 1;
            continue;
        }
        let self_closing = raw_tag.ends_with('/');
        let bare = name.trim_end_matches('/');
        let local_name = bare.rsplit(':').next().unwrap_or(bare);
        if local_name != local {
            i = gt + 1;
            continue;
        }
        if self_closing {
            out.push("");
            i = gt + 1;
            continue;
        }
        let close_prefixed = format!("</{bare}>");
        let close_plain = format!("</{local_name}>");
        let after = &lower[gt + 1..];
        let (rel, len) = if let Some(p) = after.find(&close_prefixed) {
            (p, close_prefixed.len())
        } else if let Some(p) = after.find(&close_plain) {
            (p, close_plain.len())
        } else {
            break; // 没有闭合标签，剩下的都不完整了
        };
        out.push(&xml[gt + 1..gt + 1 + rel]);
        i = gt + 1 + rel + len;
    }
    out
}

/// [`find_elements_in`] 的便捷入口：自行把 `xml` 小写一份。
///
/// multistatus 的结构非常固定，不值得为此引入 XML 解析库。嵌套同名元素不在 WebDAV
/// 响应里出现，因此不处理嵌套配对。
fn find_elements<'a>(xml: &'a str, local: &str) -> Vec<&'a str> {
    find_elements_in(xml, &xml.to_ascii_lowercase(), local)
}

/// 取 URL 的路径部分：`http://h:8080/dav/x` → `/dav/x`。
///
/// 服务器返回的 href 是「服务器绝对路径」，带着 base 自身的路径前缀，
/// 解析时必须先减掉它才能得到相对 base 的远端路径。
fn url_path(url: &str) -> String {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    match rest.find('/') {
        Some(i) => rest[i..].to_string(),
        None => "/".to_string(),
    }
}

/// base + 远端路径 → 完整 URL（逐段做百分号编码）。
fn join_url(base: &str, path: &str) -> String {
    let mut url = base.trim_end_matches('/').to_string();
    for seg in path.split('/').filter(|s| !s.is_empty()) {
        url.push('/');
        url.push_str(&encode_segment(seg));
    }
    url
}

/// Windows 本地绝对路径 → 路径段列表。
///
/// 处理：`\\?\` 长路径前缀、UNC 前缀、反斜杠换正斜杠、盘符 `D:` 去掉冒号取 `D`。
fn local_segments(local: &str) -> Vec<String> {
    let mut s = local.replace('\\', "/");
    if let Some(rest) = s.strip_prefix("//?/") {
        s = rest.to_string();
    } else if let Some(rest) = s.strip_prefix("//./") {
        s = rest.to_string();
    }
    let mut segs: Vec<String> = s
        .split('/')
        .filter(|seg| !seg.is_empty())
        .map(|seg| seg.to_string())
        .collect();
    // 盘符：首段形如 "D:" → "D"
    if let Some(first) = segs.first_mut() {
        let is_drive = first.len() == 2
            && first.ends_with(':')
            && first.chars().next().is_some_and(|c| c.is_ascii_alphabetic());
        if is_drive {
            first.pop();
        }
    }
    segs
}

/// 文档的远端路径（相对 base，含根前缀，**未编码**）。
pub fn remote_path(root: &str, local: &str) -> String {
    let mut out = String::new();
    for seg in root.split('/').filter(|s| !s.is_empty()) {
        out.push('/');
        out.push_str(seg);
    }
    for seg in local_segments(local) {
        out.push('/');
        out.push_str(&seg);
    }
    if out.is_empty() {
        out.push('/');
    }
    out
}

/// 文件名里的扩展名（含点号）。没有合法扩展名时返回空串。
fn ext_of(remote: &str) -> String {
    let name = remote.rsplit('/').next().unwrap_or("");
    match name.rsplit_once('.') {
        Some((stem, ext))
            if !stem.is_empty()
                && !ext.is_empty()
                && ext.len() <= 8
                && ext.chars().all(|c| c.is_ascii_alphanumeric()) =>
        {
            format!(".{ext}")
        }
        _ => String::new(),
    }
}

/// FNV-1a 32 位。仅用于给版本目录标识消歧，不需要密码学强度。
fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for b in s.as_bytes() {
        h ^= *b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// 文档在版本目录里的标识。
///
/// 用「相对远端路径 `/` → `__`」再净化，末尾附 8 位哈希：
/// 净化与截断都可能让两个不同文档撞名，撞名会让两份文档共用一份版本历史，必须避免。
pub fn doc_id(root: &str, remote: &str) -> String {
    let prefix = root.trim_matches('/');
    let rel = remote.trim_matches('/');
    let rel = rel.strip_prefix(prefix).unwrap_or(rel);
    let rel = rel.trim_start_matches('/');
    let mut safe: String = rel
        .replace('/', "__")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.len() > MAX_DOC_ID_LEN {
        safe.truncate(MAX_DOC_ID_LEN);
    }
    format!("{safe}-{:08x}", fnv1a(rel))
}

/// 版本文件所在目录的远端路径（不含尾部斜杠）
fn version_dir_path(root: &str, remote: &str) -> String {
    format!(
        "/{}/{VERSION_DIR}/{}",
        root.trim_matches('/'),
        doc_id(root, remote)
    )
}

/// 单个版本文件的远端路径
fn version_file_path(root: &str, remote: &str, n: u32) -> String {
    format!(
        "{}/v{n}{}",
        version_dir_path(root, remote),
        ext_of(remote)
    )
}

/// 从版本文件名解析版本号：`v3.md` → 3。不匹配返回 None。
fn version_number_of(name: &str) -> Option<u32> {
    let rest = name.strip_prefix('v')?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u32>().ok()
}

/// 计算下一个版本号，以及为满足上限需要删除的旧版本号。
///
/// 追加式推进（不做重命名），换取请求数与原子性：
/// 新版本号 = 现有最大号 + 1；写完后若总数超过 `keep`，从最小号开始删。
/// `keep == 0` 表示不记录版本，返回 `(0, [])`。
pub fn next_version(existing: &[u32], keep: u32) -> (u32, Vec<u32>) {
    if keep == 0 {
        return (0, Vec::new());
    }
    let mut all: Vec<u32> = existing.to_vec();
    let next = all.iter().copied().max().unwrap_or(0) + 1;
    all.push(next);
    all.sort_unstable();
    let excess = all.len().saturating_sub(keep as usize);
    (next, all.into_iter().take(excess).collect())
}

// ---------------------------------------------------------------- 冲突判定

/// 文件名里不允许出现的字符（Windows 侧限制）一律换成 `_`。
fn sanitize_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "未命名".to_string()
    } else {
        trimmed.to_string()
    }
}

/// `YYYYMMDD-HHMMSS`（日志模块的紧凑戳）→ `YYYY-MM-DD HHmmss`（冲突副本文件名用）。
fn conflict_stamp(secs: u64) -> String {
    let compact = crate::logging::compact_stamp(secs);
    if compact.len() == 15 {
        format!(
            "{}-{}-{} {}",
            &compact[0..4],
            &compact[4..6],
            &compact[6..8],
            &compact[9..15]
        )
    } else {
        compact
    }
}

/// 冲突副本的远端路径：同目录下 `name (冲突副本 YYYY-MM-DD HHmmss).ext`。
fn conflict_remote_path(remote: &str, secs: u64) -> String {
    let (dir, name) = match remote.rsplit_once('/') {
        Some((d, n)) => (d.to_string(), n.to_string()),
        None => (String::new(), remote.to_string()),
    };
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.clone(), String::new()),
    };
    format!(
        "{dir}/{} (冲突副本 {}){ext}",
        sanitize_component(&stem),
        conflict_stamp(secs)
    )
}

/// 是否判定为「冲突」。`remote` = 远端当前 (size, modified)；`prev` = 上次同步记录。
///
/// 判据（防误判，宁可少判也不误判）：
/// - 远端没有该文件 → 不算冲突（正常新建 / 覆盖）
/// - 没有上次记录 → 首次同步，直接覆盖并回填，不算冲突
/// - size 相同且 modified 相差 ≤ 容差 → 就是自己刚传的那份，正常覆盖
/// - 其余 → 冲突（远端被别的设备改过）
fn is_conflict(remote: Option<(u64, u64)>, prev: Option<(u64, u64)>) -> bool {
    match (remote, prev) {
        (None, _) => false,
        (Some(_), None) => false,
        (Some((rs, rm)), Some((ps, pm))) => {
            !(rs == ps && rm.abs_diff(pm) <= CONFLICT_TOLERANCE_SECS)
        }
    }
}

// ---------------------------------------------------------------- HTTP 日期

/// 公历日期 → 距 1970-01-01 的天数（Howard Hinnant 的 days_from_civil）
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// 解析 HTTP 日期（RFC 1123：`Wed, 08 Oct 2026 03:12:00 GMT`）为 Unix 秒。
///
/// 解析不出来返回 None——版本列表里那一项就不显示时间，不影响功能。
fn parse_http_date(s: &str) -> Option<u64> {
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() < 5 {
        return None;
    }
    // "Wed," "08" "Oct" "2026" "03:12:00" "GMT"（星期一段可能缺失，故按长度对齐）
    let (day, month, year, time) = if parts[0].ends_with(',') {
        if parts.len() < 5 {
            return None;
        }
        (parts[1], parts[2], parts[3], parts[4])
    } else {
        (parts[0], parts[1], parts[2], parts[3])
    };
    let d: i64 = day.parse().ok()?;
    let y: i64 = year.parse().ok()?;
    let m: i64 = match month {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => return None,
    };
    let mut hms = time.split(':');
    let h: i64 = hms.next()?.parse().ok()?;
    let mi: i64 = hms.next()?.parse().ok()?;
    let sec: i64 = hms.next()?.parse().ok()?;
    let days = days_from_civil(y, m, d);
    Some((days * 86400 + h * 3600 + mi * 60 + sec).max(0) as u64)
}

// ---------------------------------------------------------------- HTTP 封装

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(REQUEST_TIMEOUT)
        .timeout_connect(CONNECT_TIMEOUT)
        .build()
}

/// Basic Auth 头；用户名为空时不加（部分服务器允许匿名）。
fn auth_header(user: &str, password: &str) -> Option<String> {
    if user.is_empty() {
        return None;
    }
    let raw = format!("{user}:{password}");
    Some(format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(raw.as_bytes())
    ))
}

fn request(
    agent: &ureq::Agent,
    method: &str,
    url: &str,
    user: &str,
    password: &str,
) -> ureq::Request {
    let req = agent.request(method, url);
    match auth_header(user, password) {
        Some(h) => req.set("Authorization", &h),
        None => req,
    }
}

/// 把 ureq 的错误翻译成能直接给用户看的中文。
fn map_err(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, _) => match code {
            401 | 403 => "凭据错误，请检查用户名与密码".to_string(),
            404 => "远端路径不存在（404）".to_string(),
            405 => "该地址不支持 WebDAV（405）".to_string(),
            409 => "远端父目录不存在（409）".to_string(),
            507 => "远端存储空间不足（507）".to_string(),
            _ => format!("服务器返回 {code}"),
        },
        ureq::Error::Transport(t) => {
            format!("网络不可达或证书校验失败：{t}")
        }
    }
}

/// PROPFIND 的失败原因。
///
/// 需要区分「HTTP 状态码」与「其它失败」：状态码要按码给不同提示
/// （列目录时 404 表示「还没有」而不是「出错」），读响应失败则只有一种处理。
enum DavError {
    Status(u16),
    Other(String),
}

impl From<ureq::Error> for DavError {
    fn from(e: ureq::Error) -> Self {
        match e {
            ureq::Error::Status(code, _) => DavError::Status(code),
            ureq::Error::Transport(t) => DavError::Other(format!("网络不可达或证书校验失败：{t}")),
        }
    }
}

impl DavError {
    fn message(self) -> String {
        match self {
            DavError::Status(code) => match code {
                401 | 403 => "凭据错误，请检查用户名与密码".to_string(),
                404 => "远端路径不存在（404）".to_string(),
                405 => "该地址不支持 WebDAV（405）".to_string(),
                409 => "远端父目录不存在（409）".to_string(),
                507 => "远端存储空间不足（507）".to_string(),
                _ => format!("服务器返回 {code}"),
            },
            DavError::Other(msg) => msg,
        }
    }
}

/// 按扩展名猜 Content-Type（WebDAV 服务器基本不看，但传对了更规范）
fn content_type_of(path: &str) -> &'static str {
    match ext_of(path).as_str() {
        ".md" | ".markdown" => "text/markdown; charset=utf-8",
        ".html" | ".htm" => "text/html; charset=utf-8",
        ".txt" | ".log" => "text/plain; charset=utf-8",
        ".json" | ".js" | ".ts" | ".css" | ".py" | ".bat" | ".sh" | ".xml" | ".yml" | ".yaml" => {
            "text/plain; charset=utf-8"
        }
        _ => "application/octet-stream",
    }
}

/// 读取响应正文，超过上限直接报错。
///
/// 旧实现用 `.take(MAX)` 会在上限处**静默截断**，调用方再把半截内容当正文返回，
/// 造成「下载到损坏文件却毫无提示」。这里多读 1 字节以判定是否溢出。
fn read_all(resp: ureq::Response) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    resp.into_reader()
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取响应失败：{e}"))?;
    if buf.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(format!(
            "云端文件超过 {} MB 上限，已中止（避免内存占用过高）",
            MAX_RESPONSE_BYTES / (1024 * 1024)
        ));
    }
    Ok(buf)
}

fn propfind(
    agent: &ureq::Agent,
    url: &str,
    user: &str,
    password: &str,
    depth: &str,
) -> Result<String, DavError> {
    let resp = request(agent, "PROPFIND", url, user, password)
        .set("Depth", depth)
        .set("Content-Type", "application/xml; charset=utf-8")
        .send_string(PROPFIND_BODY)?;
    // 与下载走同一个带上限的读取，避免异常服务器返回超大 multistatus 时内存失控
    let bytes = read_all(resp).map_err(DavError::Other)?;
    String::from_utf8(bytes)
        .map_err(|_| DavError::Other("服务器返回的目录信息不是 UTF-8".to_string()))
}

/// 创建一个集合（目录）。已存在（405/409）视为成功——建目录是幂等操作。
fn mkcol(agent: &ureq::Agent, url: &str, user: &str, password: &str) -> Result<(), ureq::Error> {
    match request(agent, "MKCOL", url, user, password).call() {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(405, _)) | Err(ureq::Error::Status(409, _)) => Ok(()),
        Err(e) => Err(e),
    }
}

/// 逐级创建远端路径里的所有目录（最后一段视作文件名，不建）。
fn ensure_dirs(
    agent: &ureq::Agent,
    base: &str,
    user: &str,
    password: &str,
    remote: &str,
) -> Result<(), ureq::Error> {
    let segs: Vec<&str> = remote.split('/').filter(|s| !s.is_empty()).collect();
    if segs.len() <= 1 {
        return Ok(());
    }
    let mut acc = String::new();
    for seg in &segs[..segs.len() - 1] {
        acc.push('/');
        acc.push_str(seg);
        mkcol(agent, &join_url(base, &acc), user, password)?;
    }
    Ok(())
}

fn put_bytes(
    agent: &ureq::Agent,
    url: &str,
    user: &str,
    password: &str,
    body: &[u8],
    content_type: &str,
) -> Result<(), ureq::Error> {
    request(agent, "PUT", url, user, password)
        .set("Content-Type", content_type)
        .send_bytes(body)
        .map(|_| ())
}

/// 仅当目标不存在时写入（`If-None-Match: *`）。
///
/// 返回 `false` 表示目标已存在（服务器回 412），用于版本号并发防撞。
fn put_bytes_create_only(
    agent: &ureq::Agent,
    url: &str,
    user: &str,
    password: &str,
    body: &[u8],
    content_type: &str,
) -> Result<bool, ureq::Error> {
    match request(agent, "PUT", url, user, password)
        .set("Content-Type", content_type)
        .set("If-None-Match", "*")
        .send_bytes(body)
    {
        Ok(_) => Ok(true),
        Err(ureq::Error::Status(412, _)) => Ok(false),
        Err(e) => Err(e),
    }
}

/// 目录项（列目录与列版本共用的中间结构）
struct ChildEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

/// PROPFIND Depth:1 列目录。
///
/// `remote` 是相对 base 的远端路径；返回的每一项 path 同样是相对 base 的远端路径，
/// 可直接拿去做下一次请求。
fn propfind_children(
    agent: &ureq::Agent,
    base: &str,
    user: &str,
    password: &str,
    remote: &str,
) -> Result<Vec<ChildEntry>, DavError> {
    let req_url = join_url(base, remote);
    // 请求 URL 是编码过的，而 href 在 parse_children 里会被解码后再比较，
    // 两边必须都落到「解码后的路径」，否则中文目录名永远匹配不上。
    let prefix = percent_decode(&url_path(&req_url));
    let xml = propfind(agent, &req_url, user, password, "1")?;
    Ok(parse_children(&xml, &prefix, remote))
}

/// 从 multistatus 响应里解析出直属子项。纯函数，便于单测。
fn parse_children(xml: &str, request_path: &str, remote: &str) -> Vec<ChildEntry> {
    let mut out = Vec::new();
    let dir = remote.trim_end_matches('/');
    for resp in find_elements(xml, "response") {
        // 一条 response 里要按 4 个不同的名字查找，统一小写一次，避免重复整段转换
        let resp_lower = resp.to_ascii_lowercase();
        let refs = find_elements_in(resp, &resp_lower, "href");
        let Some(href) = refs.first() else {
            continue;
        };
        let decoded = percent_decode(&unescape(href));
        let full = decoded.trim_end_matches('/');
        let Some(rest) = full.strip_prefix(request_path.trim_end_matches('/')) else {
            continue;
        };
        let name = rest.trim_start_matches('/');
        // 空 = 目录自身；含 / = 更深层级（Depth:1 理论上不会出现）
        if name.is_empty() || name.contains('/') {
            continue;
        }
        out.push(ChildEntry {
            name: name.to_string(),
            path: format!("{dir}/{name}"),
            is_dir: !find_elements_in(resp, &resp_lower, "collection").is_empty(),
            size: find_elements_in(resp, &resp_lower, "getcontentlength")
                .first()
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0),
            modified: find_elements_in(resp, &resp_lower, "getlastmodified")
                .first()
                .and_then(|s| parse_http_date(&unescape(s)))
                .unwrap_or(0),
        });
    }
    out
}

/// 从 PROPFIND Depth:0 的响应里读出目标自身的 (是否目录, 字节数, 修改时间)。
///
/// Depth:0 只回一条 response（就是目标本身），故取首条即可。
fn parse_self_props(xml: &str) -> (bool, u64, u64) {
    let Some(resp) = find_elements(xml, "response").into_iter().next() else {
        return (false, 0, 0);
    };
    let lower = resp.to_ascii_lowercase();
    let is_dir = !find_elements_in(resp, &lower, "collection").is_empty();
    let size = find_elements_in(resp, &lower, "getcontentlength")
        .first()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    let modified = find_elements_in(resp, &lower, "getlastmodified")
        .first()
        .and_then(|s| parse_http_date(&unescape(s)))
        .unwrap_or(0);
    (is_dir, size, modified)
}

/// 探测远端某个文件的当前状态；不存在返回 `Ok(None)`。
fn stat_remote(
    agent: &ureq::Agent,
    base: &str,
    user: &str,
    password: &str,
    remote: &str,
) -> Result<Option<(u64, u64)>, String> {
    let target = join_url(base, remote);
    match propfind(agent, &target, user, password, "0") {
        Ok(xml) => {
            let (_is_dir, size, modified) = parse_self_props(&xml);
            Ok(Some((size, modified)))
        }
        Err(DavError::Status(404)) => Ok(None),
        Err(e) => Err(e.message()),
    }
}

/// 列出某文档已有的版本号（升序去重）。版本目录不存在时返回空表。
fn list_versions(
    agent: &ureq::Agent,
    base: &str,
    user: &str,
    password: &str,
    root: &str,
    remote: &str,
) -> Result<Vec<u32>, String> {
    let dir = version_dir_path(root, remote);
    let children = match propfind_children(agent, base, user, password, &dir) {
        Ok(c) => c,
        Err(DavError::Status(404)) => return Ok(Vec::new()),
        Err(e) => return Err(e.message()),
    };
    let mut nums: Vec<u32> = children
        .iter()
        .filter(|c| !c.is_dir)
        .filter_map(|c| version_number_of(&c.name))
        .collect();
    nums.sort_unstable();
    nums.dedup();
    Ok(nums)
}

// ---------------------------------------------------------------- 命令

/// 测试连接：对配置的根目录发一次 PROPFIND。
///
/// 返回值是可直接展示的中文结论；只有返回 Ok 前端才允许打开同步开关。
#[tauri::command]
pub async fn webdav_test(
    url: String,
    user: String,
    password: String,
    root: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = agent();
        let target = join_url(&url, &root);
        let result = request(&agent, "PROPFIND", &target, &user, &password)
            .set("Depth", "0")
            .set("Content-Type", "application/xml; charset=utf-8")
            .send_string(PROPFIND_BODY)
            .map_err(DavError::from);
        match result {
            Ok(_) => Ok("连接成功（支持 WebDAV）".to_string()),
            // 根目录还没建不算失败：上传时 ensure_dirs 会自动创建
            Err(DavError::Status(404)) => Ok("远端根目录不存在，将在上传时自动创建".to_string()),
            Err(e) => Err(e.message()),
        }
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

/// 上传单个文档。`keep > 0` 时顺带记一份历史版本。
///
/// `local` 是本地绝对路径；Rust 侧直接读刚落盘的字节，保证上传内容与本地完全一致
/// （也顺带避开前端编码转换的差异）。
///
/// 冲突处理：上传前先 `PROPFIND` 探测远端当前状态，与前端传来的上次同步记录
/// （`prev_size` / `prev_modified`）比对。判定冲突且 `policy != "overwrite"` 时，
/// 不覆盖原文件，而是另存为同目录的冲突副本——**绝不丢数据**。
#[tauri::command]
pub async fn webdav_upload(
    url: String,
    user: String,
    password: String,
    root: String,
    local: String,
    keep: u32,
    policy: String,
    prev_size: Option<u64>,
    prev_modified: Option<u64>,
) -> Result<UploadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&local).map_err(|e| format!("读取本地文件失败：{e}"))?;
        let remote = remote_path(&root, &local);
        let agent = agent();
        let content_type = content_type_of(&remote);

        ensure_dirs(&agent, &url, &user, &password, &remote).map_err(map_err)?;

        // 冲突探测：远端当前状态 vs 上次同步记录
        let current = stat_remote(&agent, &url, &user, &password, &remote)?;
        let prev = match (prev_size, prev_modified) {
            (Some(s), Some(m)) => Some((s, m)),
            _ => None,
        };
        let conflict = is_conflict(current, prev);
        let make_copy = conflict && policy != "overwrite";
        let target = if make_copy {
            conflict_remote_path(&remote, crate::logging::now_secs())
        } else {
            remote.clone()
        };

        // 冲突副本与原文件同目录，父目录已由 ensure_dirs 建好
        put_bytes(
            &agent,
            &join_url(&url, &target),
            &user,
            &password,
            &bytes,
            content_type,
        )
        .map_err(map_err)?;

        // 版本留档记在「真正写入的那个远端路径」上，历史才不会串到别的文件
        let mut version_label: Option<u32> = None;
        if keep > 0 {
            // 版本目录要先建出来，否则 PUT 会因为父目录不存在而 409
            let vdir = version_dir_path(&root, &target);
            mkcol(&agent, &join_url(&url, &vdir), &user, &password).map_err(map_err)?;

            // 版本号是「先查后写」：并发上传（多设备同时同步）时会算出同一个号并互相覆盖。
            // 用 If-None-Match:* 条件写，撞号（412）就重查一次再试，最多 3 轮。
            for attempt in 0..3 {
                let existing = list_versions(&agent, &url, &user, &password, &root, &target)?;
                let (next, outdated) = next_version(&existing, keep);
                if next == 0 {
                    break;
                }
                let created = put_bytes_create_only(
                    &agent,
                    &join_url(&url, &version_file_path(&root, &target, next)),
                    &user,
                    &password,
                    &bytes,
                    content_type,
                )
                .map_err(map_err)?;
                if !created {
                    if attempt == 2 {
                        return Err("云端版本号冲突（可能有其他设备正在同步），请稍后重试".to_string());
                    }
                    continue; // 被抢先，重查版本号
                }
                // 清理超限的旧版本：失败不影响本次同步的结果
                for n in outdated {
                    let _ = request(
                        &agent,
                        "DELETE",
                        &join_url(&url, &version_file_path(&root, &target, n)),
                        &user,
                        &password,
                    )
                    .call();
                }
                version_label = Some(next);
                break;
            }
        }

        // 回读上传后的远端状态，供前端回填同步索引（下次据此判定远端是否被动过）
        let (size, modified) = stat_remote(&agent, &url, &user, &password, &target)?
            .unwrap_or((bytes.len() as u64, 0));

        let message = if make_copy {
            let name = target.rsplit('/').next().unwrap_or(target.as_str());
            format!("云端文件已被其他设备修改，已另存为冲突副本：{name}")
        } else {
            match version_label {
                Some(n) => format!("已上传（版本 v{n}）"),
                None => "已上传".to_string(),
            }
        };

        Ok(UploadResult {
            status: if make_copy { "conflict" } else { "ok" }.to_string(),
            remote: target,
            size,
            modified,
            message,
        })
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

/// 列出远端某个目录下的内容（`path` 为相对 base 的远端路径）
#[tauri::command]
pub async fn webdav_list(
    url: String,
    user: String,
    password: String,
    path: String,
) -> Result<Vec<WebdavEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = agent();
        let children = propfind_children(&agent, &url, &user, &password, &path)
            .map_err(DavError::message)?;
        let mut list: Vec<WebdavEntry> = children
            .into_iter()
            .map(|c| WebdavEntry {
                name: c.name,
                path: c.path,
                is_dir: c.is_dir,
                size: c.size,
            })
            .collect();
        // 目录在前，同类按名字不区分大小写排序
        list.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(list)
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

/// 读取远端文件正文（按 UTF-8 解析；非 UTF-8 直接报错，不做有损解码）
#[tauri::command]
pub async fn webdav_download(
    url: String,
    user: String,
    password: String,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = agent();
        let resp = request(&agent, "GET", &join_url(&url, &path), &user, &password)
            .call()
            .map_err(map_err)?;
        let bytes = read_all(resp)?;
        String::from_utf8(bytes).map_err(|_| "云端文件不是 UTF-8 编码，暂不支持下载".to_string())
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

/// 列出某文档的历史版本（按版本号降序）。
///
/// `remote` 是文档的远端路径：云端浏览里点某文件时就有这个路径，
/// 不必再让前端复述一遍「本地路径 → 远端路径」的映射规则。
#[tauri::command]
pub async fn webdav_versions(
    url: String,
    user: String,
    password: String,
    root: String,
    remote: String,
) -> Result<Vec<VersionEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = agent();
        let dir = version_dir_path(&root, &remote);
        let children = match propfind_children(&agent, &url, &user, &password, &dir) {
            Ok(c) => c,
            Err(DavError::Status(404)) => return Ok(Vec::new()),
            Err(e) => return Err(e.message()),
        };
        let mut list: Vec<VersionEntry> = children
            .into_iter()
            .filter(|c| !c.is_dir)
            .filter_map(|c| {
                let n = version_number_of(&c.name)?;
                Some(VersionEntry {
                    n,
                    path: c.path,
                    size: c.size,
                    saved_at: c.modified,
                })
            })
            .collect();
        list.sort_by_key(|v| std::cmp::Reverse(v.n));
        Ok(list)
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

/// 取回某个历史版本的正文
#[tauri::command]
pub async fn webdav_fetch_version(
    url: String,
    user: String,
    password: String,
    root: String,
    remote: String,
    n: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = agent();
        let target = join_url(&url, &version_file_path(&root, &remote, n));
        let resp = request(&agent, "GET", &target, &user, &password)
            .call()
            .map_err(map_err)?;
        let bytes = read_all(resp)?;
        String::from_utf8(bytes).map_err(|_| "云端文件不是 UTF-8 编码，暂不支持下载".to_string())
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

/// 删除某个历史版本（版本面板里的「删除该版本」）
#[tauri::command]
pub async fn webdav_delete_version(
    url: String,
    user: String,
    password: String,
    root: String,
    remote: String,
    n: u32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = agent();
        let target = join_url(&url, &version_file_path(&root, &remote, n));
        request(&agent, "DELETE", &target, &user, &password)
            .call()
            .map_err(map_err)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("任务调度失败：{e}"))?
}

// ---------------------------------------------------------------- 测试

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_segment_escapes_non_ascii_and_spaces() {
        assert_eq!(encode_segment("note.md"), "note.md");
        assert_eq!(encode_segment("a b"), "a%20b");
        assert_eq!(encode_segment("100%"), "100%25");
        assert_eq!(encode_segment("中文"), "%E4%B8%AD%E6%96%87");
        assert_eq!(encode_segment("a+b"), "a%2Bb");
    }

    #[test]
    fn percent_decode_roundtrip() {
        assert_eq!(percent_decode("%E4%B8%AD%E6%96%87"), "中文");
        assert_eq!(percent_decode("a%20b"), "a b");
        // 非法编码原样保留
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%ZZ"), "%ZZ");
    }

    #[test]
    fn remote_path_maps_windows_paths() {
        assert_eq!(remote_path("/MDStudio", "D:\\TraeProject\\note.md"), "/MDStudio/D/TraeProject/note.md");
        assert_eq!(remote_path("/MDStudio", "\\\\?\\D:\\a\\b.md"), "/MDStudio/D/a/b.md");
        assert_eq!(remote_path("MDStudio/", "D:\\a\\b.md"), "/MDStudio/D/a/b.md");
        // 盘符大小写保留
        assert_eq!(remote_path("/r", "c:\\x.md"), "/r/c/x.md");
    }

    #[test]
    fn remote_path_keeps_unc_prefix() {
        assert_eq!(remote_path("/r", "\\\\server\\share\\x.md"), "/r/server/share/x.md");
    }

    #[test]
    fn url_helpers() {
        assert_eq!(join_url("http://h:8080/dav/", "/MDStudio/a b.md"), "http://h:8080/dav/MDStudio/a%20b.md");
        assert_eq!(join_url("http://h", "/"), "http://h");
        assert_eq!(url_path("http://h:8080/dav/x"), "/dav/x");
        assert_eq!(url_path("http://h"), "/");
    }

    #[test]
    fn ext_and_version_number() {
        assert_eq!(ext_of("/a/note.md"), ".md");
        assert_eq!(ext_of("/a/README"), "");
        assert_eq!(ext_of("/a/archive.tar.gz"), ".gz");
        assert_eq!(version_number_of("v1.md"), Some(1));
        assert_eq!(version_number_of("v10"), Some(10));
        assert_eq!(version_number_of("v"), None);
        assert_eq!(version_number_of("videos.md"), None);
    }

    #[test]
    fn doc_id_is_stable_and_disambiguated() {
        let a = doc_id("/MDStudio", "/MDStudio/D/a/note.md");
        assert_eq!(a, doc_id("/MDStudio", "/MDStudio/D/a/note.md"));
        // 净化后同形的两个路径不能撞名
        assert_ne!(doc_id("/r", "/r/a/b.md"), doc_id("/r", "/r/a_b.md"));
        // 不含非法字符
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')));
    }

    #[test]
    fn next_version_appends_and_trims() {
        assert_eq!(next_version(&[], 3), (1, vec![]));
        assert_eq!(next_version(&[1], 3), (2, vec![]));
        assert_eq!(next_version(&[1, 2], 3), (3, vec![]));
        // 恰好到上限：写入后总数等于 keep，不删
        assert_eq!(next_version(&[1, 2, 3], 3), (4, vec![1]));
        // 有空洞时以最大值为准推进
        assert_eq!(next_version(&[1, 5], 3), (6, vec![]));
        assert_eq!(next_version(&[1, 5, 6], 2), (7, vec![1, 5]));
        // keep = 0 表示不记录
        assert_eq!(next_version(&[1, 2], 0), (0, vec![]));
    }

    #[test]
    fn parse_http_date_works() {
        // 2026-10-08T03:12:00Z
        assert_eq!(parse_http_date("Thu, 08 Oct 2026 03:12:00 GMT"), Some(1791429120));
        assert_eq!(parse_http_date("Thu, 01 Jan 1970 00:00:00 GMT"), Some(0));
        assert_eq!(parse_http_date("垃圾数据"), None);
    }

    #[test]
    fn parse_children_reads_multistatus() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/MDStudio/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/MDStudio/sub/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/MDStudio/%E4%B8%AD%E6%96%87.md</d:href>
    <d:propstat><d:prop>
      <d:resourcetype/>
      <d:getcontentlength>42</d:getcontentlength>
      <d:getlastmodified>Thu, 08 Oct 2026 03:12:00 GMT</d:getlastmodified>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>"#;
        let items = parse_children(xml, "/dav/MDStudio", "/MDStudio");
        // 目录自身被排除
        assert_eq!(items.len(), 2);
        let sub = &items[0];
        assert_eq!(sub.name, "sub");
        assert!(sub.is_dir);
        assert_eq!(sub.path, "/MDStudio/sub");
        let file = &items[1];
        assert_eq!(file.name, "中文.md");
        assert!(!file.is_dir);
        assert_eq!(file.path, "/MDStudio/中文.md");
        assert_eq!(file.size, 42);
        assert_eq!(file.modified, 1791429120);
    }

    #[test]
    fn parse_children_handles_base_with_path_prefix() {
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response>
          <d:href>/dav/root/x.txt</d:href>
          <d:propstat><d:prop><d:getcontentlength>1</d:getcontentlength></d:prop></d:propstat>
        </d:response></d:multistatus>"#;
        let items = parse_children(xml, "/dav/root", "/root");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].path, "/root/x.txt");
        assert_eq!(items[0].size, 1);
    }

    #[test]
    fn unescape_entities() {
        assert_eq!(unescape("a&amp;b"), "a&b");
        assert_eq!(unescape("&lt;tag&gt;"), "<tag>");
        // &amp; 必须最后替换，不能把 &amp;lt; 变成 <
        assert_eq!(unescape("&amp;lt;"), "&lt;");
    }

    #[test]
    fn auth_header_skips_empty_user() {
        assert!(auth_header("", "x").is_none());
        assert_eq!(auth_header("u", "p").unwrap(), "Basic dTpw");
    }

    #[test]
    fn parse_self_props_reads_single_response() {
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response>
          <d:href>/dav/root/a.md</d:href>
          <d:propstat><d:prop>
            <d:resourcetype/>
            <d:getcontentlength>1234</d:getcontentlength>
            <d:getlastmodified>Thu, 08 Oct 2026 03:12:00 GMT</d:getlastmodified>
          </d:prop></d:propstat>
        </d:response></d:multistatus>"#;
        let (is_dir, size, modified) = parse_self_props(xml);
        assert!(!is_dir);
        assert_eq!(size, 1234);
        assert_eq!(modified, 1791429120);

        // 目录：resourcetype 里含 collection
        let dir_xml = r#"<d:multistatus xmlns:d="DAV:"><d:response>
          <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
        </d:response></d:multistatus>"#;
        assert!(parse_self_props(dir_xml).0);
    }

    #[test]
    fn conflict_rule_matches_spec() {
        // 远端没有该文件 → 不冲突
        assert!(!is_conflict(None, None));
        assert!(!is_conflict(None, Some((10, 100))));
        // 首次同步（无上次记录）→ 直接覆盖，不判冲突
        assert!(!is_conflict(Some((10, 100)), None));
        // size 相同且 modified 差 ≤ 2s → 视为自己刚传的
        assert!(!is_conflict(Some((10, 100)), Some((10, 101))));
        assert!(!is_conflict(Some((10, 100)), Some((10, 98))));
        // 超过容差 → 冲突
        assert!(is_conflict(Some((10, 200)), Some((10, 100))));
        // size 不同 → 冲突
        assert!(is_conflict(Some((11, 100)), Some((10, 100))));
    }

    #[test]
    fn conflict_path_is_sibling_with_stamp() {
        // 2026-10-12 14:30:25 UTC
        let secs = 1_791_815_425;
        assert_eq!(
            conflict_remote_path("/Sticho/D/a/note.md", secs),
            "/Sticho/D/a/note (冲突副本 2026-10-12 143025).md"
        );
        // 无扩展名
        assert_eq!(
            conflict_remote_path("/r/README", secs),
            "/r/README (冲突副本 2026-10-12 143025)"
        );
        // 文件名里的非法字符被净化
        assert_eq!(
            conflict_remote_path("/r/a:b*c.md", secs),
            "/r/a_b_c (冲突副本 2026-10-12 143025).md"
        );
    }
}