/**
 * 首次运行释放到配置目录的默认包文件（批次十二）
 *
 * 内容真源放在前端：Rust 侧只负责「目标不存在才写入」，避免把整张词表在 Rust 里再抄
 * 一份。三个目录各附一份 README.txt 说明格式，用户照着改就行。
 *
 * 释放规则（批次十五统一）：
 * - 不带 `version` 的包（主题 / 字体 / 说明文件）：只在文件缺失时释放，
 *   用户改过或删过的文件不会被下次启动写回；
 * - 自带语言包（内置 en-US / zh-CN，未来可增）统一带 `version`：目标缺失时释放补充，
 *   已存在且其中 `_version` 低于当前内置版本时覆盖更新——软件据此把内置词表保持在最新
 *   版本。规则与语种无关，新增自带语言包沿用同一条规则即可。
 */
import { ZH } from "./i18n";
import type { DefaultPackFile } from "./tauri-api";

/** locales/ 目录的说明文件 */
const LOCALES_README = `Sticho 语言包文件夹

用法：把一个 UTF-8 编码的 .json 文件放在本目录下，重启程序后即可在
「设置 → 语言」的下拉框里选用。文件名主干就是语言 id，例如 fr-FR.json → fr-FR。

文件格式（键 = 英文原文，值 = 译文）：
{
  "_label": "Français",
  "File": "Fichier",
  "Save": "Enregistrer"
}

说明：
- "_label" 是下拉框里显示的名称，"_version" 是程序释放它时的版本号，两者都可省略。
- 未翻译的键会自动回落到英文原文，不会显示成空白，可随用随补。
- 本目录里的 zh-CN.json / en-US.json 是自带语言包；删掉它们程序会用内置词表兜底。
- 自带语言包在版本落后于程序时会被自动更新覆盖，请勿在这些文件里手工改动。
`;

/**
 * 自带语言包的释放版本末段：**必须单调递增**，每次修改内置词表（zh-CN 等）就 +1。
 *
 * 为什么不用「词表指纹」当版本段：指纹是 32 位哈希，改一次词表有约一半概率让新指纹**变小**，
 * 而软件版本号开发期长期停在 0.1.0；Rust 侧只在内置版本**高于**目录里的 `_version` 时才覆盖
 * （见 commands/packs.rs 的 compare_version）。那样改完新词表，目录里那份旧包反被判成
 * 「不比内置旧」而拒绝覆盖，旧译文继续逐条盖过内置词表——正是这套机制要避免的
 * 「文案改了、重启后界面却没变」。
 *
 * 起始值取 2^32：旧方案的指纹段最大就是 2^32-1，用它保证换方案后的首次释放一定覆盖掉旧包。
 */
const PACK_RELEASE = 4294967296;

/** 自带语言包内嵌的释放版本：目录里的同包版本更低时会被覆盖更新 */
const PACK_VERSION = `${__APP_VERSION__}.${PACK_RELEASE}`;

