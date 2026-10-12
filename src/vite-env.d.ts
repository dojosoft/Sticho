/// <reference types="svelte" />
/// <reference types="vite/client" />

// turndown-plugin-gfm 无官方类型声明（纯运行时插件工厂），按其 README 用法声明
declare module "turndown-plugin-gfm" {
  import type { Plugin } from "turndown";
  export const gfm: Plugin | Plugin[];
}
