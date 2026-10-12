/**
 * Rust 命令调用封装 —— 统一类型与错误出口
 */
import { invoke } from "@tauri-apps/api/core";

/** 文本文件内容 + 实际使用的编码 id（阶段 11） */
export type TextFile = {
  content: string;
  encoding: string;
};

/**
 * 读取文本文件。
 * encoding 省略时由 Rust 侧自动检测（BOM → UTF-16 启发式 → chardetng 嗅探）；
 * 给定编码 id 时按该编码解码（「编码」菜单的手动切换）。
 */
export function readTextFile(path: string, encoding?: string): Promise<TextFile> {
  return invoke<TextFile>("read_text_file", { path, encoding: encoding ?? null });
}

/** 按指定编码写入文本文件（原子写：临时文件 + rename） */
export function writeTextFile(path: string, content: string, encoding: string): Promise<void> {
  return invoke<void>("write_text_file", { path, content, encoding });
}

/** 写入二进制文件（.docx 等导出产物，base64 传输） */
export function writeFileBase64(path: string, data: string): Promise<void> {
  return invoke<void>("write_file_base64", { path, data });
}

/** 读取 PDF 原始字节（base64 返回，50MB 上限与魔数校验在 Rust 侧完成） */
export function readPdfBase64(path: string): Promise<string> {
  return invoke<string>("read_pdf_base64", { path });
}

/** 读取图片原始字节（base64 返回，20MB 上限在 Rust 侧完成；Word 导出嵌入图片用） */
export function readImageBase64(path: string): Promise<string> {
  return invoke<string>("read_image_base64", { path });
}

/**
 * 把 base64 图片写进文档同级 assets 目录，返回写入文件的绝对路径（批次三）。
 *
 * data 为不含 `data:*;base64,` 前缀的纯 base64；扩展名由 Rust 侧按魔数决定。
 */
export function saveImageAsset(path: string, name: string, data: string): Promise<string> {
  return invoke<string>("save_image_asset", { path, name, data });
}

/**
 * 导出为 Pandoc 支持的格式（批次八）：
 * kind = "latex"（.tex）/ "epub"（.epub）；content 为 Markdown 正文；
 * base 为源文档所在目录（解析正文里的相对路径图片），未保存文档传 null。
 */
export function exportPandoc(
  path: string,
  content: string,
  kind: "latex" | "epub",
  base: string | null,
): Promise<void> {
  return invoke<void>("export_pandoc", { path, content, kind, base });
}

/** 自定义 CSS 主题（批次八）：themes 目录下的一份 .css */
export type ThemeFile = {
  name: string;
  css: string;
};

/** 列出主题目录（%APPDATA%/<identifier>/themes）下的全部 .css，按文件名排序 */
export function loadThemes(): Promise<ThemeFile[]> {
  return invoke<ThemeFile[]>("load_themes");
}

/** 在资源管理器中打开主题目录，返回其绝对路径 */
export function openThemeDir(): Promise<string> {
  return invoke<string>("open_theme_dir");
}

/** 目录项（阶段 11：侧边栏文件目录树） */
export type DirEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

/** 列出目录内容（不递归，展开子目录时再调用） */
export function listDir(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", { path });
}

/**
 * 跨文件搜索命中（字段与 lib/fileSearch.ts 的 SearchHit 一致：line 1 起、column 0 起字符下标）
 */
export type SearchHit = {
  path: string;
  line: number;
  column: number;
  text: string;
};

/** 跨文件搜索结果：hits 为命中列表，files 为实际扫描的文件数，truncated 表示因达到上限被截断 */
export type SearchResult = {
  hits: SearchHit[];
  files: number;
  truncated: boolean;
};

/**
 * 在 root 目录内做跨文件全文搜索（字面量匹配，Rust 侧遍历，跳过 node_modules/.git 等）。
 * maxHits 为命中上限，传 0 用后端默认值。
 */
export function searchFiles(
  root: string,
  query: string,
  caseSensitive: boolean,
  maxHits: number,
): Promise<SearchResult> {
  return invoke<SearchResult>("search_files", { root, query, caseSensitive, maxHits });
}

