/**
 * 界面多语言（批次八）
 *
 * 设计要点：**以中文原文为键**。
 * - `t("文件")` 在 zh-CN 下原样返回中文；
 * - 在 en-US 下查 EN 词表，查不到就回落到中文原文——
 *   任何还没进词表的字符串都不会变成空白或 key，转换过程中可随时增量补齐。
 * - 需要插值的地方写占位符：`t("共 {n} 个", { n: 3 })`。
 *
 * 用法（App.svelte）：
 * ```ts
 * let locale = $state<Locale>("zh-CN");
 * const t = $derived(makeT(locale));
 * ```
 * `LOCALES` 为设置面板里可选的语种清单。
 *
 * Vditor 自身的语言（`lang` 选项）用的是另一套命名（zh_CN / en_US），
 * 由 editor.ts 的 `setEditorLocale` 负责映射。
 */

export type Locale = "zh-CN" | "en-US";

/** 可选语种（设置面板「语言」区） */
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en-US", label: "English" },
];

export type Vars = Record<string, string | number>;

/** 语言 id → Vditor 的 lang 选项值 */
export function vditorLang(locale: Locale): "zh_CN" | "en_US" {
  return locale === "en-US" ? "en_US" : "zh_CN";
}

/**
 * en-US 词表：键为中文原文（与 t() 的入参完全一致）。
 * 未收录的键自动回落中文，不会显示成空串。
 *
 * 导出仅为让单测能整体断言「英文值不为空串」，界面逻辑一律走 makeT。
 */
