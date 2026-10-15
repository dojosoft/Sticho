/**
 * 自动保存与外部变更轮询（批次 3.3 从 App.svelte 抽取）
 *
 * 这里只放不直接读写组件状态的逻辑：草稿指纹、定时器封装、按标签落草稿、
 * 磁盘修改时间比对。组件状态（busy / dirty / tabs …）通过 context 注入，
 * 因此本模块可直接单测。
 *
 * 两条设计约束（原实现即如此，勿改）：
 *   - 自动保存**绝不改 `dirty`**：草稿只是磁盘外的兜底副本，标题的 `●` 与关窗
 *     拦截仍按「未保存」处理，否则用户会以为已经保存过了。
 *   - 落草稿失败必须静默吞掉：兜底机制出错不能打断编辑（否则每 30 秒弹一次框）。
 */

import type { DocTab } from "./docState";

/** 外部变更轮询间隔：5 秒一轮 */
export const EXTERNAL_POLL_INTERVAL_MS = 5_000;

/** 启动一个定时轮询，返回停止函数（页面卸载时调用以清除定时器） */
export function startPolling(intervalMs: number, tick: () => void): () => void {
  const id = window.setInterval(tick, intervalMs);
  return () => window.clearInterval(id);
}

/**
 * 草稿内容指纹（全量 FNV-1a 32 位 + 长度）：内容没变就不重复写盘。
 *
 * 原实现只取「长度 + 前 64 字符」，在长文档中段/末段改动而总长度与前 64 字符
 * 不变时（例如改一个词、改个数字）指纹相等 → 本轮跳过写盘，草稿永远停留在旧
 * 内容，崩溃恢复会把用户已有的修改回退掉。全量哈希不会漏掉任何位置的改动。
 */