/** themes/ 目录的说明文件 */
const THEMES_README = `Sticho 主题包文件夹

用法：把一个 UTF-8 编码的 .css 文件放在本目录下，在「皮肤设置 → 主题」中选用即可。
主题能接管**整份界面**的配色（窗口底、顶栏、标签栏、侧边栏、状态栏、菜单、对话框、
编辑器工具栏、正文底色等），不再局限于文档内容区。

改配色：程序把界面拆成一组 CSS 变量，主题里给这些变量重新赋值就能整体换色。
变量定义在 html.light / html.dark 上，所以主题请按下列写法之一覆盖（否则压不过默认值）：
  html { --bg: …; --fg: … }        // 明暗共用一份（整套主题推荐）
  html.light { … }                 // 只改浅色档位
  html.dark  { … }                 // 只改深色档位

常用变量（完整清单见程序内置样式 src/styles/app.css 顶部注释）：
  --bg / --fg                         窗口与文字底色
  --toolbar-bg / --statusbar-bg       顶栏 / 状态栏底
  --sidebar-bg / --border             侧边栏底 / 描边
  --hover                             悬停与选中底
  --accent / --accent-contrast        强调色 / 强调色上的文字
  --danger / --warning                危险 / 警告态
  --find-hl / --find-hl-active        查找命中高亮
  --tip-bg / --tip-fg / --tip-border  提示浮窗
编辑器（Vditor）另有自己的变量，需要时对 .vditor, .vditor--dark 赋值：
  --toolbar-background-color / --textarea-background-color / --panel-background-color 等
代码视图（纯文本模式，CodeMirror）可用 --cm-bg / --cm-fg / --cm-gutter-bg 等变量。

例外（主题不接管）：HTML 文档正文区（.html-view，文档自带配色），
以及语法高亮状态下的文字颜色（Vditor 的 --ir-* 与代码视图的 token 颜色）。

深浅色由主题自己声明：主题 CSS 里写 \`color-scheme: dark\` 就是深色主题（程序会同步把
编辑器与代码高亮切到深色），写 \`color-scheme: light\` 就是浅色主题；两个都没写时按浅色处理。
因此「外观」只需选主题即可，不再单独切明 / 暗档位。

说明：
- 本目录里的「深色.css」「温酒.css」「暖夜.css」是三份整套界面的
  示例（深色=中性深色，温酒=暖黄浅色，暖夜=偏暖深色），照着改就行。
- 主题下拉框的顺序是「自动切换（默认）/ 浅色 / 深色 / 温酒 / 暖夜」，之后才轮到你放的主题。
- 主题默认「自动切换」：跟随 Windows 的深浅在内置浅色 / 深色之间切换；也可以显式指定某份主题。
- 不需要时把 .css 文件删掉即可，程序不会重新生成它。
`;

/** fonts/ 目录的说明文件 */
const FONTS_README = `Sticho 字体包文件夹

用法：把字体文件（.ttf / .otf / .woff / .woff2）放在本目录下，重启程序后即可在
「设置 → 阅读排版 → 字体」的下拉框里选用（字体名即文件名主干）。

说明：
- 字体文件不会随程序分发，请自行确认其授权允许你的使用场景。
- 中文全量字体文件较大，建议只放确实要用的字体。
`;

/**
 * 内置主题：偏暖深色（暖夜）——整套界面配色的示例，用来证明主题能接管全局。
 *
 * 这份主题不只改正文：它把「整份界面」（窗口底、顶栏、标签栏、侧边栏、状态栏、菜单、
 * 对话框、编辑器工具栏、正文底色、代码视图底）都按暖色深色调过。
 * 每一段都写了中文注释，用户复制一份照着改就能做自己的主题。
 *
 * 刻意不覆盖的两处（与需求一致）：HTML 文档正文区（.html-view，文档自带配色）、
 * 语法高亮状态下的文字颜色（Vditor 的 --ir-* 与代码视图的 token 颜色）。
 */