/** 启动参数中待打开的文件（文件关联后双击文档由资源管理器传入），无则返回 null */
export function getStartupFile(): Promise<string | null> {
  return invoke<string | null>("get_startup_file");
}

/** 查询扩展名是否已关联到本程序（ext 不含点号：md / html / txt） */
export function getFileAssociation(ext: string): Promise<boolean> {
  return invoke<boolean>("get_file_association", { ext });
}

/** 打开 / 关闭扩展名的文件关联（写 HKCU\Software\Classes，无需管理员权限） */
export function setFileAssociation(ext: string, enable: boolean): Promise<void> {
  return invoke<void>("set_file_association", { ext, enable });
}

/** 可关联的扩展名（设置面板按 group 分块展示） */
export type AssocExt = {
  /** 扩展名（不含点号，小写） */
  ext: string;
  /** 分组：doc / web / text / config / code / script */
  group: string;
};

/** 关联清单：全部可关联扩展名 + 「替代系统记事本」覆盖的扩展名 */
export type FileAssocInfo = {
  exts: AssocExt[];
  notepad_exts: string[];
};

/** 拉取可关联扩展名清单（白名单在 Rust 侧维护，前后端不重复） */
export function fileAssocInfo(): Promise<FileAssocInfo> {
  return invoke<FileAssocInfo>("file_assoc_info");
}

/** 查询是否已注册「用本软件打开」右键菜单项（作用于所有文件） */
export function getContextMenu(): Promise<boolean> {
  return invoke<boolean>("get_context_menu");
}

/** 打开 / 关闭「用本软件打开」右键菜单项 */
export function setContextMenu(enable: boolean): Promise<void> {
  return invoke<void>("set_context_menu", { enable });
}

/** 打开系统「默认应用」设置页（把记事本改成本软件的最终确认交给系统界面） */
export function openDefaultAppsSettings(): Promise<void> {
  return invoke<void>("open_default_apps_settings");
}

// ---- 恢复草稿（批次四：自动保存与崩溃恢复）----

/** 草稿元信息（正文不在列表里，避免把大文档整体读进内存） */
export type RecoveryMeta = {
  id: string;
  /** 原文件绝对路径；未命名文档为 null */
  path: string | null;
  title: string;
  kind: string;
  encoding: string;
  /** Unix 秒 */
  saved_at: number;
  chars: number;
};

/** 落一份恢复草稿（Rust 侧原子写，id 只允许 [A-Za-z0-9._-]） */
export function writeRecovery(payload: {
  id: string;
  path: string | null;
  title: string;
  kind: string;
  encoding: string;
  content: string;
}): Promise<void> {
  return invoke<void>("write_recovery", payload);
}

/** 列出全部草稿元信息，按 saved_at 降序 */
export function listRecovery(): Promise<RecoveryMeta[]> {
  return invoke<RecoveryMeta[]>("list_recovery");
}

/** 读取一份草稿正文；文件不存在返回 null */
export function readRecovery(id: string): Promise<string | null> {
  return invoke<string | null>("read_recovery", { id });
}

/** 删除一份草稿（幂等：文件不存在也算成功） */
export function deleteRecovery(id: string): Promise<void> {
  return invoke<void>("delete_recovery", { id });
}

// ---- WebDAV 云同步与多版本（批次九）----

/**
 * WebDAV 连接参数。四个字段对应设置面板里那一组输入；
 * 服务地址是 `https://host/dav` 这样的 base，根目录是 base 下的相对路径（如 /Sticho）。
 */
export type DavConfig = {
  url: string;
  user: string;
  password: string;
  root: string;
};

/** 云端目录项 */
export type WebdavEntry = {
  name: string;
  /** 相对 base 的远端路径（含根前缀），可直接用于 download / list */
  path: string;
  is_dir: boolean;
  /** 字节数；目录为 0 */
  size: number;
};

/** 历史版本项 */
export type VersionEntry = {
  n: number;
  /** 版本文件的远端路径 */
  path: string;
  size: number;
  /** Unix 秒；服务器没给可解析的 Last-Modified 时为 0 */
  saved_at: number;
};

