// ESLint 扁平配置（flat config）。
//
// 覆盖三类文件：普通 .ts/.js、.svelte（Svelte 5 runes）、以及工程脚本。
// 与 svelte-check（类型检查）分工：这里只做静态风格/易错点检查，不做类型推断，
// 因此刻意不开启 typescript-eslint 的 type-checked 规则，保持 lint 快而稳。
import globals from "globals";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteConfig from "./svelte.config.js";

export default tseslint.config(
  // 构建产物、依赖、Rust 侧、打包输出，以及 public/ 下的第三方 vendored 资源都不参与 lint
  { ignores: ["dist/", "node_modules/", "src-tauri/", "release/", "public/", "*.config.js"] },

  tseslint.configs.eslintRecommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  ...svelte.configs.prettier,

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },

  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
        svelteConfig,
      },
    },
  },
);