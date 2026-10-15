/**
 * 图片地址解析（Word 导出嵌入图片用）
 *
 * Markdown 里的 `<img src>` 有四类来源：data URI、远端 URL、本地绝对路径、
 * 相对当前文档目录的路径。导出 docx 时只有本地路径需要读盘；远端 URL 一律
 * 不联网（涉密环境定位），由调用方回落到占位文字。
 */

/** 图片来源分类 */
export type ImageSourceKind =
  /** data:URI，字节已内联在文档里 */
  | "data"
  /** http(s) 或协议相对地址，导出时不联网取图 */
  | "remote"
  /** 本地绝对路径（盘符 / UNC / file://） */
  | "absolute"
  /** 相对当前文档目录的路径 */
  | "relative"
  /** 空值或无法识别 */
  | "invalid";

/** 带盘符的绝对路径（C:\ 或 C:/） */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** 分类 src；无法识别或空值时返回 "invalid" */
export function classifyImageSrc(src: string | null | undefined): ImageSourceKind {
  const value = (src ?? "").trim();
  if (value === "") return "invalid";
  if (/^data:/i.test(value)) return "data";
  if (/^(https?:)?\/\//i.test(value)) return "remote";
  if (/^file:\/\//i.test(value)) {
    // file:///C:/a.png → 去掉协议后是标准绝对路径；file://host/share 一律当绝对路径
    return "absolute";
  }
  if (DRIVE_PATH.test(value) || /^\\\\/.test(value)) return "absolute";
  // 前导斜杠在 Markdown 里通常是"站点根"，桌面端按相对当前文档目录处理更符合预期
  return "relative";
}

/** 去掉 file:// 前缀，得到本机可用的路径 */
function stripFileScheme(src: string): string {
  const m = /^file:\/\/([^/]*)(\/.*)?$/i.exec(src);
  if (m) {
    const host = m[1] ?? "";
    const rest = m[2] ?? "";
    // file://host/share → \\host\share（UNC 共享路径）
    if (host !== "") return `\\\\${host}${rest.replace(/\//g, "\\")}`;
    // file:///C:/x → C:/x（空主机即本机绝对路径）
    return rest.replace(/^\/([A-Za-z]:)/, "$1");
  }
  return src.replace(/^file:\/+/i, "");
}

/**
 * 只裁 ASCII 空白（空格 / 制表 / 换行 / 换页）。
 *
 * 不能用 `trim()`：它按 JS 空白语义连 U+3000（全角空格）与 U+00A0（不换行空格）一起吃掉，
 * 而这两个字符在 Windows 上是**合法文件名字符**，URL 层（markdown-it 的百分号编码、
 * decodeURIComponent）也不会替你裁掉。裁掉之后拿到的路径与磁盘上的文件对不上，
 * 图片会静默回落成占位文字（`![x](图.png　)` 这种名字尾部带全角空格的图就是如此）。
 */
function trimAsciiSpace(text: string): string {
  return text.replace(/^[\t\r\n\f ]+/, "").replace(/[\t\r\n\f ]+$/, "");
}

/**
 * 把 src 解析成本机绝对路径；相对路径必须给出 baseDir（当前文档所在目录）。
 *
 * 不校验文件是否存在。相对路径里的 `..` 段一律拒收：文档可能来自 WebDAV 等不可信来源，
 * 不能让它把读取位置带出当前文档目录；绝对路径按用户显式给出的位置原样交给 Rust 侧 fs::read。
 */
export function resolveLocalImagePath(src: string, baseDir: string | null): string | null {
  const kind = classifyImageSrc(src);
  const value = trimAsciiSpace(src);

  if (kind === "absolute") {
    return stripFileScheme(value).replace(/\//g, "\\");
  }
  if (kind === "relative") {
    if (!baseDir) return null;
    const rel = value
      .replace(/^(?:\.\/|\.\\)+/, "") // 去掉 ./ 前缀，避免路径里留下多余的 ".\"
      .replace(/^[\\/]+/, "")
      .replace(/\//g, "\\");
    // 命中 `..` 即放弃嵌入，由调用方回落到占位文字
    if (rel.split("\\").some((seg) => seg === "..")) return null;
    const base = baseDir.replace(/[\\/]+$/, "");
    return `${base}\\${rel}`;
  }
  return null;
}

/** data URI 解码结果 */
export type DataUriPayload = {
  mime: string;
  bytes: Uint8Array;
};

/**
 * 解码 data URI。
 *
 * 支持 base64 与 URL 编码两种写法（后者是 SVG data URI 的常见形态）；
 * 其它情况返回 null，由调用方回落占位文字。
 */
export function decodeDataUri(src: string): DataUriPayload | null {
  const match = /^data:([^;,]*)((?:;[^,]*)*),(.*)$/s.exec(src.trim());
  if (!match) return null;

  const mime = match[1]!.trim() || "application/octet-stream";
  const meta = match[2] ?? "";
  const payload = match[3] ?? "";

  try {
    if (/;base64/i.test(meta)) {
      const binary = atob(payload.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { mime, bytes };
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  } catch {
    return null;
  }
}