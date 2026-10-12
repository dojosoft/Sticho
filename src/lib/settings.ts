/**
 * 设置持久化封装（任务书阶段 7：主题 / 最近文件记忆）
 *
 * 基于 @tauri-apps/plugin-store，数据落在「数据根目录」的 settings.json。
 * 数据根目录由 Rust 侧 get_settings_path 决定（系统用户目录 or 程序当前目录），
 * plugin-store 支持绝对路径，因此这里先问路径再 load。
 *
 * 读写失败一律静默降级：设置只是锦上添花，不能因存储故障打断编辑。
 */
import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = (async () => {
      // 不再回落到相对路径 "settings.json"：那会悄悄换到另一个位置读写，
      // 用户看到的现象是「设置全丢了」。拿不到路径就整体失败，由调用方按默认值兜底。
      const path = await invoke<string>("get_settings_path");
      return load(path, { autoSave: true });
    })().catch((e) => {
      storePromise = null; // 允许后续调用重试，避免一次失败永久锁死
      throw e;
    });
  }
  return storePromise;
}

export async function loadSetting<T>(key: string): Promise<T | undefined> {
  try {
    const store = await getStore();
    return (await store.get<T>(key)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * 一次性读回全部设置（启动路径专用）。
 *
 * 启动时要读约二十个键，逐键 loadSetting 是二十次串行 IPC；这里一次
 * entries() 全量拿回，onMount 里改为同步解构，首帧明显提前。
 */
export async function loadAllSettings(): Promise<Record<string, unknown>> {
  try {
    const store = await getStore();
    return Object.fromEntries(await store.entries<unknown>());
  } catch {
    return {}; // 与 loadSetting 同策略：读不到按默认值兜底
  }
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  try {
    const store = await getStore();
    await store.set(key, value);
    await store.save(); // autoSave 有防抖，这里显式落盘保险
  } catch {
    // 持久化失败不影响当前会话，下次启动回退默认值
  }
}

/** 删除一个键（用于把历史遗留的敏感项从 settings.json 里清掉） */
export async function deleteSetting(key: string): Promise<void> {
  try {
    const store = await getStore();
    await store.delete(key);
    await store.save();
  } catch {
    // 忽略：键本就不存在或存储不可用
  }
}
