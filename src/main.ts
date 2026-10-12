import { mount } from "svelte";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.svelte";
import "./styles/app.css";

const app = mount(App, {
  target: document.getElementById("app")!,
});

// 兜底亮窗：窗口配置为 visible:false，正常由 App 的 onMount 在首帧就绪后 show()。
// 若启动流程意外中断（脚本异常等），5 秒后强制显示，避免应用「看不见」。
// show() 幂等，重复调用无副作用。失败要留日志（比如 capabilities 漏配
// core:window:allow-show 时，曾经静默失败导致窗口永不显示）。
window.setTimeout(() => {
  getCurrentWindow()
    .show()
    .catch((e) => console.error("[sticho] 兜底亮窗失败：", e));
}, 5000);

export default app;