const WARM_NIGHT_THEME = `/* 内置主题 · 暖夜（偏暖深色）
 *
 * 这是「整份界面」级别的主题示例：从窗口底、顶栏、标签栏、侧边栏、状态栏，
 * 到菜单面板、对话框，再到编辑器工具栏与正文底色，全部按下面这组变量重新着色。
 * 在「皮肤设置 → 主题」里选用即时生效。
 *
 * ── 怎么改？────────────────────────────────────────────
 * 1) 全局界面色：改第一段 \`html, html.light, html.dark\` 里的变量。写在
 *    html.light / html.dark 上才能盖过程序内置的默认值；只想作用于深色档位时，
 *    把选择器换成 \`html.dark\` 单独一份即可。
 * 2) 编辑器工具栏 / 下拉面板：改第二段的 \`.vditor, .vditor--dark\`（Vditor 自己的变量）。
 * 3) 代码视图（纯文本模式）：改第三段的 \`--cm-*\` 变量。
 * 4) 正文底色：改第四段（Markdown / 纯文本正文跟随主题）。
 * 变量含义见主题文件夹里的 README.txt 或程序内置样式 src/styles/app.css 顶部注释。
 * ─────────────────────────────────────────────────────
 */

/* 一、全局界面色：暖炭底 + 暖白文字 + 琥珀强调 */
html, html.light, html.dark {
  --bg: #2b2724;               /* 窗口底 / 面板底 */
  --fg: #ece4d9;               /* 主文字（暖白） */
  --toolbar-bg: #322d29;       /* 顶栏底 */
  --statusbar-bg: #322d29;     /* 状态栏底 */
  --sidebar-bg: #2a2522;       /* 侧边栏底 */
  --border: #443c35;           /* 分隔线 / 描边 */
  --hover: rgba(255, 236, 210, 0.08);   /* 悬停与选中底 */
  --danger: #e07a5f;           /* 危险态（赤陶红） */
  --warning: #e0a458;          /* 警告态（琥珀） */
  --overlay: rgba(18, 12, 8, 0.62);     /* 对话框遮罩 */
  --accent: #e08a3c;           /* 强调色（琥珀）：选中标签条、主按钮等 */
  --accent-soft: rgba(224, 138, 60, 0.16);
  --accent-contrast: #241d16;  /* 强调色上的文字（浅底配深字） */
  --focus-ring: rgba(224, 138, 60, 0.4);
  --danger-soft: rgba(224, 122, 95, 0.16);
  --danger-contrast: #241d16;
  --read-accent: #8fbf6a;      /* 阅读模式标签条（暖绿） */
  --read-contrast: #241d16;    /* 阅读模式活动标签上的文字（暖绿偏亮，配深字） */
  --spotlight-dim: rgba(18, 12, 8, 0.5);   /* 段落聚焦遮罩 */
  --find-hl: #6f531d;          /* 查找命中 */
  --find-hl-active: #a8631f;   /* 当前命中 */
  --tip-bg: rgba(50, 44, 38, 0.98);        /* 提示浮窗 */
  --tip-fg: #efe6da;
  --tip-border: rgba(255, 220, 180, 0.14);
  --tip-shadow: 0 10px 26px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4);
  color-scheme: dark;          /* 让滚动条等原生控件也走深色 */
}

/* 二、编辑器（Vditor）工具栏与下拉面板 */
.vditor, .vditor--dark {
  --border-color: #443c35;
  --second-color: rgba(236, 228, 217, 0.3);
  --panel-background-color: #322d29;
  --panel-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  --toolbar-background-color: #322d29;
  --toolbar-icon-color: #b7a894;
  --toolbar-icon-hover-color: #f2b566;
  --textarea-background-color: #2b2724;
  --textarea-text-color: #ece4d9;
  --count-background-color: rgba(255, 220, 180, 0.12);
  --heading-border-color: #443c35;
  --blockquote-color: #a99b88;
}

/* 三、代码视图（纯文本模式，CodeMirror）：底色跟随主题。
 *    语法高亮的「文字颜色」刻意不覆盖（需求明确语法高亮不套主题）。 */
html, html.light, html.dark {
  --cm-bg: #2b2724;
  --cm-fg: #ece4d9;
  --cm-gutter-bg: #322d29;
  --cm-gutter-fg: #8a7c6c;
  --cm-active-line: rgba(255, 236, 210, 0.06);
  --cm-selection: #5a4326;
}

/* 四、正文底色：Markdown / 纯文本正文跟随主题。
 *    HTML 文档正文区（.html-view）保持自身配色，故不在覆盖范围内。
 *    选择器前缀 html 提升优先级，确保盖过编辑器自带的内容主题。 */
html .vditor-content,
html .vditor-ir > pre.vditor-reset,
html .vditor-wysiwyg > pre.vditor-reset,
html .vditor-sv,
html .vditor-preview,
html .md-large-reader,
html .md-large-reader__body {
  background-color: #2b2724;
  color: #ece4d9;
}
`;

