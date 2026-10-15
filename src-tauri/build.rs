fn main() {
    // 图标/配置改动必须让 build script 重跑：tauri-build 生成的 Windows 资源
    // （resource.rc / resource.lib，内嵌 exe 图标）只在 build script 运行时重建。
    // 若只改图标文件、sources 未变，cargo 不会重跑 build script，exe 仍内嵌旧图标。
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    tauri_build::build()
}
