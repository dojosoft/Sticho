# Sticho

轻量级 Windows 桌面 Markdown 编辑器：像记事本一样打开 `.md` 编辑，一键导出 Word / PDF，导入 Word / PDF 转 Markdown 继续编辑。全程离线，适合涉密文档环境。

版本变化见 [CHANGELOG.md](./CHANGELOG.md)。

## 安装

- 系统要求：Windows 10 1809 及以上（x64）
- 下载 `Sticho_x.x.x_x64-setup.exe` 双击安装
- 安装包内嵌 WebView2 引导器：系统缺少 WebView2 运行时时会自动引导安装（在线），Win10/11 一般已自带，无需额外操作

### 为什么双击安装包时会提示「未知发布者」

安装包没有购买代码签名证书（一张 Windows 代码签名证书需按年付费，个人项目通常不划算），因此
Windows SmartScreen 会显示「Windows 已保护你的电脑 / 未知发布者」。这代表**未签名**，不代表有病毒。
判断与继续安装的方式：

1. 点「更多信息」，确认发布者一栏显示为「未知发布者」而非某个陌生公司名；
2. 想核对文件完整性时，在项目目录执行 `npm run check-version` 打印安装包的 SHA256，与发布页给出的值比对；
3. 确认无误后点「仍要运行」即可正常安装。安装过程不需要管理员权限（`currentUser` 模式）。

安装包内嵌的 WebView2 引导器在系统缺失运行时时会联网下载，这是安装阶段唯一的网络请求；程序本体运行时除
「按需下载 Pandoc」外不发起任何网络请求。

## 功能

| 功能 | 说明 |
|---|---|
| Markdown 所见即所得 | 即时渲染（类 Typora），基于 Vditor |
| 打开 HTML | .html 转 Markdown 继续编辑（turndown + GFM，支持表格/删除线/任务列表） |
| 导出 Word | 标题层级 / 列表 / 表格 / 代码块 / 引用，中文字体显式指定微软雅黑 |
| 导出 HTML | 单文件、样式内嵌、浏览器直接打开，图片以 data URI 自包含 |
| 导出 PDF | A4 版式，中文无方块字，静默导出无打印对话框 |
| 导入 Word | Pandoc 转换（首次使用时引导下载，存于用户数据目录，不随安装包分发） |
| 导入 PDF | 文字版 PDF 提取文本与标题层级，尽力转换 |
| 拖拽打开 | md / html / docx / pdf 拖入窗口直接打开或导入 |
| 深浅色主题 | 手动切换并记忆；未设置时跟随系统 |
| 最近文件 | 最多记住 10 个，失效条目自动清理 |
| 快捷键 | Ctrl+N 新建 / Ctrl+O 打开 / Ctrl+S 保存 / Ctrl+K 命令面板 / Ctrl+Shift+E 导出 Word / Ctrl+Shift+P 导出 PDF |
| 状态栏 | 字数统计（汉字逐字 + 英文按词）、当前路径、保存状态 |

## 已知限制

- **PDF 导入为尽力转换**：仅支持文字版 PDF；扫描件（图片型）会明确提示无法提取；表格、多栏排版、代码块退化为纯文本，需人工校正
- **Markdown 文件需 UTF-8 编码**：GBK/ANSI 文件会提示转存，暂不支持自动转换
- **文件大小上限**：.md 10MB / PDF 50MB
- Pandoc（GPL-2.0）以独立子进程方式按需下载调用，不进入安装包，不与本项目链接

## 隐私与安全

- 零联网：除首次按需下载 Pandoc 外不做任何网络请求
- 无数据上报、无统计埋点
- 只在用户显式选择的路径读写文件
- 许可证合规：全部直接依赖为可商用、可闭源、无传染许可证，详见 [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)

## 开发

```powershell
npm install
npm run tauri dev        # 开发调试
npm run tauri build      # 打包 msi + nsis
npm run check-version    # 校验三处版本号一致，并打印安装包 SHA256
npm run i18n-missing     # 列出未收录英文的界面文案
```

技术栈：Tauri 2（Rust）+ Svelte 5 + Vite 6 + Vditor 3 + TypeScript strict。