export function recoveryFingerprint(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${content.length}:${(h >>> 0).toString(16)}`;
}

/** 一条恢复草稿（与 tauri-api 的 writeRecovery 载荷同形） */
export type RecoveryPayload = {
  id: string;
  path: string | null;
  title: string;
  kind: string;
  encoding: string;
  content: string;
};

/** 自动保存落草稿所需的外部依赖（由调用方注入） */
export type AutoSaveContext = {
  /** 自动保存开关（用户设置，默认开） */
  enabled: boolean;
  /** 有长任务在跑时跳过本轮，避免与读写抢盘 */
  busy: boolean;
  /** 标签体系就绪前不做自动保存（正文还没法安全快照） */
  ready: boolean;
  tabs: DocTab[];
  /** 把活跃标签的最新内容写回快照 */
  captureActiveTab: () => void;
  /** 落一份恢复草稿 */
  writeRecovery: (payload: RecoveryPayload) => Promise<void>;
  /** 删除一份恢复草稿（文档被清空时让旧草稿失效） */
  deleteRecovery: (id: string) => Promise<void>;
  /** 记录标签集会话 */
  saveSession: () => Promise<void>;
  /** 路径 → 文件名 */
  fileNameOf: (path: string) => string;
  /** 未命名文档的显示名（已翻译） */
  unnamedLabel: string;
};

/**
 * 按标签逐个落恢复草稿并记录会话。
 *
 * 批次六起按标签逐个落：每个脏标签一份草稿（id = `d-<tab.id>`，与路径无关，
 * 同一文件在两个标签里各改各的也不会互相覆盖），正文取自各自的快照；
 * 同时把标签集写进会话，启动时据此整体恢复（见 App.svelte 的 tryRestoreSession）。
 */
export async function runAutoSave(ctx: AutoSaveContext): Promise<void> {
  if (!ctx.enabled || ctx.busy || !ctx.ready) return;
  ctx.captureActiveTab(); // 活跃标签的最新内容先回到快照，下面统一按快照落盘
  for (const tab of ctx.tabs) {
    if (!tab.dirty) continue;
    // 逐个标签各自兜错：某个标签持续写不进去时（典型是它的内容含当前编码表示不了的字符，
    // 这类失败每轮都会重演），不能让它掐断整轮循环——否则排在它后面的脏标签永远拿不到
    // 草稿，异常退出即丢内容。失败一律静默：草稿是兜底机制，不能打断编辑。
    try {
      const payload = tab.content;
      const hash = recoveryFingerprint(payload);
      if (hash === tab.draftHash) continue; // 内容没变，省一次写盘
      if (!payload.trim()) {
        // 文档被清空：必须让旧草稿一起失效。旧行为是直接跳过（既不写也不删），
        // 于是异常退出后按会话恢复时会读回上一份非空草稿，把用户已删掉的内容又“还原”回来。
        if (tab.draftHash !== "") await ctx.deleteRecovery(tab.draftId);
        tab.draftHash = hash;
        continue;
      }
      await ctx.writeRecovery({
        id: tab.draftId,
        path: tab.path,
        title: tab.path ? ctx.fileNameOf(tab.path) : ctx.unnamedLabel,
        kind: tab.kind,
        encoding: tab.encoding,
        content: payload,
      });
      tab.draftHash = hash;
    } catch {
      // 同上：静默吞掉，交给下一轮重试
    }
  }
  // 会话落盘同样静默：原先这里裸调用，失败会变成未处理的 Promise 拒绝，
  // 而调用方多为 `void runAutoSave(...)`，没人接这个 reject。
  try {
    await ctx.saveSession();
  } catch {
    // 同上：兜底机制不能打断编辑
  }
}

/** 「外部变更」三选对话框的一个选项 */
export type ExternalChoiceOption = { label: string; value: string; primary?: boolean };

/** 外部变更轮询所需的外部依赖（读状态用 getter，保证拿到「当前」值而非调用瞬间的快照） */
export type ExternalChangeContext = {
  getBusy: () => boolean;
  /** 本轮是否已在检查中（防重入） */
  getChecking: () => boolean;
  /** 当前文档路径；null = 尚未保存的新文档 */
  getCurrentPath: () => string | null;
  /** 磁盘修改时间基准；null = 尚未建立基准 */
  getDiskMtime: () => number | null;
  getDirty: () => boolean;
  /** 窗口是否可见（不可见时跳过：省 IPC 也避免在后台弹出模态框） */
  isVisible: () => boolean;
  readDiskMtime: (path: string) => Promise<number | null>;
  reloadFromDisk: (path: string) => Promise<void>;
  saveFileAs: () => Promise<void>;
  ask: (message: string, options: ExternalChoiceOption[], title: string) => Promise<string | null>;
  setChecking: (checking: boolean) => void;
  setDiskMtime: (mtime: number | null) => void;
  labels: { message: string; reload: string; keep: string; saveAs: string; title: string };
};

/**
 * 外部变更轮询（每 5 秒一轮，仅针对已保存到磁盘的文档）。
 *
 * 用文件修改时间比对，不做文件系统监听——轮询的粒度足够覆盖「别的编辑器 / 脚本
 * 改了同一份文件」，且没有 watcher 常驻句柄的代价。自己保存后会把基准时间刷新
 * （syncDiskMtime），所以不会误报。文件被删除时读不到时间，直接跳过（不打扰用户）。
 */
export async function runExternalChangeCheck(ctx: ExternalChangeContext): Promise<void> {
  if (ctx.getBusy() || ctx.getChecking() || ctx.getCurrentPath() === null || ctx.getDiskMtime() === null) {
    return;
  }
  if (!ctx.isVisible()) return;
  const path = ctx.getCurrentPath()!;
  ctx.setChecking(true);
  try {
    const mtime = await ctx.readDiskMtime(path);
    if (mtime === null || mtime === ctx.getDiskMtime() || ctx.getCurrentPath() !== path) return;
    ctx.setDiskMtime(mtime); // 先更新基准：用户还在选的时候，下一轮不该再弹一次
    if (!ctx.getDirty()) {
      await ctx.reloadFromDisk(path); // 本地没有改动：静默跟上磁盘版本
      return;
    }
    const choice = await ctx.ask(
      ctx.labels.message,
      [
        { label: ctx.labels.reload, value: "reload", primary: true },
        { label: ctx.labels.keep, value: "keep" },
        { label: ctx.labels.saveAs, value: "saveas" },
      ],
      ctx.labels.title,
    );
    // 询问期间用户可能已经切走标签（切换只校验 busy，而这里不能让整个应用变 busy）。
    // 此刻动作必须落到「当初报变更的那份文档」上：否则 reloadFromDisk 会按新标签的 docKind
    // 去打开旧路径（例如用代码通路打开一个 .md），把当前标签的正文与路径一起换掉。
    if (ctx.getCurrentPath() !== path) return;
    if (choice === "reload") await ctx.reloadFromDisk(path);
    else if (choice === "saveas") await ctx.saveFileAs();
    // "keep"：什么都不做。本次改动仍留在编辑器里，等用户自己决定何时保存
  } catch {
    // 轮询失败（权限变化等）：不打扰用户，交给下一轮
  } finally {
    ctx.setChecking(false);
  }
}