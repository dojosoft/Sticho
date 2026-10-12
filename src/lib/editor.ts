/**
 * Vditor 编辑器封装（任务书阶段 2；阶段 10 扩展菜单栏所需的编辑能力）
 *
 * 模式选择 'ir'（Instant Rendering，即时渲染）：
 * 输入 `# 标题` 立即渲染成标题、光标点回可改源码，体验类似 Typora。
 * 若 ir 模式在 WebView2 出现兼容问题，退路是 'sv'（分屏）或 'wysiwyg'。
 *
 * 排版类菜单（加粗/标题/列表…）统一复用 Vditor 工具栏按钮的既有逻辑：
 * 直接点击工具栏项等价于用户点击，避免在应用层重复实现一遍 Markdown 排版规则。
 */
import type Vditor from "vditor";
import "vditor/dist/index.css";
import { convertFileSrc } from "@tauri-apps/api/core";
import { saveImageAsset } from "./tauri-api";
import { LargeReader, LARGE_DOC_BYTES, type MountedSection } from "./largeReader";

let vditor: Vditor | null = null;

/**
 * Vditor 构造函数（动态加载）。
 *
 * Vditor 本体连同 lute 内核体积可观，静态 import 会把它打进首屏主包：
 * 应用还没画完界面壳就先解析几百 KB 的编辑器代码。改为按需 import——
 * initEditor 时才拉取，主包只留界面壳，首帧明显提前（编辑器随后就位）。
 */
let VditorCtor: typeof Vditor | null = null;

/** 按需加载 Vditor 本体（首次触发 import，之后复用同一份） */
async function ensureVditor(): Promise<typeof Vditor> {
  if (!VditorCtor) VditorCtor = (await import("vditor")).default;
  return VditorCtor;
}
let changeListener: ((value: string) => void) | null = null;

/**
 * 编辑器是否已初始化完成。
 *
 * Vditor 的构造函数只是发起 i18n 脚本加载，真正的 init() 要等脚本就绪后才执行，
 * 在那之前实例内部的 vditor 尚未建立，调用 getValue()/setValue() 会抛错。
 */
let ready = false;
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> = Promise.resolve();
/** 编辑器界面语言（批次八）：构造时写入 options.lang，见 setEditorLocale */
let editorLang: "zh_CN" | "en_US" = "zh_CN";

/**
 * 阅读模式（只读）开关。
 *
 * 打开文档后默认进入阅读模式，正文不可改；用户显式切到编辑模式才放行。
 * 这里用模块级变量而不是每次去读 DOM：所有会改正文的入口（菜单、快捷键、
 * 工具栏、粘贴、替换）都汇流在本文件的导出函数上，在这一层拦住最省事也最可靠。
 */
let editorReadonly = false;

/**
 * Vditor 运行时资源根路径（相对前端根路径，对应 public/vditor）。
 *
 * Vditor 默认从 unpkg CDN 拉取 lute 渲染内核、i18n 文案、图标、highlight.js、
 * KaTeX、Mermaid 等。桌面端必须离线可用——尤其是 i18n：Vditor 的构造函数先
 * addScript 拉 i18n 脚本，成功才调 init()，拉不到则编辑器整体打不开。
 * 故把 dist 下的 js、images、css 全部随包内置（MathJax 除外：数学引擎固定为
 * 默认的 KaTeX，该分支不会被触发）。
 */
const CDN_PATH = "vditor";

/**
 * 内容主题样式表目录（Vditor 的 content-theme 相对路径）。
 *
 * 该样式表决定正文文字颜色（index.css 里 `.vditor-reset` 恒为浅色的 #24292e，
 * 深色需由 dark.css 覆盖）。
 */
const CONTENT_THEME_PATH = `${CDN_PATH}/dist/css/content-theme`;

/** 单张图片的体积上限：前端软限制（Rust 侧另有 20MB 硬上限） */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 图片落盘目录名（与文档同级），与 Rust 侧 asset.rs 的 ASSET_DIR_NAME 对应 */
const ASSET_DIR = "assets";

/** 当前文档的绝对路径（未保存的新文档为 null）：图片落盘与相对路径解析都靠它 */
let currentDocPath: string | null = null;

/** 把本地图片读成纯 base64（不含 `data:*;base64,` 前缀），读不出内容时返回 null */
function readImageAsBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * 图片插入的本地实现（工具栏 upload 项 / 格式菜单「插入图片」）。
 *
 * 桌面端没有上传服务器，这里把图片交给 Rust 的 save_image_asset 落盘到「文档同级
 * assets 目录」，正文只写相对路径 `assets/xxx.png`：比内联 data URI 少占正文体积，
 * 文档连同 assets 目录整体搬走也仍能显示。Vditor 的 handler 约定：返回字符串时由它
 * 代为提示，返回 null 表示已自行处理完毕。
 */
function insertLocalImages(files: File[]): Promise<null> {
  return (async () => {
    // 阅读模式下拖入 / 粘贴图片同样要拦住（Vditor 的丢放与粘贴会走这个 handler）
    if (blockedByReadonly()) return null;
    if (!currentDocPath) {
      vditor?.vditor.tip.show("请先保存文档，再插入图片");
      return null;
    }
    const marks: string[] = [];
    const failed: string[] = [];
    for (const file of files) {
      if (file.size > MAX_IMAGE_BYTES) {
        failed.push(`${file.name}（超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB）`);
        continue;
      }
      const data = await readImageAsBase64(file);
      if (data === null) {
        failed.push(`${file.name}（读取失败）`);
        continue;
      }
      try {
        const saved = await saveImageAsset(currentDocPath, file.name, data);
        const fileName = saved.split(/[\\/]/).pop() ?? "";
        // 目标路径按 URI 编码：文件名里的空格与中文不编码时会被 Markdown 解析器当成
        // 目标的结束/非法字符，图片渲染不出来（预览侧解析时再 decodeURI 还原成文件路径）
        const target = encodeURI(`${ASSET_DIR}/${fileName}`).replace(/#/g, "%23");
        marks.push(`![${file.name.replace(/[[\]()]/g, "")}](${target})`);
      } catch (e) {
        failed.push(`${file.name}（${typeof e === "string" ? e : "保存失败"}）`);
      }
    }
    if (marks.length > 0) vditor?.insertValue(marks.join("\n"));
    if (failed.length > 0) vditor?.vditor.tip.show(`未插入：${failed.join("、")}`);
    scheduleImageResolve(150);
    return null;
  })();
}

// ---- 批次三：正文相对路径图片 → asset URL ----

/** 是否已是绝对路径（盘符或 UNC） */
function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/**
 * 把相对路径拼到目录上并规范化（消掉 `.` 与 `..`）。
 *
 * 必须产出规范化后的绝对路径：asset 协议在比对 scope 前会 canonicalize，
 * 含 `..` 的路径会被 SafePathBuf 拒绝（403），`<img>` 只会静默空白。
 */
function normalizeJoin(dir: string, rel: string): string {
  const unc = /^[\\/]{2}/.test(dir);
  const stack = dir.split(/[\\/]+/).filter((part) => part !== "");
  // 盘符（或 UNC 的主机+共享名）是路径的根，`..` 不能把它弹掉，
  // 否则文档就在盘根时 `../x.png` 会算出相对路径，asset URL 直接算错
  const floor = unc ? 2 : 1;
  for (const part of rel.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length > floor) stack.pop();
    } else {
      stack.push(part);
    }
  }
  return (unc ? "\\\\" : "") + stack.join("\\");
}

/**
 * 把正文里的相对路径图片换成 asset URL，让本地图片在预览里显示出来。
 *
 * Vditor 的 IR 预览只是个 `<img src="assets/x.png">`，页面 URL 是 tauri://localhost，
 * 相对路径自然找不到文件；asset 协议允许把本地绝对路径当资源加载，故这里逐个换算。
 * 只处理相对路径——data:（内联图）、http(s):（网络图）、asset:/blob:（已换算过）、
 * `//`（协议相对）一律跳过，重复调用因此是幂等的。
 *
 * 改 `img.src` 不会污染回写：`VditorIRDOM2Md()` 取的是源码面的标记，实测 Markdown 里的
 * 相对路径原样保留。
 */
function resolveLocalImages(): void {
  const scroller = getEditorContentElement();
  if (scroller) resolveImagesIn(scroller);
}

/** 把 root 子树里的相对路径图片换成 asset URL（大文档阅读器按分节逐块调用） */
function resolveImagesIn(root: HTMLElement): void {
  if (!currentDocPath || !ready || !vditor) return;
  const docDir = currentDocPath.replace(/[\\/][^\\/]*$/, "");
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (src === "" || /^(data:|https?:|asset:|blob:|\/\/)/i.test(src)) continue;
    let decoded = src;
    try {
      decoded = decodeURI(src);
    } catch {
      /* 不是合法的百分号编码：按原样当文件路径处理 */
    }
    const abs = isAbsolutePath(decoded) ? decoded : normalizeJoin(docDir, decoded);
    img.src = convertFileSrc(abs);
  }
}

/** 待重算图片 URL 的句柄 */
let imageResolveTimer: number | null = null;

/**
 * 延后重算图片 URL。
 *
 * 每次输入 Vditor 都会重绘 IR（`img.src` 被重置回 Markdown 里的相对路径），故输入后
 * 要再换算一次；防抖是为了避开它一轮输入里的多次重排。
 */
function scheduleImageResolve(delay = 200): void {
  if (imageResolveTimer !== null) clearTimeout(imageResolveTimer);
  imageResolveTimer = window.setTimeout(() => {
    imageResolveTimer = null;
    resolveLocalImages();
  }, delay);
}

/** 同步当前文档路径（打开 / 另存 / 新建文档时由应用层调用），并立即重算一次图片 URL */
export function setDocumentPath(path: string | null): void {
  currentDocPath = path;
  scheduleImageResolve(0);
}

/** 随包内置的表情图片目录（Vditor 的 hint.emojiPath 默认指向 unpkg CDN） */
const EMOJI_PATH = `${CDN_PATH}/dist/images/emoji`;

/** 表情别名表：别名 → Unicode 字符，或自定义表情的图片路径 */
type EmojiTable = Record<string, string>;

/** 表情使用次数的本地存储键（候选面板前两行按使用频率排序） */
const EMOJI_USAGE_KEY = "md-studio.emoji-usage";

/** 「常用」区容量：面板固定 7 列（见 app.css 的 .vditor-emojis 宽度），14 个恰好占满前两行 */
const COMMON_EMOJI_COUNT = 14;

/** 尚无使用记录时的默认常用表情（按 Unicode 字符书写，渲染时反查别名） */
const DEFAULT_COMMON_EMOJI = [
  "😂", "😄", "😭", "😍", "🥰", "😊", "😅", "🤔", "😀", "👍", "👏", "🙏", "❤️", "🎉",
];

/** 区域指示符（国旗由两个这样的字符拼成） */
const REGIONAL_INDICATOR = /[\u{1F1E6}-\u{1F1FF}]/u;

/** 旗帜标签字符（英格兰/苏格兰/威尔士旗＝黑旗 + 一组不可见标签字符） */
const FLAG_TAG = /[\u{E0020}-\u{E007F}]/u;

/**
 * 判断是否为「本机渲染不出来」的旗帜表情。
 *
 * Windows 的 Segoe UI Emoji 没有国旗字形，会把国旗退化渲染成 AF、AX、AL 这样的字母对；
 * 三面用标签字符拼的旗帜则只剩一面黑旗。这些条目留在候选里只会让人以为功能坏了，
 * 故整体剔除（正文里的 :cn: 等别名照旧由 Lute 解析，这里只影响候选菜单）。
 */
function isUnrenderableFlag(value: string): boolean {
  const chars = [...value];
  return (chars.length > 0 && chars.every((c) => REGIONAL_INDICATOR.test(c))) || FLAG_TAG.test(value);
}

/**
 * 整理 Lute 内置表情表：剔除渲染不出来的旗帜，并把图片占位符换成本地路径。
 *
 * 表中标准表情的值就是 Unicode 字符，但 17 个自定义表情的值形如 `${emojiSite}/doge.png`：
 * 占位符本应由 Lute 渲染时按 SetEmojiSite 替换，而 Vditor 的面板/补全会把原样的值直接写进
 * <img src>，不换就会全部裂图。另外表里 siyuan 写的是 .svg，随包内置的只有 .png。
 */
function normalizeEmojiTable(raw: EmojiTable): EmojiTable {
  const out: EmojiTable = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isUnrenderableFlag(value)) continue;
    out[key] = value
      .replace("${emojiSite}", EMOJI_PATH)
      .replace(`${EMOJI_PATH}/siyuan.svg`, `${EMOJI_PATH}/siyuan.png`);
  }
  return out;
}

