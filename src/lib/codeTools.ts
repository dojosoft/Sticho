/**
 * 代码小工具：纯字符串变换，不碰编辑器状态（便于单独测、也便于在面板里「预览后替换」）。
 *
 * 设计约定：
 * 1. 全部返回 `ToolResult`，失败时带上原因（JSON 这类可解析失败的必须能报错），
 *    这样 CodeTools 面板可以用同一段代码处理所有工具。
 * 2. **行尾风格必须保真**。用户用记事本打开的 .bat / .ps1 多为 CRLF，如果美化后
 *    变成 LF，整个文件在 git 里会显示为「全文件改动」。所以所有多行输出都用
 *    `eolOf(src)` 还原原始行尾，且原文末尾有换行时输出也保留一个。
 * 3. JS 的「美化/压缩」故意只做**安全子集**：美化只重排缩进，压缩只删空行 + 去首尾
 *    空白，**绝不合并行**。合并行会破坏 ASI（自动分号插入）、模板串与正则字面量；
 *    官方 prettier / terser 又太重，不值得为一个小工具引入。
 */

export type ToolResult = { ok: true; text: string } | { ok: false; error: string };

/** 取原文的行尾风格 */
export function eolOf(src: string): string {
  return src.includes("\r\n") ? "\r\n" : "\n";
}

/** 原文末尾有换行时，给处理结果补回一个换行（避免每次美化都丢掉文件末尾的换行） */
export function keepTrailingEol(text: string, src: string): string {
  if (/(?:\r\n|\r|\n)$/.test(src) && !text.endsWith("\n")) return text + eolOf(src);
  return text;
}

/* ────────────────────────── JSON ────────────────────────── */

export function prettyJson(src: string): ToolResult {
  try {
    const text = JSON.stringify(JSON.parse(src), null, 2);
    return { ok: true, text: keepTrailingEol(text.split("\n").join(eolOf(src)), src) };
  } catch {
    // 返回英文 key 而非 JSON.parse 的原生英文报错，供调用方经 t() 翻译
    return { ok: false, error: "Invalid JSON" };
  }
}

export function minifyJson(src: string): ToolResult {
  try {
    return { ok: true, text: keepTrailingEol(JSON.stringify(JSON.parse(src)), src) };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

/* ────────────────────────── CSS ────────────────────────── */

/** 压缩时前后不留空格的符号 */
const CSS_TIGHT = "{};:,>~";

/**
 * CSS 压缩：走一遍字符级扫描，跟踪字符串 / 注释 / url() 括号，
 * 把空白折叠成一个空格、在紧凑符号处去掉空格、去掉注释。
 *
 * 为什么自研而不引 cssnano：这是一个「替换选中」级别的小工具，不值得为它引入
 * 一个带 PostCSS 依赖链的包。代价是只做文本级压缩，不做选择器合并之类的优化。
 */
export function minifyCss(src: string): ToolResult {
  const out: string[] = [];
  let i = 0;
  let pendingSpace = false;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    // 注释
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      pendingSpace = true;
      continue;
    }
    // 字符串整体带出（串里可能有 { } ; 空格，不能参与折叠）
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        const d = src[j];
        j += 1;
        if (d === c) break;
      }
      if (pendingSpace) out.push(" ");
      out.push(src.slice(i, j));
      pendingSpace = false;
      i = j;
      continue;
    }
    if (/\s/.test(c)) {
      pendingSpace = true;
      i += 1;
      continue;
    }
    if (CSS_TIGHT.includes(c)) {
      out.push(c);
      pendingSpace = false;
      i += 1;
      continue;
    }
    if (pendingSpace) {
      const lastCh = out.length > 0 ? out[out.length - 1].slice(-1) : "";
      // 前一个字符是紧凑符号或左括号、或者当前就是右括号：都不需要空格
      if (lastCh !== "" && !CSS_TIGHT.includes(lastCh) && lastCh !== "(" && c !== ")") out.push(" ");
    }
    pendingSpace = false;
    out.push(c);
    i += 1;
  }
  return { ok: true, text: keepTrailingEol(out.join(""), src) };
}

/**
 * CSS 美化：按 `{` / `}` / `;` 断行并缩进两格。
 *
 * 只断行不改内容：字符串与注释原样带出，所以 `content: "}"` 不会被误当结构符号。
 */
