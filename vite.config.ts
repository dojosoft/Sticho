import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],

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