/** 内置暖夜（偏暖深色）主题文件名（同样不带 version：用户在旧机器上不会被动升级覆盖，改名即可重新释放） */
export const WARM_NIGHT_THEME_FILE = "暖夜.css";

/**
 * 内置主题：暖黄浅色（温酒）——与「暖夜」对应的浅色整套主题。
 *
 * 暖奶油底 + 暖棕文字 + 赭黄强调，同样接管整份界面（顶栏、侧边栏、状态栏、菜单、
 * 对话框、编辑器工具栏、正文底色、代码视图底）。中文注释齐备，方便用户照着改成自己的主题。
 *
 * 刻意不覆盖的两处（与需求一致）：HTML 文档正文区（.html-view，文档自带配色）、
 * 语法高亮状态下的文字颜色（Vditor 的 --ir-* 与代码视图的 token 颜色）。
 */
const WARM_WINE_THEME = `/* 内置主题 · 温酒（暖黄浅色）
 *
 * 这是「整份界面」级别的浅色主题示例：从窗口底、顶栏、标签栏、侧边栏、状态栏，
 * 到菜单面板、对话框，再到编辑器工具栏与正文底色，全部按下面这组变量重新着色。
 * 在「皮肤设置 → 主题」里选用即时生效。
 *
 * ── 怎么改？────────────────────────────────────────────
 * 1) 全局界面色：改第一段 \`html, html.light, html.dark\` 里的变量。写在
 *    html.light / html.dark 上才能盖过程序内置的默认值；只想作用于浅色档位时，
 *    把选择器换成 \`html.light\` 单独一份即可。
 * 2) 编辑器工具栏 / 下拉面板：改第二段的 \`.vditor, .vditor--dark\`（Vditor 自己的变量）。
 * 3) 代码视图（纯文本模式）：改第三段的 \`--cm-*\` 变量。
 * 4) 正文底色：改第四段（Markdown / 纯文本正文跟随主题）。
 * 变量含义见主题文件夹里的 README.txt 或程序内置样式 src/styles/app.css 顶部注释。
 * ─────────────────────────────────────────────────────
 */

/* 一、全局界面色：暖奶油底 + 暖棕文字 + 赭黄强调 */
html, html.light, html.dark {
  --bg: #faf3e0;               /* 窗口底 / 面板底（暖奶油） */
  --fg: #4a3f2f;               /* 主文字（暖棕） */
  --toolbar-bg: #f3e8cf;       /* 顶栏底 */
  --statusbar-bg: #f3e8cf;     /* 状态栏底 */
  --sidebar-bg: #f6eed9;       /* 侧边栏底 */
  --border: #e0d4b8;           /* 分隔线 / 描边 */
  --hover: rgba(120, 90, 30, 0.08);     /* 悬停与选中底 */
  --danger: #b3543a;           /* 危险态（暖砖红） */
  --warning: #b8860b;          /* 警告态（暗金） */
  --overlay: rgba(60, 45, 20, 0.35);    /* 对话框遮罩 */
  --accent: #b8761f;           /* 强调色（赭黄）：选中标签条、主按钮等 */
  --accent-soft: rgba(184, 118, 31, 0.14);
  --accent-contrast: #fffaf0;  /* 强调色上的文字（深底配浅字） */
  --focus-ring: rgba(184, 118, 31, 0.35);
  --danger-soft: rgba(179, 84, 58, 0.14);
  --danger-contrast: #ffffff;
  --read-accent: #6b8e23;      /* 阅读模式标签条（橄榄绿） */
  --read-contrast: #fffaf0;    /* 阅读模式活动标签上的文字（橄榄绿偏深，配浅字） */
  --spotlight-dim: rgba(60, 45, 20, 0.16);  /* 段落聚焦遮罩 */
  --find-hl: #ffe08a;          /* 查找命中 */
  --find-hl-active: #f6a94a;   /* 当前命中 */
  --tip-bg: rgba(255, 250, 235, 0.98);      /* 提示浮窗 */
  --tip-fg: #4a3f2f;
  --tip-border: rgba(120, 90, 30, 0.18);
  --tip-shadow: 0 10px 24px rgba(90, 65, 20, 0.18), 0 2px 6px rgba(90, 65, 20, 0.1);
  color-scheme: light;         /* 让滚动条等原生控件也走浅色 */
}

/* 二、编辑器（Vditor）工具栏与下拉面板 */
.vditor, .vditor--dark {
  --border-color: #e0d4b8;
  --second-color: rgba(74, 63, 47, 0.3);
  --panel-background-color: #f6eed9;
  --panel-shadow: 0 1px 2px rgba(90, 65, 20, 0.16);
  --toolbar-background-color: #f3e8cf;
  --toolbar-icon-color: #7a6a4f;
  --toolbar-icon-hover-color: #b8761f;
  --textarea-background-color: #faf3e0;
  --textarea-text-color: #4a3f2f;
  --count-background-color: rgba(120, 90, 30, 0.1);
  --heading-border-color: #e0d4b8;
  --blockquote-color: #8a7a5c;
}

/* 三、代码视图（纯文本模式，CodeMirror）：底色跟随主题。
 *    语法高亮的「文字颜色」刻意不覆盖（需求明确语法高亮不套主题）。 */
html, html.light, html.dark {
  --cm-bg: #faf3e0;
  --cm-fg: #4a3f2f;
  --cm-gutter-bg: #f3e8cf;
  --cm-gutter-fg: #a09070;
  --cm-active-line: rgba(120, 90, 30, 0.06);
  --cm-selection: #f2e0b0;
}

/* 四、正文底色：Markdown / 纯文本正文跟随主题。
 *    HTML 文档正文区（.html-view）保持自身配色，故不在覆盖范围内。
 *    选择器前缀 html 提升优先级，确保盖过编辑器自带的内容主题。 */
html .vditor-content,
html .vditor-ir > pre.vditor-reset,
html .vditor-wysiwyg > pre.vditor-reset,
html .vditor-sv,
html .vditor-preview,
html .md-large-reader,
html .md-large-reader__body {
  background-color: #faf3e0;
  color: #4a3f2f;
}
`;

