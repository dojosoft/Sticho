// Windows 发布版以 GUI 子系统启动：否则会被编译成控制台程序，
// 双击 exe（或通过文件关联打开文档）时系统会额外弹出一个命令行窗口。
// 保留 debug 构建的控制台输出，便于开发期排查。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sticho_lib::run()
}