/** 读取表情使用次数（存储不可用时按没有记录处理） */
function loadEmojiUsage(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMOJI_USAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** 记录一次表情使用（次数只增不减，用于把常用表情顶到面板最前） */
function countEmojiUsage(value: string): void {
  const usage = loadEmojiUsage();
  usage[value] = (usage[value] ?? 0) + 1;
  try {
    localStorage.setItem(EMOJI_USAGE_KEY, JSON.stringify(usage));
  } catch {
    /* 写入失败只影响排序，不影响插入 */
  }
}

/** 当前生效的表情表，以及「值 → 代表别名」的反查表（重建面板时用） */
let emojiTable: EmojiTable = {};
let emojiKeyByValue = new Map<string, string>();

/** 常用表情的值列表：用过的按次数降序排在前，不足 14 个时用默认表补齐 */
function commonEmojiValues(): string[] {
  const ranked = Object.entries(loadEmojiUsage())
    .filter(([value]) => emojiKeyByValue.has(value))
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value);
  for (const value of DEFAULT_COMMON_EMOJI) {
    if (ranked.length >= COMMON_EMOJI_COUNT) break;
    if (emojiKeyByValue.has(value) && !ranked.includes(value)) ranked.push(value);
  }
  return ranked.slice(0, COMMON_EMOJI_COUNT);
}

/**
 * 单个表情按钮的 HTML。
 *
 * 结构与 Vditor 自带面板保持一致：data-value / data-key 是它事件委托的取值依据
 * （面板上的监听挂在面板元素本身，按钮不带自己的监听），故只替换内容不会丢点击行为。
 * 值里带点的是图片文件，其余是 Unicode 字符。
 */
function emojiButtonHTML(key: string, value: string): string {
  return value.includes(".")
    ? `<button data-value=":${key}: " data-key=":${key}:"><img class="vditor-emojis__icon" src="${value}"/></button>`
    : `<button data-value="${value} " data-key="${key}"><span class="vditor-emojis__icon">${value}</span></button>`;
}

/**
 * 面板每批渲染的表情个数：7 列 × 20 行（约两屏多），滚动到接近底部时再续下一批。
 *
 * 全量表 1600 余个表情（其中 500 余个是 ZWJ / 变体选择符序列）一次性排进 DOM，
 * 会让面板首次展开明显卡一下，故分批渲染。
 */
const EMOJI_CHUNK_SIZE = 140;

/** 待渲染队列（分隔线之后的全部表情）、已渲染到的位置、面板是否需要重建（常用排序变了） */
let emojiQueue: [string, string][] = [];
let emojiCursor = 0;
let emojiPanelDirty = true;

/** 把队列中尚未渲染的一批追加到面板末尾（队列空则什么都不做） */
function fillEmojiPanel(panel: HTMLElement): void {
  if (emojiCursor >= emojiQueue.length) return;
  const slice = emojiQueue.slice(emojiCursor, emojiCursor + EMOJI_CHUNK_SIZE);
  emojiCursor += slice.length;
  panel.insertAdjacentHTML(
    "beforeend",
    slice.map(([key, value]) => emojiButtonHTML(key, value)).join(""),
  );
}

/**
 * 重建面板：前两行是「常用」区（14 个，按使用频率排序），分隔线之后是其余表情的第一批。
 *
 * 面板按 7 列布局（见 app.css 的 .vditor-emojis 宽度），14 个正好占满前两行。
 * 已进入常用区的表情不再出现在下方列表，避免同一个表情出现两次。
 */
function rebuildEmojiPanel(panel: HTMLElement): void {
  const common = commonEmojiValues();
  let html = "";
  for (const value of common) {
    const key = emojiKeyByValue.get(value);
    if (key) html += emojiButtonHTML(key, value);
  }
  panel.innerHTML = `${html}<div class="md-studio-emojis__divider"></div>`;

  const commonSet = new Set(common);
  emojiQueue = Object.entries(emojiTable).filter(([, value]) => !commonSet.has(value));
  emojiCursor = 0;
  fillEmojiPanel(panel);
  emojiPanelDirty = false;
}

/**
 * 给表情面板挂上「按需渲染」行为。
 *
 * Vditor 用 style.display 开关面板（见其 toolbar/setToolbar.ts 的 toggleSubMenu），
 * 这里据此在每次展开时才把内容建出来——首次展开之前面板里只有 Vditor 构造时写入的
 * 8 个默认表情，不占启动时间，也不会在启动阶段多出 1600 余个按钮的解析与排版。
 */
function attachEmojiPanel(): void {
  const itemElement = vditor?.vditor.toolbar?.elements?.emoji as HTMLElement | undefined;
  const panelElement = itemElement?.lastElementChild as HTMLElement | undefined;
  const panel = panelElement?.querySelector<HTMLElement>(".vditor-emojis");
  if (!itemElement || !panelElement || !panel) return;

  new MutationObserver(() => {
    const open = panelElement.style.display === "block";
    // 面板展开期间压掉按钮的浮动说明（规则见 app.css 的 .md-studio-emojis-open）：
    // 说明是 ::after 里的 aria-label，指向 __s（按钮正下方），指针点开后仍停在按钮上
    // 就不会退出 :hover，那条深色文字框会正好盖住面板顶部一行。
    itemElement.classList.toggle("md-studio-emojis-open", open);
    if (!open) return; // 收起/其他样式变化不处理内容
    if (emojiPanelDirty) rebuildEmojiPanel(panel);
    else fillEmojiPanel(panel); // 上次没滚到底就关掉了，这次接着渲染
  }).observe(panelElement, { attributes: true, attributeFilter: ["style"] });

  panel.addEventListener("scroll", () => {
    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 400) fillEmojiPanel(panel);
  });

  // 记录使用次数，供下次展开时重排常用区。面板随即被 Vditor 收起（见其 Emoji.ts），
  // 所以这里只标脏、不重建：重建放到下次展开时，免得白算一遍马上又看不见。
  // Vditor 自己的点击处理挂在面板外层元素上，这里是它冒泡路径上的子节点，不会互相顶掉。
  panel.addEventListener("click", (event) => {
    const value = (event.target as Element | null)
      ?.closest("button")
      ?.getAttribute("data-value")
      ?.trim();
    if (!value) return;
    countEmojiUsage(value);
    emojiPanelDirty = true;
  });
}

/**
 * 把表情面板与「输入 : 补全」从 Vditor 默认的 8 个表情扩展成 Lute 内核自带的全量表（1900 余条）。
 *
 * Vditor 的面板只读 options.hint.emoji（默认 8 条），而 Lute 的 GetEmojis() 返回完整别名表，
 * 两者结构一致（短名 → Unicode 字符或图片路径），因此不必在源码里再存一份表情数据：
 * 构造完成后取全量表、回填 hint.emoji，面板内容则推迟到展开时按需渲染（见 attachEmojiPanel），
 * 既不增加包体积，也无需改 Vditor 代码。
 *
 * 只输入 ":" 还没有前缀时 Vditor 用这份表出候选；有前缀（如 ":do"）时它直接查 Lute 的
 * GetEmojis()，两条路径都要拿到整理过的表，故把实例方法一并覆盖（否则有前缀的候选里
 * 仍会出现裂图的图片表情与渲染成字母的国旗条目）。
 */
function expandEmojiSet(): void {
  const v = vditor?.vditor;
  if (!v) return;

  emojiTable = normalizeEmojiTable(v.lute.GetEmojis());
  emojiKeyByValue = new Map();
  for (const [key, value] of Object.entries(emojiTable)) {
    if (!emojiKeyByValue.has(value)) emojiKeyByValue.set(value, key);
  }

  // 常用表情排到最前：空前缀的候选列表只取前 8 条，正好先给出这批常用表情
  const ordered: EmojiTable = {};
  for (const value of commonEmojiValues()) {
    const key = emojiKeyByValue.get(value);
    if (key) ordered[key] = value;
  }
  for (const [key, value] of Object.entries(emojiTable)) {
    if (!(key in ordered)) ordered[key] = value;
  }
  v.lute.GetEmojis = () => ordered;
  if (v.options.hint) v.options.hint.emoji = ordered;

  emojiPanelDirty = true;
  attachEmojiPanel();
}

// ---- 阶段 13：代码块与公式入口（工具栏自定义项 / 格式菜单共用）----

/**
 * 工具栏自定义按钮图标。
 *
 * Vditor 的样式表给工具栏 svg 设了 `fill: currentColor; stroke-width: 0`，
 * 故这里的图形用自己的描边属性覆盖（元素自身的呈现属性优先于继承值）。
 */
const MATH_ICON =
  '<svg viewBox="0 0 24 24"><path d="M18 5H6.5l6 7-6 7H18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Mermaid 图：两个方块夹一个菱形的简单流程图 */
const MERMAID_ICON =
  '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4.5" rx="1"/><path d="M12 6.5v3.5"/><path d="M12 10l-3.5 2.5L12 15l3.5-2.5L12 10z"/><path d="M12 15v3.5"/><rect x="8" y="18.5" width="8" height="4.5" rx="1"/></g></svg>';

/**
 * 取光标所在的顶层块元素（正文容器的直接子元素）。
 *
 * 用来在插入块级片段后定位「刚刚插进去的那一块」：Vditor 的 insertMD 走
 * util/selection 的 insertHTML，块级内容一律插在当前块的**后面**。
 */
function currentTopBlock(): HTMLElement | null {
  const scroller = getEditorContentElement();
  const node = document.getSelection()?.anchorNode ?? null;
  let el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  if (!scroller || !el) return null;
  while (el.parentElement && el.parentElement !== scroller) el = el.parentElement;
  return el.parentElement === scroller ? el : null;
}

/**
 * 在当前块的后面插入一段块级 Markdown（行间公式 / Mermaid 图共用）。
 *
 * 用 Vditor 的 insertMD 而不是 insertValue：后者是把文本当 HTML 节点塞进光标处，
 * 再让 SpinVditorIRDOM 重新解析；insertMD 直接走 Md2VditorIRDOM，围栏一定变成
 * 真正的代码块 / 公式块。
 *
 * 插入后把光标送进新块的源码区：Vditor 的 insertHTML 会把 <wbr> 追加到新块的
 * 最后一个子元素（即结束围栏之后），照它给的落点继续输入会改到结束围栏上。
 */
function insertBlockSnippet(md: string): void {
  if (blockedByReadonly()) return;
  if (!ready || !vditor) return;
  vditor.focus();
  const before = currentTopBlock();
  vditor.insertMD(md);

  const inserted = before?.nextElementSibling as HTMLElement | null;
  const code = inserted?.querySelector<HTMLElement>(".vditor-ir__marker--pre code") ?? null;
  if (code) {
    const range = document.createRange();
    range.selectNodeContents(code);
    range.collapse(false);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    vditor.vditor.ir?.element.querySelector("wbr")?.remove();
  }
  scheduleLineNumbers(200);
}

/** 插入行间公式块（工具栏 Σ 按钮 / 格式菜单「行间公式」共用） */
export function insertMathBlock(): void {
  insertBlockSnippet("$$\n\n$$\n");
}

/** 插入 Mermaid 图代码块（工具栏按钮 / 格式菜单「Mermaid 图」共用） */
export function insertMermaidBlock(): void {
  insertBlockSnippet("```mermaid\n\n```\n");
}

// ---- 阶段 13：代码块语言下拉（点击 IR 代码块的语言标记）----

/** 语言面板排在前面的常用语言（其余语言由 highlight.js 的语言表补齐） */
const COMMON_LANGUAGES = [
  "js", "ts", "python", "java", "go", "rust", "c", "cpp", "csharp", "sql",
  "json", "yaml", "xml", "html", "css", "bash", "shell", "powershell", "markdown", "diff",
];

/** 正在显示的语言面板、它要改写的语言标记元素，以及面板的定位锚点（右上角语言按钮） */
let langPanelEl: HTMLElement | null = null;
let langPanelTarget: HTMLElement | null = null;
let langPanelAnchor: HTMLElement | null = null;

function onLangPanelPointerDown(event: MouseEvent): void {
  if (!langPanelEl) return;
  const target = event.target as Node | null;
  // 点面板内部（选语言）与点锚点按钮本身（等价于再次点开）都不算「点外面」
  if (target && (langPanelEl.contains(target) || langPanelAnchor?.contains(target))) return;
  closeLangPanel();
}

function onLangPanelKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeLangPanel();
}

function closeLangPanel(): void {
  if (!langPanelEl) return;
  langPanelEl.remove();
  document.removeEventListener("mousedown", onLangPanelPointerDown, true);
  document.removeEventListener("keydown", onLangPanelKeydown, true);
  langPanelEl = null;
  langPanelTarget = null;
  langPanelAnchor = null;
}

/** 语言按钮列表（语言名取自 highlight.js 的语言表，只含字母数字与 + - #，无需转义） */
function langButtonHTML(langs: string[]): string {
  return langs
    .map((lang) => `<button type="button" data-lang="${lang}">${lang}</button>`)
    .join("");
}

/**
 * 打开语言下拉面板。
 *
 * infoEl 是要改写的语言标记（span[data-type="code-block-info"]），anchor 是面板的定位
 * 锚点（代码块右上角的语言按钮）。面板 position: fixed 挂在 body 上，不受编辑器容器
 * overflow 裁剪；只在打开期间存在，不做常驻 DOM 注入。
 */