/** 内置温酒（暖黄浅色）主题文件名（不带 version，缺失时才释放） */
export const WARM_WINE_THEME_FILE = "温酒.css";

/**
 * 内置主题：深色——即原「外观 → 深色」档位，现转为一等内置主题。
 *
 * 与「暖夜」的偏暖深色不同，这份是中性灰黑（编辑器 / 代码视图的观感与原深色档位一致），
 * 供只想用深色、不需要暖色的用户直接选用。选中后由 CSS 里的 `color-scheme: dark`
 * 声明它是深色主题，程序据此把编辑器与代码高亮一起切到深色。
 */
const DARK_THEME = `/* 内置主题 · 深色（中性深色）
 *
 * 这份主题对应原「外观 → 深色」档位：中性灰黑底 + 浅灰文字 + 蓝色强调，
 * 编辑器与代码视图保持深色观感。在「外观 → 主题」里选用即时生效。
 *
 * ── 怎么改？────────────────────────────────────────────
 * 1) 全局界面色：改第一段 \`html, html.light, html.dark\` 里的变量。写在
 *    html.light / html.dark 上才能盖过程序内置的默认值。
 * 2) 编辑器工具栏 / 下拉面板：改第二段的 \`.vditor, .vditor--dark\`（Vditor 自己的变量）。
 * 3) 代码视图（纯文本模式）：改第三段的 \`--cm-*\` 变量。
 * 4) 正文底色：改第四段（Markdown / 纯文本正文跟随主题）。
 * 变量含义见主题文件夹里的 README.txt 或程序内置样式 src/styles/app.css 顶部注释。
 *
 * 关键：本主题声明了 \`color-scheme: dark\`，程序据此把它当深色主题，同步切换
 * 编辑器与代码高亮的明暗（这就是为什么主题不再需要单独的明 / 暗档位）。
 * ─────────────────────────────────────────────────────
 */

/* 一、全局界面色：中性灰黑底 + 浅灰文字 + 蓝色强调 */
html, html.light, html.dark {
  --bg: #1e1e1e;               /* 窗口底 / 面板底 */
  --fg: #d4d4d4;               /* 主文字（浅灰） */
  --toolbar-bg: #252526;       /* 顶栏底 */
  --statusbar-bg: #252526;     /* 状态栏底 */
  --sidebar-bg: #252526;       /* 侧边栏底 */
  --border: #3c3c3c;           /* 分隔线 / 描边 */
  --hover: rgba(255, 255, 255, 0.09);   /* 悬停与选中底 */
  --danger: #f48771;           /* 危险态 */
  --warning: #d29922;          /* 警告态 */
  --overlay: rgba(0, 0, 0, 0.55);       /* 对话框遮罩 */
  --accent: #3b82f6;           /* 强调色（蓝） */
  --accent-soft: rgba(96, 165, 250, 0.16);
  --accent-contrast: #ffffff;  /* 强调色上的文字 */
  --focus-ring: rgba(96, 165, 250, 0.4);
  --danger-soft: rgba(244, 135, 113, 0.18);
  --danger-contrast: #ffffff;
  --read-accent: #4ade80;      /* 阅读模式标签条（绿） */
  --read-contrast: #12301a;    /* 阅读模式活动标签上的文字（亮绿配深字） */
  --spotlight-dim: rgba(0, 0, 0, 0.45); /* 段落聚焦遮罩 */
  --find-hl: #6b5c1e;          /* 查找命中 */
  --find-hl-active: #a1521f;   /* 当前命中 */
  --tip-bg: rgba(48, 48, 52, 0.98);     /* 提示浮窗 */
  --tip-fg: #e6e6e6;
  --tip-border: rgba(255, 255, 255, 0.12);
  --tip-shadow: 0 10px 26px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.35);
  color-scheme: dark;          /* 声明这是深色主题 */
}

/* 二、编辑器（Vditor）工具栏与下拉面板 */
.vditor, .vditor--dark {
  --border-color: #3c3c3c;
  --second-color: rgba(212, 212, 212, 0.3);
  --panel-background-color: #252526;
  --panel-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  --toolbar-background-color: #252526;
  --toolbar-icon-color: #a0a0a0;
  --toolbar-icon-hover-color: #6aa9ff;
  --textarea-background-color: #1e1e1e;
  --textarea-text-color: #d4d4d4;
  --count-background-color: rgba(255, 255, 255, 0.12);
  --heading-border-color: #3c3c3c;
  --blockquote-color: #8f8f8f;
}

/* 三、代码视图（纯文本模式，CodeMirror）：底色跟随主题。
 *    语法高亮的「文字颜色」刻意不覆盖（需求明确语法高亮不套主题）。 */
html, html.light, html.dark {
  --cm-bg: #1e1e1e;
  --cm-fg: #d4d4d4;
  --cm-gutter-bg: #252526;
  --cm-gutter-fg: #858585;
  --cm-active-line: rgba(255, 255, 255, 0.05);
  --cm-selection: #264f78;
}

/* 四、正文底色：Markdown / 纯文本正文跟随主题。
 *    HTML 文档正文区（.html-view）保持自身配色，故不在覆盖范围内。
 *    选择器前缀 html 提升优先级，确保盖过编辑器自带的内容主题。 */
html .vditor-content,
html .vditor-ir > pre.vditor-reset,
html .vditor-wysiwyg > pre.vditor-reset,
html .vditor-sv,
html .vditor-preview,
html .md-large-reader,
html .md-large-reader__body {
  background-color: #1e1e1e;
  color: #d4d4d4;
}
`;

