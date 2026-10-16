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
 * 把某文档所在目录（含子目录）放行给 asset 协议（批次「安全加固」）。
 *
 * 静态 scope 已收窄为空，打开 / 另存文档时必须先调用它，正文里的本地相对
 * 路径图片才能经 asset 协议加载。目录为空串时后端直接返回成功。
 */
export function allowAssetDir(dir: string): Promise<void> {
  return invoke<void>("allow_asset_dir", { dir });
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

/** 语言包（批次十二）：locales/*.json 的解析结果；entries 为「英文原文 → 译文」 */
export type LocalePack = {
  id: string;
  label: string;
  entries: Record<string, string>;
};

/** 字体包（批次十二）：fonts/ 下的一个字体文件 */
export type FontPack = {
  /** 文件名主干，同时用作 @font-face 的 family 名 */
  name: string;
  /** 字体文件绝对路径（前端经 convertFileSrc 转成 asset URL） */
  path: string;
};

/** 待释放的默认包文件 */
export type DefaultPackFile = {
  dir: "locales" | "themes" | "fonts";
  name: string;
  content: string;
  /**
   * 自带语言包的版本（= 软件主体版本号）：文件已存在但其中 `_version` 低于该值时覆盖重写；
   * 省略则「已存在即跳过」，绝不覆盖用户改动（主题 / 字体 / 说明文件即走这条）。
   */
  version?: string;
};

/** 释放默认包文件（不存在则写入；带 version 的内置包在版本更旧时覆盖），返回实际写入的文件名 */
export function ensurePacks(files: DefaultPackFile[]): Promise<string[]> {
  return invoke<string[]>("ensure_packs", { files });
}

/** 列出 locales/ 下的语言包（按 id 排序） */
export function loadLocales(): Promise<LocalePack[]> {
  return invoke<LocalePack[]>("load_locales");
}

/** 列出 fonts/ 下的字体文件（同时把该目录放行给 asset 协议） */
export function loadFonts(): Promise<FontPack[]> {
  return invoke<FontPack[]>("load_fonts");
}

/** 在资源管理器中打开某个包目录（locales | themes | fonts），返回其绝对路径 */
export function openPackDir(kind: "locales" | "themes" | "fonts"): Promise<string> {
  return invoke<string>("open_pack_dir", { kind });
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

/** 在资源管理器中定位并选中某个文件（标签右键「打开文件位置」） */
export function revealFile(path: string): Promise<void> {
  return invoke<void>("reveal_in_explorer", { path });
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

/**
 * 打开 / 关闭「用本软件打开」右键菜单项。
 * `locale` 为 Sticho 当前界面语言，仅在操作系统语言取不到时用于决定菜单文案的中/英。
 */
export function setContextMenu(enable: boolean, locale: string): Promise<void> {
  return invoke<void>("set_context_menu", { enable, locale });
}

/** 打开系统「默认应用」设置页（把记事本改成本软件的最终确认交给系统界面） */
export function openDefaultAppsSettings(): Promise<void> {
  return invoke<void>("open_default_apps_settings");
}

/**
 * 清理对系统的全部写入：撤销所有扩展名关联、删除右键菜单项，使程序恢复便携状态。
 * 返回未能清理干净的项目（如个别注册表键删除失败）；为空数组即已完全恢复。
 */
export function clearSystemIntegration(): Promise<string[]> {
  return invoke<string[]>("clear_system_integration");
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
 * 上传单个本地文档。正文由 Rust 侧直接读刚落盘的本地文件，保证与磁盘内容一致。
 *
 * `policy` 决定云端被别的设备改过时怎么办：`copy` 另存冲突副本（默认，绝不丢数据）、
 * `overwrite` 直接覆盖。`prev` 是上次上传后记录的远端状态（用于冲突判定），首次上传传 `null`。
 */
export function webdavUpload(
  cfg: DavConfig,
  local: string,
  policy: "copy" | "overwrite",
  prev: { size: number; modified: number } | null,
): Promise<UploadResult> {
  return invoke<UploadResult>("webdav_upload", {
    ...cfg,
    local,
    policy,
    prevSize: prev ? prev.size : null,
    prevModified: prev ? prev.modified : null,
  });
}

/**
 * 把正文直接写到指定远端路径（云端文档「就地编辑」保存）。
 *
 * 与 `webdavUpload` 的区别：没有本地文件，`remote` 由前端给出（打开云端文档时记下的路径）。
 * `policy`/`prev` 语义与 `webdavUpload` 完全一致。
 */
export function webdavPut(
  cfg: DavConfig,
  remote: string,
  content: string,
  policy: "copy" | "overwrite",
  prev: { size: number; modified: number } | null,
): Promise<UploadResult> {
  return invoke<UploadResult>("webdav_put", {
    ...cfg,
    remote,
    content,
    policy,
    prevSize: prev ? prev.size : null,
    prevModified: prev ? prev.modified : null,
  });
}

/** 远端文件状态（云端变更检测用）：`exists` 为 false 时 size / modified 均为 0 */
export type RemoteStat = {
  exists: boolean;
  size: number;
  modified: number;
};

/**
 * 探测某个远端文件的当前状态（PROPFIND Depth:0）。
 * 与本机上次同步记录比对即可判断「云端是否被别的设备改过」。
 */
export function webdavStat(cfg: Omit<DavConfig, "root">, path: string): Promise<RemoteStat> {
  return invoke<RemoteStat>("webdav_stat", { ...cfg, path });
}

/** 列出远端某个目录下的内容（`path` 为相对 base 的远端路径） */
export function webdavList(cfg: Omit<DavConfig, "root">, path: string): Promise<WebdavEntry[]> {
  return invoke<WebdavEntry[]>("webdav_list", { ...cfg, path });
}

/** 读取远端文件正文（按 UTF-8 解析；非 UTF-8 会以错误驳回） */
export function webdavDownload(cfg: Omit<DavConfig, "root">, path: string): Promise<string> {
  return invoke<string>("webdav_download", { ...cfg, path });
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

// ---- 配置数据保存位置（批次十 / 位置自动探测）----

/** 数据位置模式：系统目录 / 当前程序目录（便携） */
export type DataLocationMode = "user" | "portable";

/** 启动时的配置位置状态："unset" 表示两处均未初始化，需引导用户选择 */
export type ConfigState = DataLocationMode | "unset";

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
 * 启动时探测配置位置状态。
 *
 * - "portable"：程序当前目录已有配置（便携运行，不写宿主）；
 * - "user"：系统目录已有配置；
 * - "unset"：两处均无配置 → 首次运行，前端应引导用户选择保存位置。
 */
export function getConfigState(): Promise<ConfigState> {
  return invoke<ConfigState>("get_config_state");
}

/**
 * 首次运行：写入用户选定的配置位置（位置标记 + 初始 settings.json）并立即生效。
 * 返回新数据根目录绝对路径；已初始化时 reject（防误改）。
 */
export function setupConfigLocation(mode: DataLocationMode): Promise<string> {
  return invoke<string>("setup_config_location", { mode });
}

/**
 * 预检目标位置是否可读写，成功时 resolve 出该位置的数据根目录绝对路径。
 *
 * 失败（无权限 / 只读盘 / 被安全软件保护）会 reject 出中文原因；
 * 预检不落任何文件、不改位置标记，前端据此提示并回退。
 */
export function checkDataLocation(mode: DataLocationMode): Promise<string> {
  return invoke<string>("check_data_location", { mode });
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
 * `migrate` 为 true 时把旧位置数据复制到新位置并在完整迁移后清理旧目录。
 * 目标不可读写时 reject 出中文原因（不落任何文件、不改设置）。
 */
export function setDataLocation(
  mode: DataLocationMode,
  migrate: boolean,
): Promise<SetLocationResult> {
  return invoke<SetLocationResult>("set_data_location", { mode, migrate });
}

/** 立即重启应用（新的配置位置需要重启才完全生效） */
export function restartApp(): Promise<void> {
  return invoke<void>("restart_app");
}

/**
 * 一键清理配置根目录下的**全部用户数据**（位置标记保留，位置选择不丢）。
 * 返回逐项删除的告警；内置包会在下次启动时自动重新释放。调用前应做两次确认。
 */
export function clearAllData(): Promise<string[]> {
  return invoke<string[]>("clear_all_data");
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

/** 历史版本正文 + 其原始编码 id（快照存的是原始字节，编码需一并同步给前端） */
export type HistoryContent = {
  content: string;
  /** 与后端 `decode_auto` 一致的编码 id（utf-8 / utf-8-bom / utf-16le / gbk …） */
  encoding: string;
};

/** 读取某个历史版本的正文（连同其原始编码） */
export function readHistory(path: string, file: string): Promise<HistoryContent> {
  return invoke<HistoryContent>("read_history", { path, file });
}

/** 恢复某个历史版本：返回正文与编码，并先把当前磁盘内容留档（保证「恢复」可撤销） */
export function restoreHistory(path: string, file: string): Promise<HistoryContent> {
  return invoke<HistoryContent>("restore_history", { path, file });
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

/**
 * 按设置里的三类上限（数量 / 容量 / 时长）全量裁剪本地历史版本，
 * 超限的从最老的开始删。设置一改动即调用，让「调小上限」立即释放空间。
 */
export function pruneHistory(): Promise<void> {
  return invoke<void>("prune_history");
}

// ---- 书签持久化（存到配置目录下的 bookmarks 文件夹）----

/**
 * 保存某文档的书签。`owner` 是文档身份（本地路径或未命名文档的草稿 id），
 * `data` 是前端序列化好的 JSON，后端原样写盘。
 */
export function bookmarksSave(owner: string, data: string): Promise<void> {
  return invoke<void>("bookmarks_save", { owner, data });
}

/** 读取某文档的书签；没有则返回 null */
export function bookmarksLoad(owner: string): Promise<string | null> {
  return invoke<string | null>("bookmarks_load", { owner });
}

/** 删除某文档的书签文件（清空全部书签时调用） */
export function bookmarksDelete(owner: string): Promise<void> {
  return invoke<void>("bookmarks_delete", { owner });
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