function openLangPanel(infoEl: HTMLElement, anchor: HTMLElement): void {
  const alreadyOpen = langPanelTarget === infoEl;
  closeLangPanel();
  if (alreadyOpen) return; // 再点一次同一个按钮 = 收起面板

  const current = infoEl.textContent?.replace(/\u200B/g, "").trim() ?? "";
  const registered = Object.keys(vditor?.vditor.options.preview?.hljs?.langs ?? {}).sort();
  const extra = registered.filter((lang) => !COMMON_LANGUAGES.includes(lang));

  const panel = document.createElement("div");
  panel.className = "md-studio-lang-panel";
  panel.innerHTML = `
    <input class="md-studio-lang-search" type="text" placeholder="搜索语言…" />
    <div class="md-studio-lang-list">
      ${langButtonHTML(COMMON_LANGUAGES)}
      <span class="md-studio-lang-sep"></span>
      ${langButtonHTML(extra)}
    </div>`;
  document.body.appendChild(panel);

  const search = panel.querySelector<HTMLInputElement>(".md-studio-lang-search");
  const list = panel.querySelector<HTMLElement>(".md-studio-lang-list");
  list?.addEventListener("click", (event) => {
    const lang = (event.target as Element | null)?.closest("button")?.getAttribute("data-lang");
    if (!lang) return;
    applyCodeLanguage(infoEl, lang);
    closeLangPanel();
  });
  search?.addEventListener("input", () => {
    const keyword = search.value.trim().toLowerCase();
    if (!list) return;
    for (const button of Array.from(list.querySelectorAll("button"))) {
      button.hidden = keyword !== "" && !(button.getAttribute("data-lang") ?? "").includes(keyword);
    }
    const separator = list.querySelector<HTMLElement>(".md-studio-lang-sep");
    if (separator) separator.hidden = keyword !== "";
  });

  // 定位到锚点正下方（右缘对齐，因为锚点在窗口右侧），并夹在视口内
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${Math.min(
    Math.max(4, rect.right - panel.offsetWidth),
    Math.max(4, window.innerWidth - panel.offsetWidth - 8),
  )}px`;
  panel.style.top = `${Math.min(rect.bottom + 4, Math.max(4, window.innerHeight - panel.offsetHeight - 8))}px`;

  langPanelEl = panel;
  langPanelTarget = infoEl;
  langPanelAnchor = anchor;
  document.addEventListener("mousedown", onLangPanelPointerDown, true);
  document.addEventListener("keydown", onLangPanelKeydown, true);

  // 高亮当前语言并滚进可视区，省得在长列表里找
  if (current && list) {
    const currentButton = Array.from(list.querySelectorAll<HTMLElement>("button")).find(
      (button) => button.getAttribute("data-lang") === current,
    );
    currentButton?.classList.add("current");
    currentButton?.scrollIntoView({ block: "nearest" });
  }
  search?.focus();
}

/**
 * 把代码块的语言改成 lang。
 *
 * 标记文本必须以 ZWSP 开头，这是 Vditor 对 code-block-info 的既有约定（Vditor 自己的
 * 语言补全与 Lute 的 IR 输出都带这个前缀，见 Constants.ZWSP）；丢掉它会让围栏语言
 * 变成空值。改完在 IR 根上派发一次 input 事件，让 Vditor 自己走
 * ir/input.ts 的流程——它会 SpinVditorIRDOM 重绘该块（源码行与预览镜像的
 * language-* 类名、预览高亮、wbr 光标还原一并更新），并回调 options.input
 * 通知应用层刷新 dirty / 字数 / 大纲。
 */
function applyCodeLanguage(infoEl: HTMLElement, lang: string): void {
  if (!ready || !vditor) return;
  infoEl.textContent = `\u200B${lang}`;
  const range = document.createRange();
  range.selectNodeContents(infoEl);
  range.collapse(false);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  vditor.vditor.ir?.element.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: lang }),
  );
  scheduleLineNumbers(200);
}

/**
 * 构造代码块右上角的「语言」按钮。
 *
 * 走 Vditor 官方钩子 preview.hljs.renderMenu（codeRender 每次渲染代码块都会回调一次），
 * 按钮被塞进复制按钮所在的 div.vditor-copy，因此和复制按钮一样是「悬停代码块才显示」，
 * 且每轮渲染自动重建，不需要自己监听 DOM 变化、也不会留下过期节点。
 *
 * 之所以不直接给 IR 的语言标记 span[data-type="code-block-info"] 挂点击：它未展开时被
 * Vditor 压成 0×0（.vditor-ir__node .vditor-ir__marker 的 width/height: 0），点不到。
 * WYSIWYG 的 DOM 里没有这个标记，故只在 IR 下提供入口。
 */
function langBadgeFor(codeEl: HTMLElement): HTMLElement | null {
  const infoEl =
    codeEl.closest('[data-type="code-block"]')?.querySelector<HTMLElement>('[data-type="code-block-info"]') ??
    null;
  if (!infoEl) return null;

  const badge = document.createElement("span");
  badge.className = "md-studio-lang-badge";
  badge.textContent = infoEl.textContent?.replace(/\u200B/g, "").trim() || "语言";
  badge.title = "选择代码块语言";
  // 拦掉 mousedown/click：否则 IR 的点击处理会把光标送进代码块并把该块展开
  badge.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  badge.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openLangPanel(infoEl, badge);
  });
  return badge;
}

/** 在 IR 根上做一次事件委托：点代码块的语言标记也弹语言面板（未展开时点不到，属补充入口） */
function attachCodeLanguagePicker(): void {
  const root = vditor?.vditor.ir?.element;
  if (!root) return;
  root.addEventListener("click", (event) => {
    const infoEl = (event.target as Element | null)?.closest<HTMLElement>(
      '[data-type="code-block-info"]',
    );
    if (infoEl) openLangPanel(infoEl, infoEl);
    else closeLangPanel();
  });
}

/** 初始化编辑器并挂载到指定 DOM 元素（dark：初始主题，由应用统一决策） */
export async function initEditor(el: HTMLElement, initialValue: string, dark: boolean): Promise<void> {
  ready = false;
  readyPromise = new Promise((resolve) => {
    readyResolve = resolve;
  });
  lineNumberSource = initialValue;

  // readyPromise 已在上方同步赋值：await 期间 whenEditorReady() 拿到的也是这份挂起的承诺
  const Vditor = await ensureVditor();

  vditor = new Vditor(el, {
    mode: "ir",
    lang: editorLang,
    value: initialValue,
    height: "100%",

    // 运行时资源全部走随包内置目录（见 CDN_PATH 注释），不再联网
    cdn: CDN_PATH,

    // 文档内容由应用自己管理（打开/保存），禁用 Vditor 的 localStorage 缓存，
    // 避免刷新后内容与当前文件状态不一致
    cache: { enable: false },

    theme: dark ? "dark" : "classic",
    preview: {
      theme: { current: dark ? "dark" : "light", path: CONTENT_THEME_PATH },
      // Vditor 默认在分屏预览（SV）的预览区右上角渲染一条动作栏：
      // ["desktop", "tablet", "mobile", "mp-wechat", "zhihu"]，即设备宽度切换与
      // 「复制到公众号/知乎」。桌面端不需要这些，置空后 Vditor 直接 return，整条不渲染。
      actions: [],
      // lineNumber: true 会让 IR 的代码块预览镜像（<pre class="vditor-ir__preview">）带上
      // 行号与复制按钮：Vditor 每次输入后都会对该镜像重跑 highlightRender + codeRender，
      // 而这两者的跳过条件是父元素含 vditor-ir__marker--pre——源码行满足、预览镜像不满足。
      // 源码行因此不会被重复加行号。
      // renderMenu 是 codeRender 给复制按钮那一格的官方注入点，用它加「语言」按钮。
      hljs: {
        style: dark ? "github-dark" : "github",
        lineNumber: true,
        renderMenu: (codeEl: HTMLElement, menuEl: HTMLElement) => {
          const badge = langBadgeFor(codeEl);
          if (badge) menuEl.appendChild(badge);
        },
      },

      // Vditor 默认关闭的 Markdown 能力，这里全部开启：
      // mark 高亮 ==文字==、sup 上标 ^文字^、sub 下标 ~文字~、toc 目录标记 [toc]
      // autoSpace 中英文之间自动补空格、paragraphBeginningSpace 段首空两格
      // fixTermTypo 自动矫正术语、imageCaption 独占段落的图片 title 转为图片说明
      // listStyle 列表加标记（供自定义列表样式使用）
      // sanitize 保持默认 true，不过滤掉 XSS 就不安全了
      markdown: {
        mark: true,
        sup: true,
        sub: true,
        toc: true,
        autoSpace: true,
        paragraphBeginningSpace: true,
        fixTermTypo: true,
        imageCaption: true,
        listStyle: true,
      },
    },

    // 图片插入：桌面端没有上传服务器，upload.handler 把图片落盘到「文档同级 assets
    // 目录」，正文只写相对路径（见 insertLocalImages）。不设 handler 时 Vditor 会走
    // url 上传分支，而 url 为空只会弹 "please config: options.upload.url"。
    upload: { accept: "image/*", handler: insertLocalImages },

    // 扁平数组 + "|" 分隔符（Vditor 类型定义仅接受扁平 MenuItem 列表）。
    // tipPosition 统一为 "se"（按钮右下方）：Vditor 默认的 "ne" 把提示气泡放在按钮上方，
    // 而工具栏是 main 的首个子元素、main 又设了 overflow: hidden，气泡会被整体裁掉看不见。
    // 传对象而非字符串时 Vditor 会与内置默认项合并（图标、前后缀等照旧保留）。
    // 公式 / Mermaid 是自定义项（Vditor 工具栏没有这两项），必须自行给出 icon 与 click。
    toolbar: [
      "headings", "bold", "italic", "strike", "|",
      "list", "ordered-list", "check", "indent", "outdent", "|",
      "quote", "line", "code", "inline-code", "|",
      "link", "upload", "table", "emoji", "|",
      { name: "insert-math", tip: "行间公式", tipPosition: "se", icon: MATH_ICON, click: insertMathBlock },
      { name: "insert-mermaid", tip: "Mermaid 图", tipPosition: "se", icon: MERMAID_ICON, click: insertMermaidBlock },
      "|",
      "undo", "redo", "|",
      "edit-mode", "fullscreen",
    ].map((item) =>
      typeof item === "string" ? (item === "|" ? item : { name: item, tipPosition: "se" }) : item,
    ),

    // 异步渲染完成（此时内容、工具栏、Lute 实例均已就绪），唤醒等待方
    after: () => {
      ready = true;
      readyResolve?.();
      readyResolve = null;
      expandEmojiSet();
      attachLineNumbers();
      attachCodeLanguagePicker();
      // 启动前读到的用户设置此刻才有正文元素可用（打字机模式要设选项、聚光灯要挂遮罩）
      setTypewriterMode(typewriterMode);
      attachSpotlight();
      // 编辑器就绪前就收到的大文档：此刻才有 Lute 实例与容器可用
      if (largePending && largeSource !== null) {
        largePending = false;
        ensureLargeReader()?.load(largeSource);
        lineNumberSource = largeReader?.sourceText ?? largeSource;
        largeModeListener?.(true);
        attachLineNumbers();
        attachSpotlight();
      }
      scheduleImageResolve(0);
      // 应用可能在编辑器就绪前就已进入阅读模式（启动即打开文件），这里补一次
      applyReadonlyState();
    },

    input: (value: string) => {
      changeListener?.(value);
      lineNumberSource = value;
      scheduleLineNumbers();
      scheduleSpotlight();
      // Vditor 每轮输入都会重绘 IR，img.src 会被重置回 Markdown 里的相对路径
      scheduleImageResolve(250);
    },
  });
}

/** 等待编辑器初始化完成（读写内容前必须调用，见 ready 注释） */
export function whenEditorReady(): Promise<void> {
  return readyPromise;
}

/**
 * 编辑器界面语言（批次八）：Vditor 的 lang 只接受 zh_CN / en_US 这套写法。
 *
 * 已初始化时同步改 options.lang——此后 Vditor 运行时新建的界面
 * （输入提示、表情面板、tip 消息等）用新语言；工具栏按钮的气泡提示
 * 是初始化时一次性写入 DOM 的，需重启后更新（设置面板里有说明）。
 */
export function setEditorLocale(lang: "zh_CN" | "en_US"): void {
  editorLang = lang;
  if (!ready || !vditor) return;
  vditor.vditor.options.lang = lang;
}

/**
 * 运行时切换主题（阶段 7 引入，阶段 10 修复）。
 *
 * Vditor 的签名为 setTheme(theme, contentTheme, codeTheme, contentThemePath)。
 * 历史实现把 contentTheme 传成了 undefined，导致 Vditor 不会替换
 * <link id="vditorContentTheme">，正文文字颜色停留在切换前的主题
 * （深色底 + 深色字）。此处按正确位置传参，切换即时生效。
 */
export function setEditorTheme(dark: boolean): void {
  if (!ready || !vditor) return;
  vditor.setTheme(dark ? "dark" : "classic", dark ? "dark" : "light", dark ? "github-dark" : "github");
}

/** 阅读排版设置（仅 Markdown / 纯文本文档生效）。每项都可省略，省略即沿用 Vditor 默认样式 */
export type ReaderStyle = {
  /** CSS font-family 值 */
  fontFamily?: string;
  /** CSS font-size 值，如 "18px" */
  fontSize?: string;
  /** 无单位行距倍数，如 "1.8" */
  lineHeight?: string;
  /** 正文字色 */
  textColor?: string;
  /** 正文区底色（护眼背景） */
  background?: string;
};

/** 阅读排版样式表的节点 id：内容随设置重建 */
const READER_STYLE_ID = "md-studio-reader-style";

/** 排版作用目标：三种模式的正文 + SV 模式右侧的渲染结果栏 + 大文档阅读通路的分节容器 */
const READER_TEXT_TARGETS = [
  ".vditor-ir > pre.vditor-reset",
  ".vditor-wysiwyg > pre.vditor-reset",
  ".vditor-sv",
  ".vditor-preview > .vditor-reset",
  ".md-large-reader__body",
];

/** 底色要多盖一层容器：正文元素与左右分栏各有自己的底色，只改正文会从缝隙里露出 Vditor 默认的浅灰 */
const READER_SURFACE_TARGETS = [
  ".vditor-content",
  ".vditor-ir > pre.vditor-reset",
  ".vditor-wysiwyg > pre.vditor-reset",
  ".vditor-sv",
  ".vditor-preview",
  ".md-large-reader",
  ".md-large-reader__body",
];

/**
 * 应用阅读排版设置（字体 / 字号 / 行距 / 文字色 / 护眼底色）。
 *
 * 用 JS 生成样式表而不是写死在 app.css 里，是因为每项都是可选的：只有用户真正改过的项
 * 才该产生声明。写死就得替「默认」造一个与 Vditor 原始值完全等价的值，可 Vditor 的默认
 * 行高在 IR / SV 等模式下各不相同，CSS 无法表达「这一项不参与覆盖」。设置全为空时直接
 * 移除样式节点，编辑器即回到原样。
 *
 * 声明一律带 !important：Vditor 初始化时把自带样式表追加到 head 末尾，同特异性的规则
 * 它后出现，会赢过应用侧的静态样式。
 *
 * 选择器只覆盖编辑器正文（HTML 文档的预览走沙箱 iframe、源码走纯 textarea，都不经过
 * 这些元素），调用侧还会在 HTML 文档下直接传空设置，双保险确保不影响自带颜色的 HTML。
 */
export function setReaderStyle(style: ReaderStyle): void {
  const rules: string[] = [];
  const add = (targets: string[], prop: string, value: string | undefined): void => {
    if (!value) return;
    rules.push(`${targets.join(",\n")} {\n  ${prop}: ${value} !important;\n}`);
  };
  add(READER_TEXT_TARGETS, "font-family", style.fontFamily);
  add(READER_TEXT_TARGETS, "font-size", style.fontSize);
  add(READER_TEXT_TARGETS, "line-height", style.lineHeight);
  add(READER_TEXT_TARGETS, "color", style.textColor);
  add(READER_SURFACE_TARGETS, "background-color", style.background);

  let el = document.getElementById(READER_STYLE_ID) as HTMLStyleElement | null;
  if (rules.length === 0) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = READER_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = rules.join("\n");
}

/** 获取当前 Markdown 源码（未就绪时返回空串，避免调用未建立的实例） */
export function getEditorValue(): string {
  if (largeSource !== null) return largeSource;
  return ready ? (vditor?.getValue() ?? "") : "";
}

// ---- 大文档阅读通路（性能优化：分节渐进渲染 + 视口外虚拟化）----
//
// Vditor 的 IR 会把整篇 Markdown 一次性转成可编辑 DOM，节点数随文件线性膨胀：
// 实测 486KB ≈ 3.5 万节点 / 主线程阻塞 28 秒，3MB ≈ 22 万节点 / 永久无响应，
// 而语法高亮只占约 3%、行号栏与侧边栏几乎不占。所以超过阈值的文档在阅读态改走
// LargeReader——只渲染视口附近的分节，打开即用、节点数恒定。只有用户显式进入
// 编辑模式时，才把整篇交给 Vditor（那份代价无法避免，故由应用层先给出提示）。

/** 大文档阅读通路里的 Markdown 源码；非 null 即表示当前走的是这条通路 */
let largeSource: string | null = null;
/**
 * 大文档通路是否按「纯文本」渲染正文（超大代码文件走这条）。
 *
 * Markdown 通路必须过 Lute；代码文件不能过——`#` 会被渲染成标题、`*` 会变强调。
 * 见 largeReader 的 `plain` 依赖项。
 */
let largePlain = false;
/** 当前 LargeReader 实例建立时用的 plain 值：与 largePlain 不一致就得重建（deps 是构造时注入的） */
let largeReaderPlain = false;
/** 当前文档是否属于「大文档」（超过阈值）：编辑模式往返时用它决定要不要恢复分节渲染 */
let largeCapable = false;
/** 编辑器就绪前就收到大文档：先记下来，等 after 回调再建阅读器 */
let largePending = false;
let largeReader: LargeReader | null = null;
let largeScroller: HTMLElement | null = null;
/** 通路开关通知：应用层据此把「阅读模式」状态与界面按钮对齐 */
let largeModeListener: ((active: boolean) => void) | null = null;
/** 视口附近分节挂载 / 卸载的通知（查找高亮登记的 Range 会随之失效） */
let largeRenderListener: (() => void) | null = null;

/** 注册大文档阅读通路的开关回调 */
export function onLargeModeChange(cb: (active: boolean) => void): void {
  largeModeListener = cb;
}

/** 注册「分节挂载 / 卸载」回调（大文档通路下查找高亮要据此重画） */
export function onLargeRenderChange(cb: (() => void) | null): void {
  largeRenderListener = cb;
}

/** 当前是否由大文档阅读通路渲染正文 */
export function isLargeDocMode(): boolean {
  return largeSource !== null;
}

/** 大文档通路下的整篇源码（分节拼接结果，与各分节的源码偏移同一坐标系）；非该通路返回 null */
export function getLargeSourceText(): string | null {
  if (largeSource === null) return null;
  return largeReader?.sourceText ?? largeSource;
}

/** 大文档通路下当前已挂载（DOM 里有真实内容）的分节 */
export function getLargeMountedSections(): MountedSection[] {
  return largeReader?.mountedSections() ?? [];
}

/** 把某处源码偏移所在的分节挂载出来（查找跨分节跳转用）；holdScroll 见 LargeReader */
export function revealLargeSourceOffset(offset: number, holdScroll = false): MountedSection | null {
  return largeReader?.revealSourceOffset(offset, holdScroll) ?? null;
}

/**
 * 把大文档通路里的一段 Range 滚到视口中部。
 *
 * 不能用 scrollIntoView：分节是一个整体，一节可能高达几万像素（纯文本没有标题也没有
 * 空行时就切成这么大的块），而 scrollIntoView 对齐的是「元素」，会把整节按 block:center
 * 摆一次——块比视口高得多时那一行根本不在视野里。这里按 Range 自己的矩形算差值。
 */
export function scrollLargeRangeIntoView(range: Range): void {
  const scroller = largeReader?.scroller;
  if (!scroller) return;
  // 分节高度是「用一节一节实测」逐步校准的：跳到目标分节后，紧随其后的 update() 会把
  // 目标前后的邻居一起挂载并实测，而实测高度与占位估算有出入，整段正文因此被推移
  // （实测偏差累计可达上千像素）。所以一次滚动到位过一会儿就偏了，必须连做几帧、
  // 每帧按 Range 当时的矩形重新对中，布局稳定后 delta 落到阈值内自然停手。
  const settle = (left: number): void => {
    // 目标分节可能被后续的 update() 卸载，Range 随之失效——此时绝不能按 0 矩形乱滚
    if (!range.startContainer.isConnected) return;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const box = scroller.getBoundingClientRect();
    const delta = rect.top + rect.height / 2 - (box.top + box.height / 2);
    if (Math.abs(delta) >= 2) scroller.scrollTop += delta;
    if (left > 1) requestAnimationFrame(() => settle(left - 1));
  };
  settle(4);
}

/** 给大文档阅读器里刚挂载的分节补二次渲染：代码高亮 / 复制按钮 / 公式 / Mermaid / 图片 */
function decorateLargeSection(el: HTMLElement): void {
  const v = vditor?.vditor;
  const preview = v?.options.preview;
  // vditor 非 null 蕴含 initEditor 已执行完，VditorCtor 必已加载
  if (!v || !preview || !VditorCtor) return;
  const hljs = preview.hljs;
  VditorCtor.highlightRender(hljs, el, CDN_PATH);
  VditorCtor.codeRender(el, hljs);
  VditorCtor.mathRender(el, { cdn: CDN_PATH, math: preview.math });
  if (el.querySelector("code.language-mermaid")) {
    VditorCtor.mermaidRender(el, CDN_PATH, v.options.theme ?? "classic");
  }
  resolveImagesIn(el);
}

/** 离屏 Mermaid 渲染的等待上限（毫秒）：首次要先注入 mermaid.min.js，放宽一些 */
const MERMAID_TIMEOUT_MS = 15000;

/**
 * 离屏把一段 Mermaid 源码渲染成 SVG（Word 导出嵌入图片用）。
 *
 * 复用编辑器的渲染通路，保证与预览里看到的版本、主题完全一致；
 * 代价是首次调用要先注入 `vditor/dist/js/mermaid/mermaid.min.js`，会明显慢一拍。
 *
 * Vditor 的渲染器是「按 .language-mermaid 定位、把 SVG 写回该元素 innerHTML」的异步实现，
 * 因此这里构造同样结构的代码块、调用后轮询等待 SVG 出现。
 * 超时或渲染失败（含语法错误）返回 null，调用方回落成代码块。
 */
export async function renderMermaidInto(
  host: HTMLElement,
  code: string,
): Promise<SVGSVGElement | null> {
  const ctor = await ensureVditor();

  const block = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.className = "language-mermaid";
  codeEl.textContent = code;
  block.appendChild(codeEl);
  host.appendChild(block);

  ctor.mermaidRender(host, CDN_PATH, vditor?.vditor.options.theme ?? "classic");

  const deadline = Date.now() + MERMAID_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const svg = codeEl.querySelector("svg");
    if (svg) return svg as SVGSVGElement;
    // Vditor 渲染失败时会把错误片段写回并把 data-processed 置为 true
    if (codeEl.getAttribute("data-processed") === "true") return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

/** 惰性创建大文档阅读器（挂在 .vditor-content 下，与 IR/SV/WYSIWYG 三个正文并列） */
function ensureLargeReader(): LargeReader | null {
  if (!ready || !vditor) return null;
  if (largeReader && largeReaderPlain === largePlain) return largeReader;
  // plain 值是构造时注入的 deps，换模式（Markdown ↔ 代码纯文本）必须整个重建
  if (largeReader) {
    largeReader.dispose();
    largeReader = null;
  }
  const v = vditor.vditor;
  // 必须挂在 .vditor-content 下（与 .vditor-ir / .vditor-preview 同为它的 flex 子项），
  // 而不是挂进 .vditor-ir 里：v.ir.element 本身就是那个 pre.vditor-reset，
  // 挂进去会被 .md-large-mode 的 display:none 一起隐藏（实测表现为整页空白）。
  const content = v.element.querySelector<HTMLElement>(".vditor-content");
  if (!content) return null;
  const scroller = document.createElement("div");
  // 正文留白沿用 Vditor 给 IR 正文算出来的那份（它按窗口尺寸动态写入内联 padding，
  // 复制过来才能让两条通路的正文左右边界完全对齐）。同样要在加 .md-large-mode
  // （会把 IR 隐藏）之前读。
  if (v.ir?.element) {
    const cs = getComputedStyle(v.ir.element);
    scroller.style.setProperty(
      "--md-large-pad",
      `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
    );
  }
  v.element.classList.add("md-large-mode");
  content.appendChild(scroller);
  largeScroller = scroller;
  const lute = v.lute as unknown as { Md2HTML(md: string): string } | undefined;
  largeReaderPlain = largePlain;
  largeReader = new LargeReader(scroller, {
    md2html: (md) => lute?.Md2HTML(md) ?? "",
    decorate: decorateLargeSection,
    plain: largePlain,
    onRender: () => largeRenderListener?.(),
  });
  return largeReader;
}

/** 切到大文档阅读通路（正文不再进 Vditor，这是「打开不卡死」的关键） */
function enterLargeMode(md: string): void {
  largeSource = md;
  lineNumberSource = md;
  detachLineNumbers();
  vditor?.setValue("");
  if (!ready) {
    largePending = true;
    return;
  }
  largePending = false;
  ensureLargeReader()?.load(md);
  // 行号按「分节拼接后的整篇源码」对齐：分节 div 上记的行号起点与它同一坐标系
  lineNumberSource = largeReader?.sourceText ?? md;
  largeModeListener?.(true);
  // 行号栏与段落聚焦在大文档通路下同样可用：两者都挂在分节滚动容器上
  attachLineNumbers();
  attachSpotlight();
}

/** 退出大文档阅读通路，回到 Vditor */
function exitLargeMode(): void {
  const was = largeSource !== null;
  largeSource = null;
  largePlain = false;
  largePending = false;
  if (largeReader) {
    largeReader.dispose();
    largeReader = null;
  }
  largeScroller?.remove();
  largeScroller = null;
  if (ready && vditor) vditor.vditor.element.classList.remove("md-large-mode");
  if (was) {
    largeModeListener?.(false);
    // 行号栏刚才挂在分节滚动容器上，回到 Vditor 必须重新挂（否则整栏消失）
    attachLineNumbers();
    scheduleLineNumbers(150);
  }
}

/**
 * 设置编辑器内容（打开文件 / 导入文档 / 替换全部后调用）。
 *
 * `plain` 只在超大代码文件时传 true：正文走分节阅读通路但不做 Markdown 转换，
 * 且不存在「切到编辑模式」的退路（App 层会挡下），因此进不来的 Vditor 通路无害。
 */
export function setEditorValue(value: string, plain = false): void {
  largePlain = plain;
  largeCapable = value.length > LARGE_DOC_BYTES;
  if (largeCapable) {
    enterLargeMode(value);
    return;
  }
  exitLargeMode();
  vditor?.setValue(value);
  lineNumberSource = value;
  scheduleLineNumbers(150);
  scheduleImageResolve(150);
  attachSvScrollSync(); // 换文档时渲染结果栏可能被重建，重新确认一次绑定
}

/**
 * 强制退出大文档阅读通路（切到代码 / HTML 视图时调用）。
 *
 * 代码视图是覆盖在 Vditor 之上的独立内核：不退出的话，上一个超大 Markdown 文档的
 * 分节阅读器会一直挂着（几千个占位 div + 整篇源码），`isLargeDocMode()` 也为真，
 * 于是阅读模式提示、行号栏挂点全都指向看不见的 Vditor。
 */
export function leaveLargeMode(): void {
  if (largeSource !== null) exitLargeMode();
}

/** 注册内容变更回调（用于 dirty 状态跟踪） */
export function onEditorChange(cb: (value: string) => void): void {
  changeListener = cb;
}

// ---- 以下为阶段 10「编辑 / 格式 / 视图」菜单所需的编辑能力 ----

/** 取 Vditor 工具栏项元素（工具栏项第 0 个子节点即可点击的动作按钮） */
function toolbarItem(type: string): HTMLElement | undefined {
  return vditor?.vditor.toolbar?.elements?.[type];
}

/** Vditor 三种渲染模式的正文元素（未激活的也留在 DOM 里，只是 display:none） */
function modeBodies(): HTMLElement[] {
  const v = vditor?.vditor;
  if (!v) return [];
  return [v.sv?.element, v.ir?.element, v.wysiwyg?.element].filter(Boolean) as HTMLElement[];
}

/**
 * 把 editorReadonly 落到 Vditor 上（走官方 disabled()/enable()）。
 *
 * disabled() 做两件事：把当前模式的正文元素 contenteditable 置 false，并给
 * EDIT_TOOLBARS + undo/redo/fullscreen/edit-mode 这些工具栏按钮加上
 * vditor-menu--disabled——Vditor 的点击处理器见到这个类就直接 return。
 *
 * 但「编辑模式切换」和「沉浸式全屏」属于视图操作，阅读模式下也该能用，
 * 所以随后把它们身上的置灰类去掉。
 *
 * 还有一条缝必须自己堵：disabled() 只作用于「当前」模式的正文元素，而其余两个
 * 模式的元素 contenteditable 仍是 true。阅读模式下用户点工具栏的「编辑模式」下拉
 * 切到 SV / WYSIWYG，落点正是那个没被锁的元素，正文立刻又能改（实测确认）。
 * 所以这里把三种模式的正文一起对齐到同一个只读状态。
 */
function applyReadonlyState(): void {
  if (!ready || !vditor) return;
  if (editorReadonly) {
    vditor.disabled();
    for (const name of ["edit-mode", "fullscreen"]) {
      toolbarItem(name)?.children[0]?.classList.remove("vditor-menu--disabled");
    }
  } else {
    vditor.enable();
  }
  for (const el of modeBodies()) {
    el.setAttribute("contenteditable", editorReadonly ? "false" : "true");
  }
}

/** 阅读模式专用：会改动正文的导出函数一律先过这道闸 */
function blockedByReadonly(): boolean {
  return editorReadonly;
}

/** 切换阅读模式（只读）。打开文档后由 App 置为 true。 */
export function setEditorReadonly(readonly: boolean): void {
  editorReadonly = readonly;
  // 从大文档阅读通路切到编辑模式：整篇交给 Vditor 渲染（应用层会先提示代价）
  if (!readonly && largeSource !== null) {
    const md = largeSource;
    exitLargeMode();
    vditor?.setValue(md);
    lineNumberSource = md;
    scheduleLineNumbers(150);
    scheduleImageResolve(150);
    attachLineNumbers();
  } else if (readonly && largeSource === null && largeCapable && ready) {
    // 编辑模式改完再切回阅读：重新走分节渲染。否则整篇 IR DOM 会一直留在页面上，
    // 几 MB 文档的那份内存与节点数就此常驻——正是「打开大文档卡顿」的根源。
    const md = vditor?.getValue() ?? "";
    if (md.length > LARGE_DOC_BYTES) enterLargeMode(md);
    else largeCapable = false;
  }
  applyReadonlyState();
}

/** 当前是否处于阅读模式 */
export function isEditorReadonly(): boolean {
  return editorReadonly;
}

/** 取编辑器正文根节点：查找/替换只在正文内检索，避免命中工具栏/下拉面板文案 */
export function getEditorContentElement(): HTMLElement | null {
  // 大文档阅读通路下，正文在 LargeReader 的分节容器里（只有视口附近的分节在 DOM 中）
  if (largeSource !== null) return largeReader?.content ?? null;
  const v = vditor?.vditor;
  if (!v) return null;
  if (v.currentMode === "ir") return v.ir?.element ?? null;
  if (v.currentMode === "wysiwyg") return v.wysiwyg?.element ?? null;
  return v.sv?.element ?? null;
}

/** 该元素自身是不是一个会滚动的容器（Vditor 里只有正文根节点设了 overflow） */
function isScrollContainer(el: HTMLElement): boolean {
  const overflowY = getComputedStyle(el).overflowY;
  return overflowY === "auto" || overflowY === "scroll";
}

/**
 * 取真正承担滚动的元素——滚动事件必须挂它，挂在正文根节点上收不到。
 *
 * SV 模式的滚动容器就是 `.vditor-sv` 自己；IR / WYSIWYG 的 `.vditor-ir` / `.vditor-wysiwyg`
 * 都不设 overflow（flex 撑满、内容溢出可见），实际滚动的是内层 `pre.vditor-reset`
 * （`.vditor-reset` 带 overflow:auto，`pre.vditor-reset` 又有 height:100%）。
 * 行号栏与聚光灯的几何换算仍以正文根节点为准，这里只用来接滚动事件。
 */
function scrollTargetOf(content: HTMLElement): HTMLElement {
  if (isScrollContainer(content)) return content;
  for (const child of Array.from(content.children)) {
    if (child instanceof HTMLElement && isScrollContainer(child)) return child;
  }
  return content;
}

/**
 * SV 分屏预览的左右滚动同步。
 *
 * Vditor 的 SV 模式把源码（左 `.vditor-sv`）与渲染结果（右 `.vditor-preview`）摆成两个
 * 并列、各自独立滚动的容器，滚动一边另一边不动，于是「左右两侧的行对不上」。这里让两栏
 * 按各自可滚动高度做比例换算互相带动：顶端与底端必然对齐，中间也按同一进度走。
 *
 * 给 scrollTop 赋值会再触发一次该元素的 scroll 事件，用 svSyncing 吃掉这一次回弹——
 * 只在目标位置确实变化时才置位，否则目标没动、事件不来，这个标记就会把用户的下一次
 * 真实滚动误吞。
 */
let svSyncSv: HTMLElement | null = null;
let svSyncPreview: HTMLElement | null = null;
let svSyncing = false;

function syncSvScroll(from: HTMLElement, to: HTMLElement): void {
  const fromMax = from.scrollHeight - from.clientHeight;
  const toMax = to.scrollHeight - to.clientHeight;
  if (fromMax <= 0 || toMax <= 0) return;
  const next = (from.scrollTop / fromMax) * toMax;
  if (Math.abs(next - to.scrollTop) < 1) return;
  svSyncing = true;
  to.scrollTop = next;
}

function onSvPaneScroll(which: "sv" | "preview"): void {
  if (!svSyncSv || !svSyncPreview) return;
  if (svSyncing) {
    svSyncing = false; // 这一发是自己赋值引起的回声，丢掉
    return;
  }
  if (which === "sv") syncSvScroll(svSyncSv, svSyncPreview);
  else syncSvScroll(svSyncPreview, svSyncSv);
}

const onSvScrollFromSource = (): void => onSvPaneScroll("sv");
const onSvScrollFromPreview = (): void => onSvPaneScroll("preview");

/** 绑定/解绑 SV 两栏的滚动同步（切模式与换文档后都要重新确认一次，元素可能被重建） */
function attachSvScrollSync(): void {
  const sv = (vditor?.vditor.sv?.element ?? null) as HTMLElement | null;
  // 渲染结果栏与 `.vditor-sv` 是 `.vditor-content` 下的兄弟节点
  const preview = sv?.parentElement?.querySelector<HTMLElement>(".vditor-preview") ?? null;
  if (!sv || !preview) return;
  if (svSyncSv === sv && svSyncPreview === preview) return;
  detachSvScrollSync();
  svSyncSv = sv;
  svSyncPreview = preview;
  sv.addEventListener("scroll", onSvScrollFromSource, { passive: true });
  preview.addEventListener("scroll", onSvScrollFromPreview, { passive: true });
}

function detachSvScrollSync(): void {
  svSyncSv?.removeEventListener("scroll", onSvScrollFromSource);
  svSyncPreview?.removeEventListener("scroll", onSvScrollFromPreview);
  svSyncSv = null;
  svSyncPreview = null;
  svSyncing = false;
}

/** 聚焦编辑器 */
export function focusEditor(): void {
  vditor?.focus();
}

/** 当前选中的文本 */
export function getEditorSelection(): string {
  return vditor?.getSelection() ?? "";
}

/** 删除当前选中内容（剪切） */
export function deleteEditorSelection(): void {
  if (blockedByReadonly()) return;
  vditor?.deleteValue();
}

/** 用给定内容替换当前选中内容（替换） */
export function replaceEditorSelection(text: string): void {
  if (blockedByReadonly()) return;
  vditor?.updateValue(text);
}

/** 在光标处插入内容（粘贴） */
export function insertEditorText(text: string): void {
  if (blockedByReadonly()) return;
  vditor?.insertValue(text);
}

/** 当前编辑模式 */
export function getEditorMode(): "sv" | "wysiwyg" | "ir" {
  return vditor?.getCurrentMode() ?? "ir";
}

/** 切换编辑模式（复用 Vditor 工具栏 edit-mode 下拉面板中的按钮） */
export function setEditorMode(mode: "sv" | "wysiwyg" | "ir"): void {
  if (largeSource !== null) return; // 大文档阅读通路下 Vditor 里没有正文，切模式只会切出一片空白
  toolbarItem("edit-mode")?.querySelector<HTMLElement>(`button[data-mode="${mode}"]`)?.click();
  // 三种模式的正文元素各不相同，等 Vditor 切换并重排完成后把行号栏、聚光灯挪到新的滚动容器上
  window.setTimeout(() => {
    attachLineNumbers();
    attachSpotlight();
    attachSvScrollSync(); // sv / wysiwyg 的正文元素是首次切过去才新建的，切到 SV 时补上同步
    scheduleImageResolve(0); // 换模式会按 Markdown 重新渲染，图片要重新换算 URL
    // Vditor 的 sv / wysiwyg / ir 三个正文元素是首次切换时才新建的，新建时一律
    // contenteditable="true"。阅读模式下切过去必须补一次只读，否则新模式的正文可改。
    applyReadonlyState();
  }, 0);
}

/** 应用行内/块级格式：type 取 Vditor 工具栏项名（bold/italic/strike/list/ordered-list/check/quote/code/inline-code/link/table） */
export function applyFormat(type: string): void {
  if (blockedByReadonly()) return;
  vditor?.focus();
  toolbarItem(type)?.children[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** 设置标题层级 1-6（复用 Vditor 标题下拉面板中的按钮，各模式通用） */
export function applyHeading(level: number): void {
  if (blockedByReadonly()) return;
  vditor?.focus();
  toolbarItem("headings")?.querySelector<HTMLElement>(`button[data-tag="h${level}"]`)?.click();
}

/**
 * 触发图片插入的系统文件选择框（格式菜单「插入图片」）。
 *
 * 复用工具栏 upload 项的隐藏 file input：该 input 覆盖在按钮上，真实点击本就落在它
 * 身上，而从菜单触发时只能直接点它，点按钮不会把事件转发给 input。
 */
export function insertLocalImage(): void {
  if (blockedByReadonly()) return;
  toolbarItem("upload")?.querySelector<HTMLInputElement>("input")?.click();
}

/**
 * 整列对齐当前表格（批次七，格式菜单「对齐整列」）。
 *
 * Vditor 的 IR 模式没有表格浮层，整列对齐只存在于快捷键 ⇧⌘L/C/R 里（内部是
 * setTableAlign + processAfterRender），且未导出，故派发等价按键走官方路径；
 * WYSIWYG 模式同样有这几个快捷键（内部点浮层按钮），一并走按键。
 * 返回 false 表示光标不在正文表格单元格内或当前模式不支持，调用方据此提示。
 */
export function alignTableColumn(type: "left" | "center" | "right"): boolean {
  const v = vditor?.vditor;
  if (blockedByReadonly()) return false;
  if (!ready || !v) return false;
  if (v.currentMode !== "ir" && v.currentMode !== "wysiwyg") return false;

  // 先确认光标确实落在正文的单元格里：不在表格内时这个按键会落到别的处理分支上
  const selection = window.getSelection();
  const start = selection?.rangeCount ? selection.getRangeAt(0).startContainer : null;
  const node = start?.nodeType === Node.TEXT_NODE ? start.parentElement : (start as Element | null);
  const cell = node?.closest?.("td, th") ?? null;
  const host = getEditorContentElement();
  if (!cell || !host || !host.contains(cell)) return false;

  const key = { left: "L", center: "C", right: "R" }[type];
  const element = v.currentMode === "ir" ? v.ir?.element : v.wysiwyg?.element;
  if (!element) return false;
  vditor?.focus();
  // Windows 上 Vditor 的 ⌘ 判定即 ctrlKey（compatibility.isCtrl）
  element.dispatchEvent(
    new KeyboardEvent("keydown", { key, code: `Key${key}`, ctrlKey: true, shiftKey: true, bubbles: true }),
  );
  return true;
}

/** 撤销 / 重做（复用 Vditor 工具栏 undo、redo 项） */
export function undoEditor(): void {
  if (blockedByReadonly()) return;
  toolbarItem("undo")?.children[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

export function redoEditor(): void {
  if (blockedByReadonly()) return;
  toolbarItem("redo")?.children[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** 切换 Vditor 的沉浸式全屏编辑（视图菜单，复用工具栏 fullscreen 项） */
export function toggleEditorFullscreen(): void {
  toolbarItem("fullscreen")?.children[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** 显示 / 隐藏 Vditor 自带工具栏（视图菜单） */
export function setEditorToolbarVisible(visible: boolean): void {
  const el = vditor?.vditor.toolbar?.element;
  if (el) el.style.display = visible ? "" : "none";
}

/**
 * 滚动到第 index 个标题（阶段 11：侧边栏大纲点击定位）。
 *
 * 编辑器各模式都把标题渲染成真实的 h1~h6 元素，故按顺序取第 index 个即可。
 * 解析出的大纲与 DOM 标题可能因边缘写法（如引用内的标题）错位，
 * 此时退化为按文字匹配，避免点错位置。
 */
export function scrollToHeading(index: number, text: string): void {
  // 大文档阅读通路：分节起点就是标题，由 LargeReader 直接定位并挂载对应分节
  if (largeSource !== null) {
    largeReader?.scrollToHeading(index, text);
    return;
  }
  const root = getEditorContentElement();
  if (!root) return;

  const normalize = (value: string | null) => (value ?? "").replace(/\s+/g, " ").trim();
  const headings = Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));

  let target = headings[index];
  if (!target || normalize(target.textContent) !== normalize(text)) {
    target = headings.find((h) => normalize(h.textContent) === normalize(text)) ?? target;
  }
  target?.scrollIntoView({ block: "start" });
}

// ---- 阶段 12：正文行号栏（视图菜单可开关）----

/** 行号栏宽度（px），与 app.css 的 .md-studio-linenumber-gutter 对应 */
const LINE_NUMBER_WIDTH = 44;

/** 行号栏与正文之间留出的间距（px） */
const LINE_NUMBER_GAP = 6;

/**
 * Vditor 的 IR 模式会给每个标题渲染 H1..H6 层级标签（`h1:before` 等，float + margin-left:-29px），
 * 它们落在正文左侧的同一条空白车道里。行号栏的右端必须停在标签左边，否则两三位数的行号
 * 会压到标签上（见 renderLineNumbers 与 app.css 的 .md-studio-linenumbers）。
 *
 * 29 是 Vditor 那个 -29px 偏移本身占掉的宽度，另加 LINE_NUMBER_GAP 的间距：
 * 行号栏右端退到「正文左边界 - 35」时，正好落在标签左侧 6px 处。
 */
const HEADING_LABEL_LANE = 29 + LINE_NUMBER_GAP;

/**
 * 让出标题标签车道后，行号栏至少要还剩这么宽才值得保留标签（px）。
 * 三位数行号（如「999」）在 30px 里仍放得下，所以不必为了凑满 LINE_NUMBER_WIDTH
 * 就把标签整个收起来——收起来会白丢一个标题层级提示。
 */
const MIN_NUMBER_WIDTH = 30;

/** 视口上下各多算这么高的内容（px）：滚动时按帧重算，留一点余量免得边滚边跳号 */
const LINE_NUMBER_MARGIN = 400;

/** 是否显示行号（默认显示，应用启动后按用户设置覆盖） */
let lineNumbersVisible = true;

/** 最近一次的正文源码：行号按源码行编号，要拿它把渲染行对回源码行 */
let lineNumberSource = "";

/** 行号栏与栏内的行容器（行号栏挂在滚动容器的父元素下，见 attachLineNumbers 注释） */
let gutterEl: HTMLElement | null = null;
let rowsEl: HTMLElement | null = null;

/** 当前已绑定滚动事件的滚动容器（三种编辑模式各有一个，切换时要换绑） */
let boundScroller: HTMLElement | null = null;

/** 重算行号的防抖句柄、滚动重算的帧句柄 */
let lineNumberTimer: number | null = null;
let lineNumberFrame = 0;

/** 本次待重算的排队时刻（见 scheduleLineNumbers：连续输入时不把重算一直往后推） */
let lineNumberQueuedAt = 0;

/** 正文结构变化的观察者（输入之外还有只改 DOM 不发事件的重排，见 attachLineNumbers） */
let lineNumberObserver: MutationObserver | null = null;

/** 行元素复用池：重算时只改文本与位置，避免频繁创建销毁节点 */
let rowPool: HTMLElement[] = [];

/** 视口坐标下的一行的盒 */
type LineBox = { top: number; height: number };

/** 一行行号的落点（相对正文容器顶端） */
type NumberedRow = {
  number: number;
  center: number;
  height: number;
};

/**
 * 一个「行单元」：渲染层里对应源码一行的东西。
 *
 * 软换行（宽度不够折出来的续行）没有自己的单元，所以不会被编号——这就是「按源码行
 * 编号」；元素内的字面换行（代码块里的每一行）各有一个单元，与源码行一一对应。
 */
type LineUnit = {
  /** 参与「渲染行 → 源码行」匹配的文字；空串表示靠 group 顺延 */
  text: string;
  /** 同一元素内的连续源码行共用组号（0 = 单行元素），组内按前一行的行号顺延 */
  group: number;
  /** 该行在视口中的盒；null 表示这一行在渲染层里看不到（不画行号） */
  box: LineBox | null;
  /**
   * 该行所在分节的源码起始行号（0 基）。
   *
   * 大文档通路的正文是虚拟化的分节：只有视口附近的分节在 DOM 里，整篇源码里
   * 从头顺序匹配根本对不上（第一屏的行会被当成源码第 1 行）。故带上分节起点，
   * 匹配游标每进一个新分节就重置到它的源码起点。普通通路为 null，行为不变。
   */
  base: number | null;
};

/** 滚动时不再平移，而是按帧重算：只有视口附近的行才测量与绘制，重算本身很便宜 */
function onLineNumberScroll(): void {
  if (lineNumberFrame !== 0) return;
  lineNumberFrame = window.requestAnimationFrame(() => {
    lineNumberFrame = 0;
    renderLineNumbers();
  });
}

function detachLineNumbers(): void {
  if (lineNumberTimer !== null) {
    clearTimeout(lineNumberTimer);
    lineNumberTimer = null;
  }
  if (lineNumberFrame !== 0) {
    window.cancelAnimationFrame(lineNumberFrame);
    lineNumberFrame = 0;
  }
  lineNumberObserver?.disconnect();
  lineNumberObserver = null;
  if (boundScroller) scrollTargetOf(boundScroller).removeEventListener("scroll", onLineNumberScroll);
  // 行号栏与标题层级标签共用左侧车道，收工时把这两个标记类一并摘掉（见 renderLineNumbers）
  gutterEl?.parentElement?.classList.remove("md-studio-linenumbers", "md-studio-linenumbers-roomy");
  gutterEl?.remove();
  gutterEl = null;
  rowsEl = null;
  rowPool = [];
  boundScroller = null;
}

/** 归一化用于「渲染行 ↔ 源码行」匹配：去掉空白、标点符号与零宽字符，忽略大小写 */
function normalizeForMatch(value: string): string {
  return value.replace(/[\s\p{P}\p{S}\p{Cf}]/gu, "").toLowerCase();
}

/**
 * Vditor 附加的辅助节点：行内语法标记（`# `、`- `、`> `）与挂在代码块上的复制按钮 / 语言按钮。
 *
 * 它们不是文档内容，但会把排版撑得很难看：标记是 inline-block + 0×0 + overflow:hidden，
 * 文字被裁掉看不见，可 Range 量出来的矩形仍是完整一行（标题的 `# ` 甚至落到标题下方 28px），
 * 拿它当行盒会让行号串行。测量与文字匹配都必须跳过。
 */
const TEXT_HELPER_SELECTOR = ".vditor-ir__marker, [class*='vditor-ir__marker--'], .vditor-copy";

/** 该文本节点是否属于上述辅助节点 */
function isHelperNode(node: Node): boolean {
  const parent = node.parentElement;
  return parent !== null && parent.closest(TEXT_HELPER_SELECTOR) !== null;
}

/** 元素里的一段可见文字：它在拼接结果（collectText 的 text）中从 start 处开始 */
type TextPart = { node: Text; start: number };

/**
 * 收集元素里的可见文字，并记下每段文字在拼接结果里的起始偏移（按行量盒要用）。
 *
 * 不能用 textContent：
 * - Vditor 的行内语法标记（`# `、`- `）与代码块上的复制/语言按钮不是正文，量出来还会串行；
 * - 代码块末尾额外挂着一个 display:none 的临时节点（.vditor-linenumber__temp），
 *   其文字是代码的最后一行，会把行数算多；
 * - 代码块后还插着一个只含零宽字符的占位 span，它会被当成一行文字，让末尾凭空多一个行号。
 * 前两者按节点跳过，后者按「去掉零宽字符后为空」跳过；被跳过的节点不计入偏移，
 * 所以 text 的偏移与 parts 始终对齐，可据此精确量出每一行自己的盒。
 */
function collectText(el: Element): { text: string; parts: TextPart[] } {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: TextPart[] = [];
  let text = "";
  let node = walker.nextNode() as Text | null;
  while (node) {
    const value = node.nodeValue ?? "";
    const hidden =
      isHelperNode(node) || node.parentElement?.closest(".vditor-linenumber__temp") !== null;
    if (!hidden && value.replace(/\p{Cf}/gu, "") !== "") {
      parts.push({ node, start: text.length });
      text += value;
    }
    node = walker.nextNode() as Text | null;
  }
  return { text, parts };
}

/** 取一段 Range 里第一个可见盒（被折叠的行首标记是 0×0，跳过） */
function firstVisibleBox(range: Range): LineBox | null {
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width > 0 && rect.height > 0) return { top: rect.top, height: rect.height };
  }
  return null;
}

/** 把拼接文字的字符偏移映射回某个文本节点及其节点内偏移（越界时夹到最后一段末尾） */
function locateText(
  parts: TextPart[],
  textLength: number,
  offset: number,
): { node: Text; offset: number } | null {
  if (parts.length === 0) return null;
  const at = Math.max(0, Math.min(offset, textLength));
  let part = parts[0];
  for (const candidate of parts) {
    if (candidate.start <= at) part = candidate;
    else break;
  }
  const inner = Math.max(0, Math.min(at - part.start, (part.node.nodeValue ?? "").length));
  return { node: part.node, offset: inner };
}

/**
 * 量出某一段文字自己的盒（取第一个可见矩形）。
 *
 * 关键：行号要对齐的是「行盒」，不是元素。标题、代码块、被软换行折过的大段落里，
 * 元素矩形是它内部所有行的并集，拿元素顶边加固定步长去推，越往下偏得越多
 * （小字号代码行的行距与首行字高并不相等，累积误差最明显）。
 * 这里按每行文字的字符区间单独量，每行都拿到自己的盒，就不会串行。
 *
 * 空行（代码块里的空行、只有标记的行）量不到矩形，返回 null，由调用方顺延兜底。
 */
function measureLineBox(
  parts: TextPart[],
  textLength: number,
  start: number,
  end: number,
): LineBox | null {
  if (end <= start) return null;
  const from = locateText(parts, textLength, start);
  const to = locateText(parts, textLength, end);
  if (!from || !to) return null;
  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    return null;
  }
  return firstVisibleBox(range);
}

/**
 * 行级元素：源码的一行在渲染层里就落在这些元素上（段落/标题/列表项/表格行/代码块预览）。
 *
 * `pre` 是给「超大代码文件 → 只读分节纯文本」用的：那种分节里只有一个 `<pre>`，
 * 整节原文都在里面（见 largeReader 的 plain 模式）。顺带也补上了既有缺口——大文档
 * 通路下 Md2HTML 产出的 `<pre><code>` 代码块此前完全拿不到行号。普通 Markdown 通路
 * 里代码块的外层是 `.vditor-ir__preview`（内含 `<pre>`），下面那条「只认最内层」的
 * 守卫会让二者等价，不会重复计数。
 */
const LINE_UNIT_SELECTOR =
  "p, h1, h2, h3, h4, h5, h6, li, tr, hr, blockquote, pre, .vditor-ir__preview";

/** 收集当前渲染结果里的全部行单元（按 DOM 顺序，即从上到下） */
function collectLineUnits(scroller: HTMLElement, band: { top: number; bottom: number }): LineUnit[] {
  const units: LineUnit[] = [];
  let group = 0;
  for (const el of Array.from(scroller.querySelectorAll<HTMLElement>(LINE_UNIT_SELECTOR))) {
    // 嵌套的行级元素（引用里的段落、列表项里的段落）只认最内层那个，否则同一源码行算两遍
    if (el.querySelector(LINE_UNIT_SELECTOR)) continue;
    const bounds = el.getBoundingClientRect();
    // 被折叠的行首标记、隐藏的源码行在渲染层里不占位，也就不该有行号
    if (bounds.width <= 0 || bounds.height <= 0) continue;

    const { text, parts } = collectText(el);
    const lines = text.split("\n");
    // 末尾那个空串是源码块收尾的换行，不是一行内容
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

    const computed = parseFloat(getComputedStyle(el).lineHeight);
    const fallbackHeight =
      Number.isFinite(computed) && computed > 0 ? computed : Math.min(bounds.height, 40);
    // 视口带之外的块不做逐行测量：量一行的盒要建 Range 并触发排版，整篇都量会明显掉帧。
    // 它们反正不会被画出来（renderLineNumbers 还按视口带过滤一次），这里只占个位置。
    const inBand = bounds.bottom >= band.top && bounds.top <= band.bottom;
    // 大文档通路：分节外层 div 上写着该节的源码起始行（见 largeReader 的 load）
    const srcLine = el.closest<HTMLElement>("[data-src-line]")?.dataset.srcLine;
    const base = srcLine === undefined ? null : Number(srcLine);

    if (lines.length <= 1) {
      const box = !inBand
        ? { top: bounds.top, height: fallbackHeight }
        : (measureLineBox(parts, text.length, 0, text.length) ?? {
            top: bounds.top,
            height: Math.min(bounds.height, fallbackHeight),
          });
      units.push({ text: lines[0] ?? "", group: 0, box, base });
      continue;
    }

    // 多行元素（代码块、被软换行折过的段落）：逐行量自己的盒；量不到的（空行）顺着上一行推
    group += 1;
    let offset = 0;
    let prev: LineBox | null = null;
    lines.forEach((line, index) => {
      const start = offset;
      offset += line.length + 1; // +1 是 split 掉的换行符
      const box = !inBand
        ? { top: bounds.top, height: fallbackHeight }
        : (measureLineBox(parts, text.length, start, start + line.length) ??
          (prev
            ? { top: prev.top + prev.height, height: prev.height }
            : { top: bounds.top, height: fallbackHeight }));
      prev = box;
      units.push({ text: index === 0 ? line : "", group, box, base });
    });
  }
  return units;
}

/** 归一化后的源码行缓存：滚动时每帧都要重新匹配，正则别重复跑 */
let normalizedCache: { source: string; lines: string[] } | null = null;

function normalizedSourceLines(source: string): string[] {
  if (normalizedCache === null || normalizedCache.source !== source) {
    normalizedCache = { source, lines: source.split(/\r\n|\r|\n/g).map(normalizeForMatch) };
  }
  return normalizedCache.lines;
}

/** 在源码行里从 from 开始找第一个与渲染文字相配的行（空行不参与匹配） */
function matchSourceLine(normalized: string[], from: number, text: string): number {
  const limit = Math.min(normalized.length, from + 400);
  for (let i = from; i < limit; i++) {
    const line = normalized[i];
    if (line === "") continue;
    // 双向前缀匹配：源码的一行可能被软换行折成多行，渲染的一块也可能合成多行源码
    if (line.startsWith(text) || text.startsWith(line)) return i;
    // 有序列表的行首编号（「1. 」里的 1）不是标点，归一化时留了下来；而它在渲染层被 Vditor
    // 收进 0×0 的标记节点、不参与文字匹配（见 collectText），于是这一类行永远对不上，
    // 整段列表会顺延到前面一行去。源码侧也去掉行首数字再比一次即可。
    const bulletless = line.replace(/^\d+/, "");
    if (bulletless !== "" && (bulletless.startsWith(text) || text.startsWith(bulletless))) return i;
  }
  return -1;
}

/** 从 from 起连续空行中的最后一个（空白段落占它，文档末尾的空行才不会少算一行） */
function lastBlankIndex(normalized: string[], from: number): number {
  let index = -1;
  for (let i = from; i < normalized.length && normalized[i] === ""; i++) index = i;
  return index;
}

/**
 * 给每个行单元定源码行号。
 *
 * 渲染行与源码行并非一一对应（空行不渲染、表格分隔行不渲染、一段可能折成多行），
 * 所以只能拿文字去源码里顺次对：对上的行号即该单元的行号，同时把游标推到它后面，
 * 保证整体单调递增。代码块这类多行元素内部直接用「上一行 + 1」顺延，最稳。
 */
function assignSourceLineNumbers(units: LineUnit[], normalized: string[]): number[] {
  const numbers: number[] = new Array(units.length).fill(0);
  let cursor = 0;
  let last = 0;
  let base: number | null = null;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    // 大文档通路：每进一个新分节把游标重置到该节的源码起始行。
    // DOM 里只有视口附近的几节，若不重置会把第二屏的内容当成源码开头来匹配。
    if (unit.base !== null && unit.base !== base) {
      base = unit.base;
      cursor = base;
      last = base;
    }
    if (unit.group !== 0 && last > 0 && units[i - 1]?.group === unit.group) {
      last += 1;
      numbers[i] = last;
      cursor = Math.max(cursor, last);
      continue;
    }
    const text = normalizeForMatch(unit.text);
    const index =
      text === "" ? lastBlankIndex(normalized, cursor) : matchSourceLine(normalized, cursor, text);
    if (index >= 0) {
      last = index + 1;
      numbers[i] = last;
      cursor = index + 1;
    } else if (last > 0) {
      // 文字对不上（纯图片段落、被改写的行等）：退回顺延，总比整段没行号强
      last += 1;
      numbers[i] = last;
      cursor = Math.max(cursor, last);
    }
  }
  return numbers;
}

/**
 * 把行号栏挂到当前滚动容器的父元素下。
 *
 * 不能直接挂在正文元素里，也不能用 CSS 给它留位置：Vditor 在初始化、切换模式、
 * 窗口缩放时都会给正文元素写内联的 padding 简写（initUI 的 setPadding），
 * CSS 的 padding-left 会被覆盖掉。故行号栏做成滚动容器的兄弟节点，
 * 每次重算时按正文实际的 paddingLeft 反推水平位置。
 */
function attachLineNumbers(): void {
  if (!lineNumbersVisible) return;
  // 大文档通路的滚动容器是分节阅读器自己（正文 root 是它内部那层带内边距的 div），
  // 行号栏要挂在滚动容器的父元素下，故这里按通路各取各的
  const scroller = largeSource !== null ? (largeReader?.scroller ?? null) : getEditorContentElement();
  const parent = scroller?.parentElement;
  if (!scroller || !parent) return;
  if (scroller === boundScroller && gutterEl) {
    renderLineNumbers();
    return;
  }
  detachLineNumbers();

  gutterEl = document.createElement("div");
  gutterEl.className = "md-studio-linenumber-gutter";
  rowsEl = document.createElement("div");
  rowsEl.className = "md-studio-linenumber-rows";
  gutterEl.appendChild(rowsEl);
  parent.appendChild(gutterEl);

  boundScroller = scroller;
  // 标记「行号栏已启用」：app.css 靠它决定要不要把标题层级标签让到行号左边（或收起）
  parent.classList.add("md-studio-linenumbers");
  scrollTargetOf(scroller).addEventListener("scroll", onLineNumberScroll, { passive: true });
  // 输入之外还有只改 DOM、不发 input 的重排（Vditor 重跑高亮、折叠行首标记等），
  // 单靠 input 事件会让行号停在旧位置，故直接盯着正文的结构变化。
  lineNumberObserver = new MutationObserver(() => scheduleLineNumbers());
  lineNumberObserver.observe(scroller, { childList: true, subtree: true, characterData: true });
  // 首帧排到下一拍再画：行号要拿整篇源码归一化一次（大文档是几 MB 文本），
  // 这一下不该堵在「打开文档」的路上，晚 120ms 出现完全看不出来。
  scheduleLineNumbers(120);
}

/**
 * 重算并渲染行号。
 *
 * 每次都重新测量（不再像早期实现那样用 translateY 平移）：行位置 = 行盒顶边到滚动容器
 * 顶端的视口距离（视口坐标 - 容器顶），只有视口带（上下各 LINE_NUMBER_MARGIN）内的行才绘制。
 * 行容器 rowsEl 固定在滚动容器顶端，行自身按这个「视口相对坐标」定位，滚动时按帧重跑——
 * 与聚光灯（updateSpotlight）同一套坐标，故滚动时行号必然跟着文本走。
 */
function renderLineNumbers(): void {
  if (!lineNumbersVisible || !rowsEl || !gutterEl || !boundScroller) return;
  const parent = gutterEl.parentElement;
  if (!parent) return;
  const scroller = boundScroller;
  const visibleHeight = scroller.clientHeight;
  if (visibleHeight <= 0) return;

  const parentRect = parent.getBoundingClientRect();
  const parentStyle = getComputedStyle(parent);
  const scrollerRect = scroller.getBoundingClientRect();
  // 行号落在正文的左内边距里：大文档通路的 padding 在正文 root（滚动容器的子元素）上，
  // 不能读滚动容器的 padding，否则算出来是 0、行号会压到正文上。
  const padSource = getEditorContentElement() ?? scroller;
  const padLeft = parseFloat(getComputedStyle(padSource).paddingLeft) || 0;

  // 行号栏与滚动容器是同一父元素下的绝对定位元素：坐标基准是父元素的内边距框，
  // 故用「父元素边框盒 + 边框宽」换算，避免拿行号栏自身位置当基准导致逐次左移
  const borderLeft = parseFloat(parentStyle.borderLeftWidth) || 0;
  const borderTop = parseFloat(parentStyle.borderTopWidth) || 0;
  const scrollerLeft = scrollerRect.left - parentRect.left - borderLeft;
  const scrollerTop = scrollerRect.top - parentRect.top - borderTop;
  // 行号栏整体落在正文左内边距里，右端与正文保持 LINE_NUMBER_GAP 的间距。
  // 但正文行首往左还有 Vditor 的标题层级标签（H1..H6），行号栏不能压上去：
  // 让出标签车道后行号还剩得下 MIN_NUMBER_WIDTH 时，栏整体左移把标签留住；
  // 实在挤不下才收起标签（app.css 的 .md-studio-linenumbers:not(.md-studio-linenumbers-roomy)），
  // 宁可少一个视觉提示，也不能让行号与标签叠在一起。
  const room = scrollerLeft + padLeft - LINE_NUMBER_GAP;
  const laneRoom = room - HEADING_LABEL_LANE;
  // 大文档通路的正文由 Lute 的 Md2HTML 直出，没有 Vditor 的标题层级标签，不必让车道
  const keepHeadingLabels = largeSource === null && laneRoom >= MIN_NUMBER_WIDTH;
  parent.classList.toggle("md-studio-linenumbers-roomy", keepHeadingLabels);
  const available = keepHeadingLabels ? laneRoom : room;
  const gutterWidth = Math.max(0, Math.min(LINE_NUMBER_WIDTH, available));
  gutterEl.style.height = `${visibleHeight}px`;
  gutterEl.style.width = `${gutterWidth}px`;
  gutterEl.style.left = `${available - gutterWidth}px`;
  rowsEl.style.top = `${scrollerTop}px`;

  const lineHeight = parseFloat(getComputedStyle(padSource).lineHeight) || 24;
  const bandTop = scrollerRect.top - LINE_NUMBER_MARGIN;
  const bandBottom = scrollerRect.bottom + LINE_NUMBER_MARGIN;

  const units = collectLineUnits(scroller, { top: bandTop, bottom: bandBottom });
  const numbers = assignSourceLineNumbers(units, normalizedSourceLines(lineNumberSource));

  const rows: NumberedRow[] = [];
  for (let i = 0; i < units.length; i++) {
    const number = numbers[i];
    const box = units[i].box;
    if (number <= 0 || !box) continue;
    if (box.top + box.height < bandTop || box.top > bandBottom) continue;
    const center = box.top - scrollerRect.top + box.height / 2;
    const last = rows[rows.length - 1];
    // 行号只增不减；同一可见行（刚重排时新旧盒顶边只差几像素）只留一个。
    // 空行不给号：它在渲染层里没有文字行，硬塞进行间距只会和相邻行号挤在一起。
    if (last && (number <= last.number || center - last.center < lineHeight * 0.5)) continue;
    rows.push({ number, center, height: box.height });
  }

  for (let i = 0; i < rows.length; i++) {
    let row = rowPool[i];
    if (!row) {
      row = document.createElement("span");
      row.className = "md-studio-linenumber-row";
      rowPool[i] = row;
      rowsEl.appendChild(row);
    }
    row.textContent = String(rows[i].number);
    row.style.top = `${rows[i].center - rows[i].height / 2}px`;
    row.style.height = `${rows[i].height}px`;
    if (row.style.display === "none") row.style.display = "";
  }
  for (let i = rows.length; i < rowPool.length; i++) {
    if (rowPool[i].style.display !== "none") rowPool[i].style.display = "none";
  }
}

/**
 * 延后重算行号（输入、结构变化后调用，避开 Vditor 自身的重排节奏）。
 *
 * 用防抖是为了不被重排打断到算出错的位置，但不能纯粹防抖：一直打字时每次重排都会
 * 重新计时，最下面的行号会一直停在旧位置。故排队超过 MAX_WAIT 就先画一版，
 * 保证「加了一行 / 删了一行」很快就能反映出来。
 */
function scheduleLineNumbers(delay = 60): void {
  if (!lineNumbersVisible) return;
  const now = performance.now();
  if (lineNumberTimer !== null) {
    if (now - lineNumberQueuedAt < 180) return; // 还在等待窗口内，接着等更稳的位置
    clearTimeout(lineNumberTimer);
  }
  lineNumberQueuedAt = now;
  lineNumberTimer = window.setTimeout(() => {
    lineNumberTimer = null;
    renderLineNumbers();
  }, delay);
}

/** 显示 / 隐藏行号（视图菜单；默认显示） */
export function setLineNumbersVisible(visible: boolean): void {
  lineNumbersVisible = visible;
  if (visible) attachLineNumbers();
  else detachLineNumbers();
}

// 窗口缩放会改变正文宽度与 Vditor 重写的 padding，行号栏与聚光灯的位置都要跟着重算
// （稍晚于 Vditor 的 setPadding，避免读到旧值）
window.addEventListener("resize", () => {
  scheduleLineNumbers(80);
  scheduleSpotlight();
});

/**
 * 光标进出标题/代码块等「可展开节点」时，Vditor 把行首标记由隐藏改为行内显示
 * （或反之），正文可能因此重新折行，而这类布局变化不触发 input 事件。
 * 故监听选区变化补一次重算，保证行号与聚光灯都始终与可见内容对齐。
 */
document.addEventListener("selectionchange", () => {
  scheduleSpotlight(); // 段落聚焦要在行号关闭时也能用，故不跟着下面的行号开关走
  if (!lineNumbersVisible || !boundScroller) return;
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  if (!boundScroller.contains(selection.getRangeAt(0).startContainer)) return;
  scheduleLineNumbers();
});

// ---- 批次二：打字机模式与段落聚焦（视图菜单可开关）----

/** 打字机模式开关：光标行始终停在视口垂直中线（默认关闭） */
let typewriterMode = false;

/**
 * 打字机模式（Vditor 官方选项）。
 *
 * 这里只改选项 + 派发一次 resize：Vditor 的 resize 回调会重跑 setTypewriterPosition
 * 算出 --editor-bottom（正文末尾那半屏占位），真正把光标行推到中线的是它自己的
 * scrollCenter（每次输入 / 移动光标时执行）。所以绝不能在这里自己改 scrollTop，
 * 否则会与它的计算互相打架（推一下又被它拉回去）。
 */
export function setTypewriterMode(enabled: boolean): void {
  typewriterMode = enabled;
  if (!ready || !vditor) return;
  const v = vditor.vditor;
  v.options.typewriterMode = enabled;
  // 关掉时要自己清掉那份占位高度：setTypewriterPosition 在选项为假时直接返回，
  // 留着旧值会让正文末尾凭空多出半屏空白，怎么滚都滚不到底。
  if (!enabled) getEditorContentElement()?.style.removeProperty("--editor-bottom");
  window.dispatchEvent(new Event("resize"));
}

/** 段落聚焦（聚光灯）开关：只亮当前编辑块，其余内容压暗（默认关闭） */
let paragraphFocusVisible = false;

/**
 * 聚光灯的裁剪容器与遮罩本体，挂在滚动容器的父元素下、与行号栏同级。
 *
 * 分两层是因为压暗靠的是一条 9999px 的 box-shadow：没有外层 overflow:hidden 的话，
 * 它会越过编辑器把工具栏、菜单栏一并压暗（.vditor-ir 与 .vditor-content 都不裁剪）。
 */
let spotlightClipEl: HTMLElement | null = null;
let spotlightEl: HTMLElement | null = null;

/** 聚光灯自己记的滚动容器（不借用行号栏的 boundScroller：行号关闭时它是 null） */
let spotlightScroller: HTMLElement | null = null;

/** 待重算聚光灯的帧句柄（0 表示没有排队） */
let spotlightFrame = 0;

/** 滚动时按帧重算：只有视口附近段落的盒在变，重算本身很便宜 */
function onSpotlightScroll(): void {
  scheduleSpotlight();
}

/**
 * 挂上聚光灯（已挂在同一个滚动容器上则只重算一次位置）。
 *
 * 与行号栏一样挂在滚动容器的父元素下：Vditor 会给正文元素写内联 padding 简写，
 * 把遮罩放进正文里会被它覆盖，且聚光灯本来就不该参与正文的 DOM 结构。
 */
function attachSpotlight(): void {
  if (!paragraphFocusVisible) return;
  // 与行号栏一样：大文档通路的滚动容器是分节阅读器自己
  const scroller = largeSource !== null ? (largeReader?.scroller ?? null) : getEditorContentElement();
  const parent = scroller?.parentElement;
  if (!scroller || !parent) return;
  if (spotlightClipEl && spotlightScroller === scroller) {
    updateSpotlight();
    return;
  }
  detachSpotlight();

  spotlightClipEl = document.createElement("div");
  spotlightClipEl.className = "md-studio-spotlight-clip";
  spotlightEl = document.createElement("div");
  spotlightEl.className = "md-studio-spotlight";
  spotlightClipEl.appendChild(spotlightEl);
  parent.appendChild(spotlightClipEl);

  spotlightScroller = scroller;
  scrollTargetOf(scroller).addEventListener("scroll", onSpotlightScroll, { passive: true });
  updateSpotlight();
}

function detachSpotlight(): void {
  if (spotlightFrame !== 0) {
    window.cancelAnimationFrame(spotlightFrame);
    spotlightFrame = 0;
  }
  if (spotlightScroller) {
    scrollTargetOf(spotlightScroller).removeEventListener("scroll", onSpotlightScroll);
  }
  spotlightClipEl?.remove();
  spotlightClipEl = null;
  spotlightEl = null;
  spotlightScroller = null;
}

/**
 * 当前编辑块在视口坐标系里的矩形（top / height）——聚光灯亮带就是它。
 *
 * IR 渲染层里每个块级节点都带 data-block（Lute 的 Md2VditorIRDOM 输出：标题、段落、
 * 列表、引用、代码块都有，列表项自身没有、其外层的 ul 有），取最近的 [data-block] 祖先
 * 即可。取不到（光标落在编辑器根节点上）就退回到「滚动容器的直接子元素」。
 */
function currentBlockBand(): { top: number; height: number } | null {
  const scroller = spotlightScroller;
  if (!scroller) return null;
  // 大文档通路的正文没有光标（只读的分节），「当前块」改为跟着视口中线走：
  // 读到哪儿亮哪儿，与阅读这个动作本身对齐。
  if (largeSource !== null) return bandNearViewportCenter(scroller);
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const node = selection.getRangeAt(0).startContainer;
  if (!scroller.contains(node)) return null;
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!start || start === scroller) return null;
  const block = start.closest("[data-block]");
  if (block && block !== scroller && scroller.contains(block)) return block.getBoundingClientRect();
  let el: HTMLElement | null = start instanceof HTMLElement ? start : start.parentElement;
  while (el && el.parentElement !== scroller) el = el.parentElement;
  return el ? el.getBoundingClientRect() : null;
}

