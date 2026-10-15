/// <reference types="svelte" />
/// <reference types="vite/client" />

// 由 vite.config.ts 的 define 在编译期注入，值取自 package.json 的 version（单一来源）
declare const __APP_VERSION__: string;

// turndown-plugin-gfm 无官方类型声明（纯运行时插件工厂），按其 README 用法声明
declare module "turndown-plugin-gfm" {
  import type { Plugin } from "turndown";
  export const gfm: Plugin | Plugin[];
}