export function prettyCss(src: string): ToolResult {
  const eol = eolOf(src);
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let i = 0;
  const n = src.length;
  const pad = (): string => "  ".repeat(Math.max(0, depth));
  const flushLine = (): void => {
    const s = buf.trim();
    if (s !== "") out.push(pad() + s);
    buf = "";
  };
  /** 下一个非空白字符的下标（不改动 i，只用于预读） */
  const peek = (from: number): number => {
    let k = from;
    while (k < n && /\s/.test(src[k])) k += 1;
    return k;
  };

  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) {
        buf += src.slice(i);
        i = n;
        break;
      }
      buf += src.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        const d = src[j];
        j += 1;
        if (d === c) break;
      }
      buf += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === "{") {
      buf += " {";
      flushLine();
      depth += 1;
      i = peek(i + 1);
      continue;
    }
    if (c === "}") {
      flushLine();
      depth = Math.max(0, depth - 1);
      const next = peek(i + 1);
      if (next < n && src[next] === ";") {
        out.push(pad() + "};");
        i = next + 1;
      } else {
        out.push(pad() + "}");
        i += 1;
      }
      continue;
    }
    if (c === ";") {
      buf += ";";
      flushLine();
      i += 1;
      continue;
    }
    if (/\s/.test(c)) {
      if (buf !== "" && !buf.endsWith(" ")) buf += " ";
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  flushLine();
  return { ok: true, text: keepTrailingEol(out.join(eol), src) };
}

/* ────────────────────────── JavaScript ────────────────────────── */

interface JsLineInfo {
  /** 该行从模板串 / 块注释内部开始：逐字保留，一个字符都不能动 */
  verbatim: boolean;
  /** 该行的净括号变化（`{([` 加、`}])` 减），字符串与注释内的括号不计 */
  delta: number;
  /** 行首的收尾括号个数（决定了本行要先回退几级缩进） */
  leadingClosers: number;
}

/**
 * 按行扫一遍 JS，算出每行的括号变化。
 *
 * 只做「够用」的识别：字符串、行注释、块注释、模板串、正则字面量。
 * 模板串里的 `${}` 不做嵌套跟踪（缩进算错也只是难看，不会改语义）——
 * 这正是「安全子集」的含义：**任何情况下都不增删字符，只改行首缩进**。
 */
function scanJs(src: string): { lines: string[]; info: JsLineInfo[] } {
  const lines = src.split(/\r\n|\r|\n/);
  const info: JsLineInfo[] = [];
  let mode: "code" | "block" | "template" = "code";
  let prevSig = "";
  let prevWord = "";

  for (const line of lines) {
    const startMode = mode;
    let delta = 0;
    let leadingClosers = 0;
    // 本行是否仍处在「行首」：只见过收尾括号与空白。连续几个收尾括号都要计入缩进回退
    // （`});` 该回退两级；旧实现遇到第一个 `}` 就把标志置真，只会回退一级）
    let leading = true;
    let i = 0;
    const n = line.length;

    /** `/` 当前是正则字面量的开始还是除号：看上一个有意义的字符/词 */
    const isRegexStart = (): boolean => {
      if (prevSig === "" || "(,=:[!&|?{};+-*%^~<>".includes(prevSig)) return true;
      return /^(return|typeof|case|in|of|do|else|new|delete|void|instanceof|yield|await|throw)$/.test(
        prevWord,
      );
    };

    while (i < n) {
      const c = line[i];
      if (mode === "block") {
        const end = line.indexOf("*/", i);
        if (end === -1) {
          i = n;
          break;
        }
        mode = "code";
        i = end + 2;
        continue;
      }
      if (mode === "template") {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "`") mode = "code";
        i += 1;
        continue;
      }
      if (/\s/.test(c)) {
        i += 1;
        continue;
      }
      if (c === "/" && line[i + 1] === "/") break; // 行注释：本行到此为止
      if (c === "/" && line[i + 1] === "*") {
        mode = "block";
        i += 2;
        continue;
      }
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (j < n) {
          if (line[j] === "\\") {
            j += 2;
            continue;
          }
          const d = line[j];
          j += 1;
          if (d === c) break;
        }
        i = j;
        leading = false;
        prevSig = c;
        prevWord = "";
        continue;
      }
      if (c === "`") {
        mode = "template";
        i += 1;
        leading = false;
        prevSig = c;
        prevWord = "";
        continue;
      }
      if (c === "/" && isRegexStart()) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const d = line[j];
          if (d === "\\") {
            j += 2;
            continue;
          }
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) {
            j += 1;
            break;
          }
          j += 1;
        }
        i = j;
        leading = false;
        prevSig = "/";
        prevWord = "";
        continue;
      }
      if (/[A-Za-z0-9_$]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$]/.test(line[j])) j += 1;
        prevWord = line.slice(i, j);
        prevSig = c;
        i = j;
        leading = false;
        continue;
      }
      if (c === "{" || c === "(" || c === "[") {
        delta += 1;
      } else if (c === "}" || c === ")" || c === "]") {
        delta -= 1;
        if (leading) leadingClosers += 1;
      }
      prevSig = c;
      prevWord = "";
      leading = false;
      i += 1;
    }

    info.push({ verbatim: startMode !== "code", delta, leadingClosers });
  }

  return { lines, info };
}