/**
 * 大文档通路下的聚焦带：视口中线所在的那个块级元素（没有则取离中线最近的一个）。
 *
 * 分节正文里一行一行的块就是段落的自然单位；比拿光标位置可靠的唯一原因是这里没有光标。
 * 但纯文本 / 日志通篇没有空行时，一整节在 Markdown 里就是一个段落（一个 `<p>` 里全是
 * `<br>` 分隔的行），整块比视口还高——照搬「亮出整块」等于整屏都不压暗，段落聚焦就白开了。
 * 故块高于视口时退化成「中线所在的那一行」，那才是阅读时眼睛真正停留的单位。
 */
function bandNearViewportCenter(scroller: HTMLElement): { top: number; height: number } | null {
  const rect = scroller.getBoundingClientRect();
  if (rect.height <= 0) return null;
  const probe = rect.top + rect.height / 2;
  let best: HTMLElement | null = null;
  let bestGap = Infinity;
  for (const el of Array.from(scroller.querySelectorAll<HTMLElement>(LINE_UNIT_SELECTOR))) {
    // 嵌套的行级元素只认最内层那个，否则整段引用 / 列表会一起亮起来
    if (el.querySelector(LINE_UNIT_SELECTOR)) continue;
    const box = el.getBoundingClientRect();
    if (box.height <= 0) continue;
    if (box.top <= probe && box.bottom >= probe) {
      best = el;
      break;
    }
    const gap = Math.min(Math.abs(box.top - probe), Math.abs(box.bottom - probe));
    if (gap < bestGap) {
      bestGap = gap;
      best = el;
    }
  }
  if (!best) return null;
  const box = best.getBoundingClientRect();
  if (box.height > rect.height) {
    const line = lineBandIn(best, probe);
    if (line) return line;
  }
  return { top: box.top, height: box.height };
}