/** 内置深色（中性深色）主题文件名（不带 version，缺失时才释放） */
export const DARK_THEME_FILE = "深色.css";

/**
 * 主题下拉框里内置主题文件的先后：深色 → 温酒 → 暖夜。
 * 下拉框整体顺序即：自动切换（默认）/ 浅色（内置档位，不是文件）/ 深色 / 温酒 / 暖夜 / 用户自建主题。
 * 自建主题不参与排序，按目录读到的原顺序跟在内置三份之后。
 */
export const BUILTIN_THEME_ORDER = [DARK_THEME_FILE, WARM_WINE_THEME_FILE, WARM_NIGHT_THEME_FILE];

/**
 * 内置主题改名前的旧文件名 → 现文件名（按出现先后排列）。
 *
 * 内置包只在文件缺失时释放、不会主动删掉改名前的旧文件，所以主题下拉框要把这些旧名字滤掉，
 * 否则老用户会多看到一条同名选项；老配置里选中过旧文件名的，启动时按这张表换成新名字。
 */
export const LEGACY_THEME_RENAMES: Record<string, string> = {
  "内置主题·暗墨.css": DARK_THEME_FILE,
  "内置主题·深色.css": DARK_THEME_FILE,
  "内置主题·暖夜.css": WARM_NIGHT_THEME_FILE,
  "内置主题·温酒.css": WARM_WINE_THEME_FILE,
};

