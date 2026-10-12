# 第三方许可证声明（THIRD_PARTY_LICENSES.md）

> 本文件按任务书 2.2 节要求维护：所有直接依赖必须为「可商用 + 可闭源 + 无传染性」许可证。
> 每次新增依赖必须同步更新本文件。**GPL 系依赖禁止链接进本项目**（Pandoc 例外条款见文末）。

## npm 依赖（前端）

| 包名 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| `@tauri-apps/api` | ^2.1 | MIT OR Apache-2.0 | Tauri 前端 API |
| `@tauri-apps/plugin-dialog` | ^2.0 | MIT OR Apache-2.0 | 文件打开/保存对话框 |
| `@tauri-apps/plugin-store` | ^2.0 | MIT OR Apache-2.0 | 轻量键值存储（主题/最近文件记忆） |
| `vditor` | ^3.11 | MIT | Markdown 编辑器内核 |
| `markdown-it` | ^14 | MIT | MD→HTML 渲染（导出管道） |
| `docx` | ^9 | MIT | 生成 .docx（导出 Word） |
| `pdfjs-dist` | ^4.10 | Apache-2.0 | 导入 PDF：文本层抽取（仅运行时解析，无传染性） |
| `turndown` | ^7.2 | MIT | 导入 HTML：HTML→Markdown 转换 |
| `turndown-plugin-gfm` | ^1.0 | MIT | turndown 的 GFM 扩展（表格/删除线/任务列表） |
| `@tauri-apps/cli` | ^2.1 | MIT OR Apache-2.0 | Tauri CLI（开发期） |
| `@sveltejs/vite-plugin-svelte` | ^5.0 | MIT | Svelte 的 Vite 插件（开发期） |
| `svelte` | ^5.16 | MIT | 前端框架 |
| `typescript` | ^5.7 | Apache-2.0 | 类型系统（开发期） |
| `vite` | ^6.0 | MIT | 构建工具（开发期） |

## Rust 依赖（后端，经 Cargo.lock 传递闭包）

| crate | 版本 | 许可证 | 用途 |
|---|---|---|---|
| `tauri` | ^2 | MIT OR Apache-2.0 | 桌面框架 |
| `tauri-plugin-dialog` | ^2 | MIT OR Apache-2.0 | 对话框（Rust 侧） |
| `tauri-plugin-store` | ^2 | MIT OR Apache-2.0 | 键值存储（Rust 侧） |
| `base64` | ^0.22 | MIT OR Apache-2.0 | 导出二进制 base64 编解码 |
| `webview2-com` | ^0.38 | MIT | PDF 导出：WebView2 COM 打印接口（wry 传递依赖，零额外体积） |
| `windows-core` | ^0.61 | MIT OR Apache-2.0 | COM 回调实现宏（wry 传递依赖） |
| `ureq` | ^2 | MIT OR Apache-2.0 | 下载 Pandoc 发行包（rustls，无 OpenSSL） |
| `zip` | ^2 | MIT OR Apache-2.0 | 解压 Pandoc 发行包 |
| `tauri-build` | ^2 | MIT OR Apache-2.0 | 构建脚本（开发期） |
| `serde` / `serde_json` | ^1 | MIT OR Apache-2.0 | 序列化 |

> 注：`serde` 传递依赖 `proc-macro2`/`quote`/`syn` 均为 MIT OR Apache-2.0；
> `tauri` 传递依赖（`wry`、`tao`、`miniserve` 等）均为 MIT OR Apache-2.0 / BSD-3-Clause / Zlib，全部位于白名单内。
>
> **阶段 8 传递依赖抽查（共约 190 个 crate）结论**：除白名单内许可外，存在两类白名单之外但宽松可商用的许可——
> 1. `webpki-roots`（TLS 根证书数据，`ureq`→`rustls` 链路）：**CDLA-Permissive-2.0**，类 BSD 的宽松数据许可，可闭源分发
> 2. `icu_*` / `zerovec` / `zerofrom` / `litemap` 等（`url`→`idna` 链路的 Unicode 国际化库）：**Unicode-3.0**，OSI 认证的类 BSD 宽松许可
>
> 两者均无传染性、允许闭源商用；`ring`（`rustls` 加密后端）为 Apache-2.0 AND ISC，在白名单内。

## 例外条款：Pandoc（阶段 5 引入时生效）

- **Pandoc**（GPL-2.0）：以独立 `pandoc.exe` 可执行文件形式存在，通过子进程（`std::process::Command`）调用，
  **不链接其任何源码或库**。依据 GPL-FAQ，独立进程边界不构成"衍生作品"，故本项目的闭源分发不受传染。
- 分发位置：不随主安装包分发（体积约 180MB），首次使用「导入 Word」功能时引导下载到用户数据目录。
- 官方源：https://github.com/jgm/pandoc/releases

---

*最后更新：阶段 1（项目骨架）*