/**
 * 块内「纵坐标 y 落在哪一行」的矩形。
 *
 * 这类块由若干文本节点组成、节点之间用 `<br>` 分隔，纵向必然有序且互不重叠，故可二分定位，
 * 免得整块逐行测量（一节几百行，滚动时每帧全量测量会明显掉帧）。取整行而不是单个字符的盒，
 * 长行折行时整行矩形天然覆盖折下来的那几行。
 */
function lineBandIn(block: HTMLElement, y: number): { top: number; height: number } | null {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    if (text.data.trim() !== "") nodes.push(text);
  }
  if (nodes.length === 0) return null;
  const range = document.createRange();
  const boxOf = (text: Text): DOMRect => {
    range.selectNodeContents(text);
    return range.getBoundingClientRect();
  };
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (boxOf(nodes[mid]!).bottom < y) lo = mid + 1;
    else hi = mid;
  }
  const box = boxOf(nodes[lo]!);
  if (box.height <= 0) return null;
  return { top: box.top, height: box.height };
}

function updateSpotlight(): void {
  if (!paragraphFocusVisible || !spotlightEl || !spotlightClipEl || !spotlightScroller) return;
  const parent = spotlightClipEl.parentElement;
  if (!parent) return;
  const scroller = spotlightScroller;
  // 与 renderLineNumbers 同一套坐标换算：绝对定位的基准是父元素的内边距框，
  // 故用「父元素边框盒 + 边框宽」把视口坐标换成父元素内边距框坐标。
  const parentRect = parent.getBoundingClientRect();
  const parentStyle = getComputedStyle(parent);
  const borderLeft = parseFloat(parentStyle.borderLeftWidth) || 0;
  const borderTop = parseFloat(parentStyle.borderTopWidth) || 0;
  const scrollerRect = scroller.getBoundingClientRect();

  // 裁剪容器正好盖住正文可视区，巨幅 box-shadow 再大也只会作用在正文区域内
  spotlightClipEl.style.left = `${scrollerRect.left - parentRect.left - borderLeft}px`;
  spotlightClipEl.style.top = `${scrollerRect.top - parentRect.top - borderTop}px`;
  spotlightClipEl.style.width = `${scrollerRect.width}px`;
  spotlightClipEl.style.height = `${scrollerRect.height}px`;

  const band = currentBlockBand();
  if (!band) {
    spotlightEl.style.display = "none";
    return;
  }
  // 遮罩盖满正文整幅宽度，只留当前块所在的一条横带不压暗；块比视口还高时横带超出裁剪区，
  // 效果就是整屏都不压暗——那正是大文档通路里要避免的，故那边已把带收到「当前行」
  if (spotlightEl.style.display === "none") spotlightEl.style.display = "";
  spotlightEl.style.top = `${band.top - scrollerRect.top}px`;
  spotlightEl.style.height = `${band.height}px`;
}

function scheduleSpotlight(): void {
  if (!paragraphFocusVisible || spotlightFrame !== 0) return;
  spotlightFrame = window.requestAnimationFrame(() => {
    spotlightFrame = 0;
    updateSpotlight();
  });
}

/** 段落聚焦：压暗当前编辑块以外的全部内容（视图菜单） */
export function setParagraphFocusVisible(visible: boolean): void {
  paragraphFocusVisible = visible;
  if (visible) attachSpotlight();
  else detachSpotlight();
}

