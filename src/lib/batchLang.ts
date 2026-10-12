/**
 * 批处理脚本（.bat / .cmd）的最小语法高亮。
 *
 * 为什么自研：CodeMirror 官方语言包与 @codemirror/legacy-modes 都没有 batch 模式，
 * 而 .bat 是用户点名的格式之一，所以这里写一个够用的 StreamParser。
 *
 * 已知偏差（写在这里，省得以后重新排查）：
 * 1. `::` 注释只按「行首」判定。真实 cmd 在 `for (...)` / `if (...)` 的括号块内会把
 *    `::` 当标签而不是注释（块内必须写 `rem`），这里不做块级状态跟踪，会误判为注释。
 * 2. `!var!`（延迟展开）与 `%var%` 一视同仁地着色，不区分是否 setlocal enabledelayedexpansion。
 * 3. `^` 续行不跟踪，跨行的字符串/参数修饰可能着色不完整。
 */

import { StreamLanguage, type StreamParser } from "@codemirror/language";

/** cmd 内建命令与 if/for 保留字（大小写不敏感） */
const KEYWORDS = new Set([
  "assoc",
  "attrib",
  "break",
  "call",
  "cd",
  "chcp",
  "chdir",
  "choice",
  "cls",
  "color",
  "copy",
  "date",
  "defined",
  "del",
  "dir",
  "do",
  "echo",
  "else",
  "endlocal",
  "erase",
  "errorlevel",
  "exist",
  "exit",
  "find",
  "findstr",
  "for",
  "goto",
  "if",
  "in",
  "md",
  "mkdir",
  "mklink",
  "move",
  "net",
  "not",
  "path",
  "pause",
  "ping",
  "popd",
  "powershell",
  "prompt",
  "pushd",
  "rd",
  "reg",
  "ren",
  "rename",
  "rmdir",
  "robocopy",
  "sc",
  "schtasks",
  "set",
  "setlocal",
  "shift",
  "start",
  "taskkill",
  "time",
  "title",
  "type",
  "ver",
  "verify",
  "vol",
  "where",
  "whoami",
  "wmic",
  "xcopy",
]);

const parser: StreamParser<null> = {
  name: "batch",
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null;

    // 行首的 :: 注释（块内会被真 cmd 当标签，见文件头偏差 1）
    if (stream.sol() && stream.match("::")) {
      stream.skipToEnd();
      return "comment";
    }
    // rem 注释：整行都是注释
    if (stream.sol() && stream.match(/^rem\b/i)) {
      stream.skipToEnd();
      return "comment";
    }
    // :label（行首或 goto/call 之后）
    if (stream.match(/^:[A-Za-z0-9_.-]+/)) return "labelName";

    // 双引号串
    if (stream.match(/^"[^"]*"?/)) return "string";

    // %VAR% / %1 / %%a / %~dp0（见文件头偏差 2、3）
    if (stream.match(/^%%?[A-Za-z0-9_*?#$@!()~\\/.\-[\]]*%?/)) return "variableName";
    if (stream.match(/^![^!\s]*!?/)) return "variableName";

    if (stream.match(/^\d+/)) return "number";
    // 重定向 / 管道 / 抑制回显 / 转义
    if (stream.match(/^[<>|&^@]/)) return "operator";
    if (stream.match(/^[=()[\],;:+*/%-]/)) return "operator";

    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      // `match(正则)` 只会返回数组，这里的 true 分支仅为满足类型声明
      if (word === true) return null;
      return KEYWORDS.has(word[0].toLowerCase()) ? "keyword" : null;
    }

    // 兜底：每步必须前进，否则 StreamLanguage 会卡死
    stream.next();
    return null;
  },
};

/** .bat / .cmd 的语言扩展 */
export function batch(): StreamLanguage<null> {
  return StreamLanguage.define(parser);
}