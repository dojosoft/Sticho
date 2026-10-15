import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// 版本号单一来源：从 package.json 读入，编译期以 __APP_VERSION__ 注入前端。
// 否则界面上还要再手写一份（标题栏 / 关于页 / 欢迎页），改版本时漏改就会出现
// 「关于页版本与实际不符」，而这类不一致单测很难发现。
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  build: {
    // 运行环境是 WebView2（常青 Chromium）：按最新语法产出，省去降级转换，
    // 产物更小、解析更快。Vditor/docx/pdfjs 等重库已改为动态 import 独立分包。
    target: "esnext",
  },

  // Tauri 固定端口，避免每次 dev 端口变化导致 Rust 侧白名单失效
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 忽略 Rust 目录，避免 Rust 编译时触发前端热重载
      ignored: ["**/src-tauri/**"],
    },
  },
});
