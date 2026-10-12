// svelte-check / @sveltejs/vite-plugin-svelte 的公共配置入口。
// 本工程用 TypeScript 写在 `<script lang="ts">` 里，故只需声明 vitePreprocess。
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