/** 上传结果：`conflict` 表示检测到云端被别的设备改过、已另存冲突副本 */
export type UploadResult = {
  status: "ok" | "conflict";
  /** 实际写入的远端路径（冲突时是副本路径） */
  remote: string;
  /** 上传后远端字节数 */
  size: number;
  /** 上传后远端 Last-Modified（Unix 秒） */
  modified: number;
  /** 可直接展示的短文案 */
  message: string;
};

/**
 * 测试连接。成功时 resolve 出可直接展示的中文结论文案（如「连接成功（支持 WebDAV）」），
 * 失败时 reject 出中文原因（凭据错误 / 网络不可达 / 该地址不支持 WebDAV…）。
 */
export function webdavTest(cfg: DavConfig): Promise<string> {
  return invoke<string>("webdav_test", cfg);
}

/**
 * 上传单个本地文档。`keep > 0` 时顺带记一份历史版本。
 * 正文由 Rust 侧直接读刚落盘的本地文件，保证与磁盘内容一致。
 *
 * `policy` 决定云端被别的设备改过时怎么办：`copy` 另存冲突副本（默认，绝不丢数据）、
 * `overwrite` 直接覆盖。`prev` 是上次上传后记录的远端状态（用于冲突判定），首次上传传 `null`。
 */
export function webdavUpload(
  cfg: DavConfig,
  local: string,
  keep: number,
  policy: "copy" | "overwrite",
  prev: { size: number; modified: number } | null,
): Promise<UploadResult> {
  return invoke<UploadResult>("webdav_upload", {
    ...cfg,
    local,
    keep,
    policy,
    prevSize: prev ? prev.size : null,
    prevModified: prev ? prev.modified : null,
  });
}

/** 列出远端某目录下的内容（path 为相对 base 的远端路径） */
export function webdavList(cfg: Omit<DavConfig, "root">, path: string): Promise<WebdavEntry[]> {
  return invoke<WebdavEntry[]>("webdav_list", { ...cfg, path });
}

/** 读取远端文件正文（按 UTF-8 解析；非 UTF-8 会以错误驳回） */
export function webdavDownload(cfg: Omit<DavConfig, "root">, path: string): Promise<string> {
  return invoke<string>("webdav_download", { ...cfg, path });
}

/** 列出某文档的历史版本（按版本号降序）。remote 为文档的远端路径。 */
export function webdavVersions(
  cfg: DavConfig,
  remote: string,
): Promise<VersionEntry[]> {
  return invoke<VersionEntry[]>("webdav_versions", { ...cfg, remote });
}

/** 取回某个历史版本的正文 */
export function webdavFetchVersion(cfg: DavConfig, remote: string, n: number): Promise<string> {
  return invoke<string>("webdav_fetch_version", { ...cfg, remote, n });
}

/** 删除某个历史版本 */
export function webdavDeleteVersion(cfg: DavConfig, remote: string, n: number): Promise<void> {
  return invoke<void>("webdav_delete_version", { ...cfg, remote, n });
}

/**
 * 保存 WebDAV 密码。Rust 侧用 Windows DPAPI 加密后写入 secrets.json，明文不再落 settings.json。
 * 传空串表示清除已保存的密码。
 */
export function saveDavPassword(password: string): Promise<void> {
  return invoke<void>("save_dav_password", { password });
}

/** 读取 WebDAV 密码明文；未配置或解密失败（换用户/换机器）返回 null */
export function loadDavPassword(): Promise<string | null> {
  return invoke<string | null>("load_dav_password");
}

// ---- 配置数据保存位置（批次十）----

/** 数据位置模式：系统目录 / 指定目录 / 当前程序目录 */
export type DataLocationMode = "user" | "portable" | "custom";

/** settings.json 的绝对路径（plugin-store 据此定位） */
export function getSettingsPath(): Promise<string> {
  return invoke<string>("get_settings_path");
}

/** 当前生效的位置模式 */
export function getDataLocation(): Promise<DataLocationMode> {
  return invoke<DataLocationMode>("get_data_location");
}

/** 当前数据根目录的绝对路径（供界面只读展示） */
export function getDataRoot(): Promise<string> {
  return invoke<string>("get_data_root");
}