/** JS 美化（安全子集）：只重排行首缩进 + 去行尾空白，不增删字符、不合并行 */
export function prettyJs(src: string): ToolResult {
  const eol = eolOf(src);
  const { lines, info } = scanJs(src);
  const out: string[] = [];
  let depth = 0;
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    const meta = info[k];
    if (meta.verbatim) {
      out.push(raw);
      depth = Math.max(0, depth + meta.delta);
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === "") {
      out.push("");
      continue;
    }
    out.push("  ".repeat(Math.max(0, depth - meta.leadingClosers)) + trimmed);
    depth = Math.max(0, depth + meta.delta);
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  return { ok: true, text: keepTrailingEol(out.join(eol), src) };
}

/** JS 压缩（安全子集）：只删空行 + 去首尾空白，**绝不合并行** */
export function minifyJs(src: string): ToolResult {
  const eol = eolOf(src);
  const { lines, info } = scanJs(src);
  const out: string[] = [];
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    if (info[k].verbatim) {
      // 模板串 / 块注释内部：trim 会改字符串内容，原样保留
      out.push(raw);
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed !== "") out.push(trimmed);
  }
  return { ok: true, text: keepTrailingEol(out.join(eol), src) };
}

/* ────────────────────────── Base64 ────────────────────────── */

export function base64Encode(src: string): ToolResult {
  try {
    const bytes = new TextEncoder().encode(src);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { ok: true, text: btoa(bin) };
  } catch {
    return { ok: false, error: "Failed to encode to Base64" };
  }
}

export function base64Decode(src: string): ToolResult {
  try {
    const bin = atob(src.replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { ok: true, text: new TextDecoder("utf-8").decode(bytes) };
  } catch {
    return { ok: false, error: "Invalid Base64 input" };
  }
}

/* ────────────────────────── 进制转换 ────────────────────────── */

export type NumResult =
  /** value 用 bigint：超过 2^53 的整数（如 64 位十六进制）用 number 会静默丢精度 */
  | { ok: true; value: bigint }
  /** error 为英文 key；vars 供 t() 插值（如非法数字与进制） */
  | { ok: false; error: string; vars?: Record<string, string | number> };

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 按进制解析整数。`base = 0` 时按前缀自动识别（0x / 0o / 0b，否则十进制） */
export function parseNumberInBase(src: string, base: number): NumResult {
  const clean = src.trim().replace(/[\s_]/g, "");
  if (clean === "") return { ok: false, error: "Input is empty" };
  const negative = clean.startsWith("-");
  let body = negative ? clean.slice(1) : clean;
  let radix = base;
  if (radix === 0) {
    if (/^0[xX]/.test(body)) {
      radix = 16;
      body = body.slice(2);
    } else if (/^0[bB]/.test(body)) {
      radix = 2;
      body = body.slice(2);
    } else if (/^0[oO]/.test(body)) {
      radix = 8;
      body = body.slice(2);
    } else {
      radix = 10;
    }
  } else {
    body = body.replace(/^0[xX]/, "").replace(/^0[oO]/, "").replace(/^0[bB]/, "");
  }
  if (body === "") return { ok: false, error: "Input is empty" };
  const allowed = DIGITS.slice(0, radix);
  for (const ch of body.toLowerCase()) {
    if (!allowed.includes(ch)) {
      return { ok: false, error: "“{ch}” is not a valid digit in base {radix}", vars: { ch, radix } };
    }
  }
  // 位数上限：超长输入下 BigInt 的逐位累乘会退化成平方级复杂度，挡住病态粘贴（如几十万位的二进制）
  if (body.length > 4096) return { ok: false, error: "Input is too long" };
  // 用 BigInt 解析：parseInt 走 double，超过 2^53 的整数会静默丢精度（例如 64 位的十六进制）
  let value = 0n;
  const radixBig = BigInt(radix);
  for (const ch of body.toLowerCase()) {
    value = value * radixBig + BigInt(DIGITS.indexOf(ch));
  }
  return { ok: true, value: negative ? -value : value };
}

export function formatInBase(value: bigint, base: number): string {
  const text = (value < 0n ? -value : value).toString(base);
  return value < 0n ? `-${text}` : text;
}

/* ────────────────────────── 插入类 ────────────────────────── */

/** 新建 GUID（v4）。优先用 WebCrypto，缺失时退化为 Math.random */
export function newGuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type StampKind = "local" | "date" | "time" | "iso" | "unix" | "unixms";

export function timestampText(kind: StampKind, at: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  switch (kind) {
    case "local":
      return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`;
    case "date":
      return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`;
    case "time":
      return `${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`;
    case "iso":
      return at.toISOString();
    case "unix":
      return String(Math.floor(at.getTime() / 1000));
    case "unixms":
      return String(at.getTime());
  }
}