/** 内置主题用过的旧文件名：刷新主题列表时要把它们滤掉 */
export const LEGACY_THEME_FILES: string[] = Object.keys(LEGACY_THEME_RENAMES);

/** 简体中文语言包：由内置 ZH 词表直接导出，保证与界面文案同源（键 = 英文原文，值 = 中文译文） */
const ZH_CN_PACK = JSON.stringify({ _label: "简体中文", _version: PACK_VERSION, ...ZH }, null, 2);

/** 英文语言包：英文即原文，词表为空 → 查表落空即原样返回英文；同样带 `_version` 参与版本校验 */
const EN_US_PACK = JSON.stringify({ _label: "English", _version: PACK_VERSION }, null, 2);

/** 首启释放清单（顺序无关；同目录内按此顺序逐个判断缺失） */
export const DEFAULT_PACK_FILES: DefaultPackFile[] = [
  { dir: "locales", name: "README.txt", content: LOCALES_README },
  // 自带语言包统一带 version：缺失时释放补充，目录里版本更低时覆盖更新（其它文件一律不动）
  { dir: "locales", name: "zh-CN.json", content: ZH_CN_PACK, version: PACK_VERSION },
  { dir: "locales", name: "en-US.json", content: EN_US_PACK, version: PACK_VERSION },
  { dir: "themes", name: "README.txt", content: THEMES_README },
  // 内置「深色」主题：中性深色（原「外观 → 深色」档位，现为一等主题；不带 version，缺失时才释放）
  { dir: "themes", name: DARK_THEME_FILE, content: DARK_THEME },
  // 内置「暖夜」主题：整套偏暖深色界面配色（不带 version，缺失时才释放）
  { dir: "themes", name: WARM_NIGHT_THEME_FILE, content: WARM_NIGHT_THEME },
  // 内置「温酒」主题：与之对应的整套暖黄浅色界面配色（不带 version，缺失时才释放）
  { dir: "themes", name: WARM_WINE_THEME_FILE, content: WARM_WINE_THEME },
  { dir: "fonts", name: "README.txt", content: FONTS_README },
];