/**
 * 预检目标位置是否可读写，成功时 resolve 出该位置的数据根目录绝对路径。
 *
 * 失败（无权限 / 只读盘 / 被安全软件保护）会 reject 出中文原因；
 * 预检不落任何文件、不改引导文件，前端据此提示并回退。
 */
export function checkDataLocation(
  mode: DataLocationMode,
  path?: string | null,
): Promise<string> {
  return invoke<string>("check_data_location", { mode, path: path ?? null });
}

/** 切换数据位置的结果 */
export type SetLocationResult = {
  /** 新的数据根目录绝对路径 */
  root: string;
  /** 是否实际执行了迁移 */
  migrated: boolean;
  /** 迁移是否完整（未迁移时恒为 true） */
  complete: boolean;
  /** 旧数据是否已清理 */
  cleaned: boolean;
  /** 迁移 / 清理过程中的告警 */
  warnings: string[];
};

/**
 * 切换数据保存位置，resolve 出结构化结果（含新根目录）。
 * `mode === "custom"` 时必须给出 `path`（绝对路径）。
 * `migrate` 为 true 时把旧位置数据复制到新位置并在完整迁移后清理旧目录。
 * 目标不可读写时 reject 出中文原因（不落任何文件、不改设置）。
 */
export function setDataLocation(
  mode: DataLocationMode,
  path: string | null,
  migrate: boolean,
): Promise<SetLocationResult> {
  return invoke<SetLocationResult>("set_data_location", { mode, path, migrate });
}

/** 立即重启应用（新的配置位置需要重启才完全生效） */
export function restartApp(): Promise<void> {
  return invoke<void>("restart_app");
}

/**
 * 用系统默认浏览器打开 http/https 链接。
 *
 * 外链不能直接在 WebView 里开（会把应用本身导航走），必须交给系统浏览器；
 * Rust 侧只放行 http/https。
 */
export function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}

// ---- 本地版本历史（文件菜单 →「文件历史」）----

/** 本地历史版本条目 */
export type HistoryEntry = {
  /** 快照文件名（回读 / 恢复时作为标识） */
  file: string;
  /** 快照时间（Unix 秒，取自文件修改时间） */
  saved_at: number;
  /** 字节数 */
  size: number;
};

/** 列出某文档的本地历史版本（按时间降序） */
export function listHistory(path: string): Promise<HistoryEntry[]> {
  return invoke<HistoryEntry[]>("list_history", { path });
}

/** 读取某个历史版本的正文 */
export function readHistory(path: string, file: string): Promise<string> {
  return invoke<string>("read_history", { path, file });
}

/** 恢复某个历史版本：返回正文，并先把当前磁盘内容留档（保证「恢复」可撤销） */
export function restoreHistory(path: string, file: string): Promise<string> {
  return invoke<string>("restore_history", { path, file });
}

// ---- 恢复中心：全局列出所有文档的本地历史版本 ----

/** 某个文档的历史版本分组 */
export type HistoryDoc = {
  /** 原文档绝对路径 */
  path: string;
  /** 文档名 */
  name: string;
  /** 该文档的历史版本（按时间降序） */
  entries: HistoryEntry[];
};

/** 列出全部文档的本地历史版本，按最近有改动排序（恢复中心用） */
export function listAllHistory(): Promise<HistoryDoc[]> {
  return invoke<HistoryDoc[]>("list_all_history");
}

/** 删除某个历史版本（幂等：文件本就不存在也算成功） */
export function deleteHistory(path: string, file: string): Promise<void> {
  return invoke<void>("delete_history", { path, file });
}

// ---- 诊断（帮助菜单 →「导出诊断信息」）----

/** 记录一条前端日志（showError 等关键事件同步落盘，便于事后排查） */
export function logEvent(level: string, message: string): Promise<void> {
  return invoke<void>("log_event", { level, message });
}

/** 生成诊断报告并写入指定路径（路径由 save 对话框给出） */
export function exportDiagnostics(path: string): Promise<void> {
  return invoke<void>("export_diagnostics", { path });
}