export const EN: Record<string, string> = {
  // ---- 一级菜单 ----
  文件: "File",
  编辑: "Edit",
  段落: "Paragraph",
  格式: "Format",
  视图: "View",
  设置: "Settings",
  帮助: "Help",

  // ---- 设置面板 ----
  语言: "Language",
  主题: "Theme",
  "切换后立即生效；编辑器工具栏的气泡提示需重启程序才会更新。":
    "Takes effect immediately; the editor toolbar tooltips update after restarting the app.",
  外观: "Appearance",
  浅色: "Light",
  深色: "Dark",
  跟随系统: "System",
  默认: "Default",
  打开主题文件夹: "Open Themes Folder",
  "把任意 .css 放进主题文件夹，即可在此选用（叠加在当前明/暗档位之上）。":
    "Put any .css file in the themes folder to use it here (it layers on top of the current light/dark setting).",
  软件设置: "Settings",
  皮肤设置: "Skin Settings",
  通用: "General",
  其他: "Other",
  "自动保存恢复草稿（每 30 秒，异常退出后可在下次启动恢复）":
    "Auto-save recovery drafts (every 30s; recoverable on next launch after a crash)",

  // ---- 文件关联 ----
  文件关联: "File Associations",
  ".md（Markdown 文档）": ".md (Markdown document)",
  ".html（HTML 文档）": ".html (HTML document)",
  ".txt（纯文本文档）": ".txt (plain text document)",
  "关联仅对当前用户生效，无需管理员权限":
    "Associations apply to the current user only; no admin rights needed",
  "关联仅对当前用户生效，无需管理员权限。":
    "Associations apply to the current user only; no admin rights needed.",
  // 扩展名分组标题
  文档: "Documents",
  网页: "Web",
  配置: "Config",
  代码: "Code",
  脚本: "Script",
  // 记事本替代 / 右键菜单
  "替代系统记事本（txt / log / ini 等文本格式）":
    "Replace Notepad (text formats such as txt / log / ini)",
  "勾选即把记事本常见的文本格式关联到本软件。若双击后仍由记事本打开，请到系统「默认应用」里把对应格式改过来。":
    "Enabling this associates Notepad's usual text formats with this app. If they still open in Notepad, change them in the system's Default Apps.",
  "打开系统「默认应用」设置": "Open system Default Apps",
  系统集成: "System Integration",
  "全选所有": "Select All",
  "在文件右键菜单中加入「用 Sticho 打开」（所有文件）":
    "Add “Open with Sticho” to the file context menu (all files)",
  "设置右键菜单失败：": "Failed to set context menu: ",
  "打开系统设置失败：": "Failed to open system settings: ",

  // ---- 配置文件位置 ----
  系统目录: "System folder",
  指定目录: "Custom folder",
  当前程序目录: "Program Folder",
  "选择配置文件保存目录": "Choose Config Folder",
  "系统目录为推荐做法；当前程序目录便于随程序一起搬移；指定目录可放到任意位置（均需目录可读写）":
    "The system folder is recommended; the program folder travels with the app; a custom folder can be anywhere (all must be readable and writable).",
  "切换前会检测目标目录可读写，不可用则保持原配置；选择迁移会在完整复制后清理旧目录":
    "The target folder is checked for read/write access first; if unavailable the current config is kept. Choosing migrate cleans up the old folder after a complete copy.",
  "是否把现有配置数据迁移到新位置？选择「迁移」会把设置、恢复草稿、主题与 Pandoc 复制到新目录，并在完整迁移后清理旧目录。":
    "Migrate existing config data to the new location? Choosing \"Migrate\" copies settings, recovery drafts, themes and Pandoc to the new folder, then cleans up the old folder after a complete copy.",
  迁移: "Migrate",
  不迁移: "Don't Migrate",
  "已切换，但迁移不完整，原目录已保留为备份，重启后生效":
    "Switched, but the migration was incomplete — the original folder was kept as a backup. Takes effect after restart",
  "目标目录不可用，已保持原配置：": "The target folder is unavailable; the previous config was kept: ",
  "切换失败：": "Switch failed: ",
  "WebDAV 同步": "WebDAV Sync",
  "配置位置已更新，需重启后生效。是否现在重启？":
    "The config location was updated and takes effect after a restart. Restart now?",
  "重启后新的配置位置才会生效。是否现在重启？":
    "The new config location only takes effect after a restart. Restart now?",
  "有 {n} 个文档尚未保存，是否保存后再重启？":
    "{n} document(s) have unsaved changes. Save before restarting?",
  保存并重启: "Save and Restart",
  "不保存，直接重启": "Restart Without Saving",
  "重启失败：": "Restart failed: ",
  稍后: "Later",

  // ---- 对话框通用 ----
  "取消": "Cancel",
  "保存": "Save",
  "不保存": "Don't Save",
  "继续": "Continue",
  "退出": "Exit",
  "下载": "Download",
  "恢复": "Restore",
  "丢弃": "Discard",
  "关闭": "Close",
  "关闭（Esc）": "Close (Esc)",
  "关闭标签": "Close Tab",
  "关闭标签页": "Close Tab",
  "关闭其他标签": "Close Other Tabs",
  "关闭其他标签页": "Close Other Tabs",
  "全部保存": "Save All",
  "另有 {n} 个标签有未保存的修改，关闭其他标签将丢弃这些修改。":
    "{n} other tab(s) have unsaved changes that will be discarded. Continue?",
  "转为 Markdown": "Convert to Markdown",
  "重新加载": "Reload",
  "保留我的": "Keep Mine",
  "另存为…": "Save As…",
  文件已在外部更改: "File Changed Externally",
  未命名: "Untitled",
  未命名文档: "Untitled document",
  未知: "Unknown",
  尚未保存到磁盘: "Not saved to disk yet",
  未保存到磁盘: "Not saved to disk",
  "「{name}」有未保存的修改。": "“{name}” has unsaved changes.",
  "文件已在外部被修改，而当前文档有未保存的改动。重新加载会丢弃这些改动。":
    "The file was modified externally and this document has unsaved changes. Reloading will discard them.",
  "按新编码重新读取磁盘文件会丢弃当前未保存的修改。是否继续？":
    "Re-reading the file from disk with the new encoding will discard current unsaved changes. Continue?",
  "有 {n} 个标签存在未保存的修改，退出将丢弃这些修改。确定退出吗？":
    "{n} tabs have unsaved changes that will be discarded on exit. Exit anyway?",
  "当前文档有未保存的修改，退出将丢弃这些修改。确定退出吗？":
    "The current document has unsaved changes that will be discarded on exit. Exit anyway?",
  "检测到上次退出时有 {n} 个标签未保存（共 {total} 个标签）。是否恢复这些标签？":
    "Found {n} unsaved tab(s) from your last session (out of {total} tabs). Restore them?",
  "检测到上次未正常退出的编辑内容（{title}，{when}）。是否恢复？":
    "Found unsaved content from an abnormal exit ({title}, {when}). Restore it?",
  "「{reason}」需要 Pandoc 转换引擎（约 35MB，从官方渠道下载到本机，只需一次）。\n现在下载吗？":
    "“{reason}” requires the Pandoc conversion engine (about 35 MB, downloaded from the official source to this machine, one time only).\nDownload it now?",
  "转为 Markdown 后，文档的样式、布局、图表等 HTML 排版信息会丢失，且无法再恢复成原来的渲染效果。\n\n原 .html 文件不会被改动，转换结果是一个未保存的新文档。是否继续？":
    "Converting to Markdown will lose the document's styling, layout, charts and other HTML formatting, and the original rendering cannot be restored.\n\nThe original .html file will not be modified; the result is a new, unsaved document. Continue?",
  "PDF 导入为尽力转换：仅支持文字版 PDF，扫描件（图片型 PDF）无法提取文字；表格、多栏等复杂排版可能需要人工校正。\n继续吗？":
    "PDF import is best-effort: only text-based PDFs are supported; scanned (image-only) PDFs cannot be extracted. Tables, columns and other complex layouts may need manual correction.\nContinue?",
  "请先把光标放到表格单元格内，再设置整列对齐。":
    "Place the cursor inside a table cell before setting column alignment.",

  // ---- 环境检测（启动自检 / 依赖安装引导）----
  环境检测: "Environment Check",
  "前往官网": "Visit Website",
  "自动下载安装": "Download & Install",
  "以后再说": "Maybe Later",
  "自动安装失败：\n{detail}\n\n是否打开官网下载页面手动安装？":
    "Automatic installation failed:\n{detail}\n\nOpen the official download page to install manually?",
  "未检测到 Pandoc 转换引擎。\n\n它用于「导入 Word」与「导出 LaTeX / Epub」，约 35MB，只需安装一次；不安装不影响其它功能。":
    "Pandoc conversion engine not found.\n\nIt is used by “Import Word” and “Export LaTeX / Epub” (about 35 MB, one-time install). Skipping it does not affect other features.",
  "Pandoc 安装完成，现在可以使用「导入 Word」与「导出 LaTeX / Epub」了。":
    "Pandoc is installed. You can now use “Import Word” and “Export LaTeX / Epub”.",

  // ---- 错误前缀 ----
  "打开失败：": "Failed to open: ",
  "保存失败：": "Failed to save: ",
  "剪切失败：": "Failed to cut: ",
  "复制失败：": "Failed to copy: ",
  "粘贴失败：": "Failed to paste: ",
  "选择文件夹失败：": "Failed to choose folder: ",
  "设置文件关联失败：": "Failed to set file association: ",
  "打开主题文件夹失败：": "Failed to open themes folder: ",
  "导入 HTML 失败：": "Failed to import HTML: ",
  "导入 Word 失败：": "Failed to import Word: ",
  "导入 PDF 失败：": "Failed to import PDF: ",
  "按该编码重新读取失败：": "Failed to re-read with that encoding: ",
  "打开失败（已从最近列表移除）：":
    "Failed to open (removed from the recent list): ",
  "打开启动文件失败：": "Failed to open the startup file: ",
  "{title}失败：": "{title} failed: ",

  // ---- 文件对话框 ----
  打开文档: "Open Document",
  支持的文档: "Supported Documents",
  "保存 HTML 文件": "Save HTML File",
  "保存 Markdown 文件": "Save Markdown File",
  "导入 HTML 文档": "Import HTML Document",
  "HTML 文档": "HTML Document",
  "导入 Word 文档": "Import Word Document",
  "Word 文档": "Word Document",
  "导入 PDF 文档": "Import PDF Document",
  "PDF 文档": "PDF Document",
  选择文件夹作为目录树根: "Choose Folder as Tree Root",
  "导入 Word": "Import Word",

  // ---- 导出 ----
  "导出为 Word 文档": "Export as Word Document",
  "导出为 PDF 文档": "Export as PDF Document",
  "导出为 HTML 文档": "Export as HTML Document",
  导出为纯文本文件: "Export as Plain Text File",
  纯文本: "Plain Text",
  "导出为 LaTeX 文档": "Export as LaTeX Document",
  "LaTeX 文档": "LaTeX Document",
  "导出为 Epub 电子书": "Export as Epub E-book",
  "Epub 电子书": "Epub E-book",

  // ---- 状态栏 / 属性面板 ----
  文件名: "File name",
  位置: "Location",
  大小: "Size",
  "（空）": "(empty)",
  创建时间: "Created",
  修改时间: "Modified",
  磁盘信息: "Disk info",
  字数: "Words",
  字符数: "Characters",
  行数: "Lines",
  编码: "Encoding",
  "（有未保存的修改）": "(unsaved changes)",
  "头部字段 {field}": "Front matter field {field}",
  "{size}（{bytes} 字节）": "{size} ({bytes} bytes)",
  "{w} 字 · {c} 字符 · {l} 行": "{w} words · {c} characters · {l} lines",
  未保存: "Unsaved",
  已保存: "Saved",
  新建文档: "New Document",
  文件属性: "File Properties",

  // ---- 阅读 / 编辑模式 ----
  阅读模式: "Reading Mode",
  编辑模式: "Edit Mode",
  "当前为阅读模式，文档只读。点击切换到编辑模式（Ctrl+E）":
    "Reading mode: the document is read-only. Click to switch to edit mode (Ctrl+E)",
  "当前为编辑模式，可以修改文档。点击回到阅读模式（Ctrl+E）":
    "Edit mode: the document can be modified. Click to return to reading mode (Ctrl+E)",
  "阅读模式下不可直接编辑，请先切到编辑模式（Ctrl+E）":
    "Direct editing is unavailable in reading mode; switch to edit mode first (Ctrl+E)",
  切换到编辑模式: "Switch to Edit Mode",
  "这是大文档，正在以分节渲染方式打开（阅读流畅，但正文不可直接编辑）。\n切到编辑模式需要把整篇交给编辑器重新渲染，可能明显卡顿。\n继续切换吗？":
    "This is a large document, opened with section-by-section rendering for smooth reading (the text is not directly editable).\nSwitching to edit mode re-renders the entire document at once and may lag noticeably.\nContinue?",

  // ---- 代码文件（CodeMirror 视图）----
  "行 {r}，列 {c}": "Ln {r}, Col {c}",
  "（只读）": " (read-only)",
  "{n} 处匹配": "{n} matches",
  "代码文件没有标题大纲（正文高亮与折叠请直接用编辑区）":
    "Code files have no heading outline (use the editor for highlighting and folding)",
  分节只读视图: "Read-only sections",
  "超大代码文件以只读分节方式打开，无法切换到编辑模式。":
    "Very large code files open as read-only sections and cannot be switched to edit mode.",

  // ---- 代码工具（格式 → 代码工具）----
  代码工具: "Code Tools",
  代码工具执行失败: "Code tool failed",
  "JSON 美化": "Beautify JSON",
  "JSON 压缩": "Minify JSON",
  "CSS 美化": "Beautify CSS",
  "CSS 压缩": "Minify CSS",
  "JS 美化（安全子集）": "Beautify JS (safe subset)",
  "JS 压缩（安全子集）": "Minify JS (safe subset)",
  "小工具…": "Utilities…",
  待处理的文本: "Text to process",
  取选中: "Use Selection",
  "把编辑器里选中的内容取过来": "Copy the current selection from the editor",
  // 不叫「编码 / 解码」：`编码` 已被状态栏的「文件编码」占用，同键会撞车
  "编码为 Base64": "Encode",
  "解码为文本": "Decode",
  替换选中: "Replace Selection",
  结果: "Result",
  进制转换: "Base Conversion",
  "输入数字（如 ff、0b1010、755）": "Enter a number (e.g. ff, 0b1010, 755)",
  源进制: "From base",
  目标进制: "To base",
  自动识别: "Auto-detect",
  "{n} 进制": "Base {n}",
  重新生成: "Regenerate",
  插入到光标处: "Insert at Cursor",
  时间戳: "Timestamp",
  "本地时间 yyyy-MM-dd HH:mm:ss": "Local time yyyy-MM-dd HH:mm:ss",
  "日期 yyyy-MM-dd": "Date yyyy-MM-dd",
  "时间 HH:mm:ss": "Time HH:mm:ss",
  "ISO 8601（UTC）": "ISO 8601 (UTC)",
  "Unix 秒": "Unix seconds",
  "Unix 毫秒": "Unix milliseconds",

  // ---- 查找 / 替换 ----
  查找内容: "Find",
  替换为: "Replace with",
  替换: "Replace",
  全部替换: "Replace All",
  下一个: "Next",
  上一个: "Previous",
  区分大小写: "Match Case",
  全词匹配: "Match Whole Word",
  正则表达式: "Regular Expression",
  正则表达式无效: "Invalid regular expression",
  执行脚本时不支持预览查找:
    "Preview search is unavailable while scripts are enabled",
  执行脚本时不支持预览替换:
    "Preview replace is unavailable while scripts are enabled",
  "已替换 {n} 处": "Replaced {n} occurrence(s)",

  // ---- HTML 文档模式 ----
  预览: "Preview",
  源码: "Source",
  "HTML 预览": "HTML Preview",
  "HTML 源码": "HTML Source",
  执行脚本: "Run Scripts",
  禁用脚本: "Disable Scripts",
  "执行文档内的 JavaScript。开启后预览的沙箱会降级为独立源，直接编辑、查找替换、大纲定位将不可用（这是防止文档脚本反向操作本应用的安全底线）":
    "Run JavaScript inside the document. When enabled, the preview sandbox falls back to an opaque origin, disabling direct editing, find & replace and outline navigation (a safety baseline that prevents document scripts from controlling this app).",
  "文件编码：打开时自动检测，可手动切换":
    "File encoding: auto-detected on open; can be switched manually",
  "自动检测（重新读取文件）": "Auto-detect (re-read file)",
  "松开鼠标打开文件（支持 md / html / docx / pdf）":
    "Release to open the file (supports md / html / docx / pdf)",
  "目录树中仅支持打开 md / markdown / txt / html 文档（.{ext} 需要先转换）。":
    "The tree only supports opening md / markdown / txt / html documents (a .{ext} file must be converted first).",
  "暂不支持该文件类型（.{ext}），仅支持 md / html / docx / pdf。":
    "Unsupported file type (.{ext}); only md / html / docx / pdf are supported.",
  "已导入 {n} 页。转换结果为尽力还原，建议检查标题层级与段落划分是否需要校正。":
    "Imported {n} page(s). The conversion is best-effort; please check the heading levels and paragraph breaks and correct them if needed.",
  "按「{enc}」解码时遇到无法识别的字节（已显示为 \uFFFD），该编码可能不是文件的真实编码，建议改用自动检测或换一种编码。":
    "Unrecognized bytes were encountered while decoding as “{enc}” (shown as a replacement character). This encoding may not be the file's real encoding; use auto-detect or another encoding.",

  // ---- 菜单项 ----
  "打开…": "Open…",
  打开最近文件: "Open Recent",
  清除最近文件列表: "Clear Recent Files",
  新建标签: "New Tab",
  下一个标签: "Next Tab",
  上一个标签: "Previous Tab",
  自动检测: "Auto-detect",
  导入: "Import",
  导出: "Export",
  "导入 Word…": "Import Word…",
  "导入 PDF…": "Import PDF…",
  "导入 HTML 并转为 Markdown…": "Import HTML as Markdown…",
  "导出为 Word": "Export as Word",
  "导出为 PDF": "Export as PDF",
  "导出为 HTML": "Export as HTML",
  "导出为纯文本": "Export as Plain Text",
  "导出为 LaTeX（.tex）": "Export as LaTeX (.tex)",
  "导出为 Epub（.epub）": "Export as Epub (.epub)",
  "文件属性…": "File Properties…",
  退出程序: "Quit",
  撤销: "Undo",
  重做: "Redo",
  剪切: "Cut",
  复制: "Copy",
  粘贴: "Paste",
  "查找…": "Find…",
  查找下一个: "Find Next",
  查找上一个: "Find Previous",
  "替换…": "Replace…",
  标题: "Heading",
  "{n} 级标题": "Heading {n}",
  加粗: "Bold",
  斜体: "Italic",
  删除线: "Strikethrough",
  行内代码: "Inline Code",
  无序列表: "Unordered List",
  有序列表: "Ordered List",
  任务列表: "Task List",
  增加缩进: "Increase Indent",
  减少缩进: "Decrease Indent",
  引用: "Blockquote",
  分隔线: "Horizontal Rule",
  代码块: "Code Block",
  行间公式: "Math Block",
  "Mermaid 图": "Mermaid Diagram",
  链接: "Link",
  表格: "Table",
  对齐整列: "Align Column",
  左对齐: "Align Left",
  居中对齐: "Align Center",
  右对齐: "Align Right",
  插入图片: "Insert Image",
  表情: "Emoji",
  "即时渲染（IR）": "Instant Rendering (IR)",
  "所见即所得（WYSIWYG）": "WYSIWYG",
  "分屏预览（SV）": "Split View (SV)",
  "执行文档脚本（JavaScript）": "Run Document Scripts (JavaScript)",
  "转为 Markdown 编辑": "Convert to Markdown to Edit",
  侧边栏: "Sidebar",
  显示侧边栏: "Show Sidebar",
  文件目录树: "File Tree",
  文档大纲: "Document Outline",
  显示排版工具栏: "Show Formatting Toolbar",
  纯文本模式: "Plain Text Mode",
  "Markdown 模式": "Markdown Mode",
  "HTML 模式": "HTML Mode",
  显示行号: "Show Line Numbers",
  语法高亮语言: "Syntax Highlighting Language",
  "自动（按扩展名）": "Auto (by Extension)",
  沉浸式全屏编辑: "Immersive Fullscreen Editing",
  打字机模式: "Typewriter Mode",
  段落聚焦: "Paragraph Focus",
  浅色主题: "Light Theme",
  深色主题: "Dark Theme",
  跟随系统主题: "Follow System Theme",
  "快捷键一览…": "Keyboard Shortcuts…",
  "关于 Sticho…": "About Sticho…",
  快捷键一览: "Keyboard Shortcuts",
  "关于 Sticho": "About Sticho",

  // ---- 帮助 ----
  "轻量级 Markdown / HTML 文档编辑器。":
    "A lightweight Markdown / HTML document editor.",
  "支持 Markdown、Word、PDF、HTML 互转，全部转换在本机完成。":
    "Converts between Markdown, Word, PDF and HTML, all on your machine.",
  "基于 Tauri + Svelte + Vditor 构建。": "Built with Tauri + Svelte + Vditor.",
  "Word 转换由 Pandoc 独立进程完成（GPL-2.0，未随本程序分发）。":
    "Word conversion is done by a separate Pandoc process (GPL-2.0, not bundled with this app).",
  "文件：Ctrl+N 新建标签 / Ctrl+O 打开 / Ctrl+S 保存 / Ctrl+Shift+S 另存为":
    "File: Ctrl+N New Tab / Ctrl+O Open / Ctrl+S Save / Ctrl+Shift+S Save As",
  "标签：Ctrl+W 关闭 / Ctrl+Tab 下一个 / Ctrl+Shift+Tab 上一个 / 中键点标签也可关闭":
    "Tabs: Ctrl+W Close / Ctrl+Tab Next / Ctrl+Shift+Tab Previous / middle-click a tab to close",
  "导出：Ctrl+Shift+E Word / Ctrl+Shift+P PDF / Ctrl+Shift+H HTML / Ctrl+Shift+T 纯文本":
    "Export: Ctrl+Shift+E Word / Ctrl+Shift+P PDF / Ctrl+Shift+H HTML / Ctrl+Shift+T Plain Text",
  "编辑：Ctrl+Z 撤销 / Ctrl+Y 重做 / Ctrl+X 剪切 / Ctrl+C 复制 / Ctrl+V 粘贴":
    "Edit: Ctrl+Z Undo / Ctrl+Y Redo / Ctrl+X Cut / Ctrl+C Copy / Ctrl+V Paste",
  "查找：Ctrl+F 查找 / F3 查找下一个 / Shift+F3 查找上一个 / Ctrl+H 替换":
    "Find: Ctrl+F Find / F3 Find Next / Shift+F3 Find Previous / Ctrl+H Replace",
  "格式：Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+K 链接 / Ctrl+1~6 标题 1~6 级":
    "Format: Ctrl+B Bold / Ctrl+I Italic / Ctrl+K Link / Ctrl+1~6 Heading Levels 1~6",
  "视图：F9 显示/隐藏侧边栏 / Alt+F/E/O/V/S/H 展开对应菜单 / Esc 关闭菜单与查找栏":
    "View: F9 Toggle Sidebar / Alt+F/E/O/V/S/H Open Menu / Esc Close Menu and Find Bar",

  // ---- 侧边栏 ----
  大纲: "Outline",
  属性: "Properties",
  "点击展开 / 收起": "Click to expand / collapse",
  点击在编辑器中打开: "Click to open in editor",
  "加载中…": "Loading…",
  按文件夹浏览文件: "Browse files by folder",
  按标题层级跳转: "Jump by heading level",
  当前文件属性: "Current file properties",
  "关闭侧边栏（F9）": "Close sidebar (F9)",
  尚未选择文件夹: "No folder selected yet",
  未选择文件夹: "No folder selected",
  选择文件夹: "Choose Folder",
  "选择…": "Choose…",
  "未打开文档时，可点「选择…」指定一个文件夹作为目录树根。":
    "With no document open, click “Choose…” to pick a folder as the tree root.",
  该文件夹为空: "This folder is empty",
  "当前文档没有标题（用 # 或下划线式写法设置标题后会显示在这里）":
    "This document has no headings (headings set with # or the underline style will appear here)",

  // ---- 阅读排版（字体 / 字号 / 行距 / 文字色 / 护眼底色）----
  阅读排版: "Reading Typography",
  "只作用于 Markdown / 纯文本文档；HTML 文档自带样式，不受这里影响。":
    "Applies to Markdown / plain-text documents only; HTML documents keep their own styles and are unaffected.",
  字体: "Font",
  字号: "Font Size",
  行距: "Line Height",
  文字颜色: "Text Color",
  页面背景: "Page Background",
  恢复默认排版: "Reset Typography",
  自定义颜色: "Custom color",
  "无衬线（默认）": "Sans-serif (default)",
  微软雅黑: "Microsoft YaHei",
  宋体: "SimSun",
  黑体: "SimHei",
  楷体: "KaiTi",
  等宽: "Monospace",
  米黄: "Cream",
  黑色: "Black",
  护眼绿: "Eye-care Green",
  淡蓝: "Light Blue",
  淡灰: "Light Gray",
  夜间: "Night",
  深棕: "Dark Brown",

  // ---- WebDAV 云同步与多版本（批次九）----
  云同步: "Cloud Sync",
  WebDAV云同步: "WebDAV Cloud Sync",
  服务器地址: "Server URL",
  用户名: "Username",
  密码: "Password",
  远端根目录: "Remote Root",
  测试连接: "Test Connection",
  "测试中…": "Testing…",
  连接成功: "Connected",
  "连接成功（支持 WebDAV）": "Connected (WebDAV supported)",
  "凭据错误，请检查用户名与密码": "Invalid credentials — check the username and password",
  "远端根目录不存在，将在上传时自动创建":
    "Remote root does not exist yet; it will be created automatically on upload",
  "远端路径不存在（404）": "Remote path not found (404)",
  "该地址不支持 WebDAV（405）": "This URL does not support WebDAV (405)",
  "远端父目录不存在（409）": "Remote parent directory not found (409)",
  "远端存储空间不足（507）": "Remote storage is full (507)",
  请先填写服务器地址: "Enter the server URL first",
  启用云同步: "Enable Cloud Sync",
  请先测试连接: "Test the connection first",
  浏览云端文件: "Browse Cloud Files",
  云端文件: "Cloud Files",
  返回上级: "Up",
  刷新: "Refresh",
  空目录: "Empty folder",
  "同步中…": "Syncing…",
  已同步: "Synced",
  同步失败: "Sync failed",
  多版本控制: "Version History",
  最多保留版本数: "Versions to Keep",
  历史版本: "History",
  恢复到编辑器: "Restore to Editor",
  删除该版本: "Delete Version",
  该文档暂无历史版本: "No version history for this document",
  凭据以明文保存在本机设置文件中:
    "Credentials are stored in plain text in the local settings file",
  "自签名证书的 HTTPS 服务器暂不支持，请使用公网证书或 http 内网地址":
    "HTTPS servers with self-signed certificates are not supported; use a public CA or a plain http intranet address",
  "云端文档将作为未命名文档打开，保存时请另存到本地":
    "Cloud documents open as untitled documents; use Save As to keep a local copy",
  同步失败不影响本地保存: "A sync failure does not affect local saving",
  "云端文件不是 UTF-8 编码，暂不支持下载":
    "The cloud file is not UTF-8 encoded and cannot be downloaded yet",
  "版本 {n}": "Version {n}",

  // ---- 配置文件保存位置（批次十）----
  配置文件位置: "Config File Location",
  系统用户目录: "User Data Folder",
  程序当前目录: "Program Folder",
  立即重启: "Restart Now",
  "已切换，重启后生效": "Switched — takes effect after restart",
  "系统用户目录为推荐做法；程序当前目录便于随程序一起搬移（需目录可写）":
    "The user data folder is recommended; the program folder makes the app portable (the folder must be writable)",
  "切换会把现有设置、恢复草稿与自定义主题复制到新位置，原文件保留为备份":
    "Switching copies existing settings, recovery drafts and custom themes to the new location; the original files are kept as a backup",
  已启用: "Enabled",
  未启用: "Disabled",
  "程序所在目录不可写（可能安装在 Program Files 或被安全软件保护），请继续使用系统用户目录":
    "The program folder is not writable (it may be installed under Program Files or protected by security software). Please keep using the user data folder",

  // ---- 本地版本历史与诊断（文件历史 / 导出诊断信息）----
  文件历史: "File History",
  "（暂无历史版本）": "(No version history yet)",
  "用该历史版本覆盖当前编辑内容？当前磁盘上的版本会先留一份档，可再回滚。":
    "Overwrite the current editor content with this version? The version currently on disk will be archived first, so you can roll back again.",
  "恢复历史版本失败：": "Failed to restore the version: ",
  "导出诊断信息…": "Export Diagnostics…",
  导出诊断信息: "Export Diagnostics",
  "诊断信息已导出：\n{path}": "Diagnostics exported to:\n{path}",
  "导出诊断信息失败：": "Failed to export diagnostics: ",
  文本文件: "Text File",
  本地版本历史保留份数: "Versions kept per file",
  "保存覆盖前自动留档，可在「文件 → 文件历史」回滚；份数越多占用磁盘越多。":
    "A copy is archived before each overwrite and can be restored from File → File History; keeping more versions uses more disk space.",

  // ---- 文件历史 / 版本差异（批次九、批 3 补齐）----
  对该历史版本的操作: "Actions for this version",
  查看与当前内容的差异: "Compare with current content",
  用该版本覆盖当前编辑内容: "Overwrite current editor content with this version",
  查看差异: "View Diff",
  版本差异: "Version Comparison",
  当前内容: "Current Content",
  "云端版本 {n}": "Cloud Version {n}",
  云端当前内容: "Current Cloud Content",
  "未变 {n} 行": "{n} unchanged line(s)",
  两个版本内容完全相同: "The two versions are identical",
  "读取历史版本失败：": "Failed to read the version: ",

  // ---- 命令面板 / 跨文件搜索 / 引导页（批 4 补齐）----
  命令面板: "Command Palette",
  "输入命令名称…": "Type a command name…",
  没有匹配的命令: "No matching commands",
  跨文件搜索: "Search in Files",
  搜索: "Search",
  在当前文件夹中全文搜索: "Full-text search in the current folder",
  "在当前文件夹中搜索…": "Search in the current folder…",
  "搜索中…": "Searching…",
  "输入关键词开始搜索（字面量匹配，可切换区分大小写）。":
    "Type a keyword to start searching (literal matching; case sensitivity can be toggled).",
  没有找到匹配内容: "No matches found",
  "在 {files} 个文件中找到 {n} 处": "Found {n} match(es) in {files} file(s)",
  "（结果已截断，请缩小范围）": "(Results truncated — narrow the scope)",
  "（该文件命中过多，仅显示前若干条）":
    "(Too many matches in this file; only the first few are shown)",
  "未选择文件夹。请先切到「文件」标签，点「选择…」指定一个目录，再回到这里搜索。":
    "No folder selected. Switch to the “Files” tab, click “Choose…” to pick a folder, then come back here to search.",
  "入门指南…": "Getting Started…",
  "欢迎使用 Sticho": "Welcome to Sticho",
  "轻量级 Markdown / HTML 文档编辑器，转换全部在本机完成。":
    "A lightweight Markdown / HTML document editor; all conversions happen on your machine.",
  开始使用: "Get Started",
  新建或打开文档: "Create or open a document",
  "工具栏或「文件」菜单；也支持把文件直接拖进窗口。":
    "Use the toolbar or the File menu; you can also drag a file into the window.",
  快捷排版: "Quick formatting",
  "Ctrl+B 加粗、Ctrl+I 斜体、Ctrl+Shift+K 链接、Ctrl+1~6 标题。":
    "Ctrl+B bold, Ctrl+I italic, Ctrl+Shift+K link, Ctrl+1~6 headings.",
  "按 Ctrl+K 搜索并执行菜单里的任意命令。":
    "Press Ctrl+K to search for and run any command in the menus.",
  "侧边栏「搜索」标签可在当前文件夹内全文查找。":
    "The sidebar's “Search” tab looks through the full text of the current folder.",
  导出与云同步: "Export and cloud sync",
  "可导出 Word / PDF / HTML，也支持 WebDAV 云端多版本。":
    "Export to Word / PDF / HTML, and keep multiple versions in the cloud over WebDAV.",

  // ---- 云同步冲突副本 / 更新占位（批 5）----
  冲突处理方式: "Conflict Handling",
  "保留冲突副本（推荐）": "Keep a Conflict Copy (Recommended)",
  直接覆盖云端: "Overwrite the Cloud Copy",
  "云端文件被其他设备改过时：保留副本会在同目录另存一份，绝不覆盖对方内容；直接覆盖则以其为准。":
    "When a cloud file has been changed by another device: “Keep a Conflict Copy” saves a separate copy in the same folder and never overwrites the other side; “Overwrite” makes this copy authoritative.",
  更新: "Updates",
  "未配置更新源则不检查更新；如需升级，请到发布页下载新版安装包。":
    "With no update source configured the app never checks for updates; to upgrade, download a new installer from the releases page.",

  // ---- 代码文件 / 文件类型提示（补齐）----
  代码文件: "Code File",
  保存代码文件: "Save Code File",
  所有支持的文档: "All Supported Documents",
  "目录树中仅支持打开 Markdown / HTML / 纯文本 / 代码文件（.{ext} 需要先转换）。":
    "The tree only supports opening Markdown / HTML / plain-text / code files (a .{ext} file must be converted first).",
  "暂不支持该文件类型（.{ext}），仅支持 md / html / docx / pdf / 代码文件。":
    "Unsupported file type (.{ext}); only md / html / docx / pdf / code files are supported.",

  // ---- 导出图片嵌入报告 ----
  "\n…另有 {n} 张": "\n…and {n} more",
  "已嵌入 {n} 张图片。以下图片未能嵌入，已回落为占位文字：\n{list}{more}":
    "Embedded {n} image(s). The following images could not be embedded and fell back to placeholder text:\n{list}{more}",

  // ---- 快捷键一览（批 4 改键后的文案）----
  "格式：Ctrl+B 加粗 / Ctrl+I 斜体 / Ctrl+Shift+K 链接 / Ctrl+1~6 标题 1~6 级":
    "Format: Ctrl+B Bold / Ctrl+I Italic / Ctrl+Shift+K Link / Ctrl+1~6 Heading Levels 1~6",
  "视图：Ctrl+K 命令面板 / F9 显示/隐藏侧边栏 / Alt+F/E/O/V/S/H 展开对应菜单 / Esc 关闭菜单与查找栏":
    "View: Ctrl+K Command Palette / F9 Toggle Sidebar / Alt+F/E/O/V/S/H Open Menu / Esc Close Menu and Find Bar",
};

/** 生成翻译函数：locale 变化时由 $derived 重新生成，标记文本随之更新 */
export function makeT(locale: Locale) {
  return (key: string, vars?: Vars): string => {
    const raw = locale === "zh-CN" ? key : EN[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in vars ? String(vars[name]) : whole,
    );
  };
}

/** 供查缺使用：已收录的英文词条数（不参与界面逻辑） */
export function enEntryCount(): number {
  return Object.keys(EN).length;
}