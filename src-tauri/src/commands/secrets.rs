//! WebDAV 凭据的加密存储（Windows DPAPI）。
//!
//! 此前 WebDAV 密码以**明文**写在 `settings.json`，备份 / 云盘同步 / 迁移都会把凭据带走。
//! 这里改用系统自带 DPAPI（`CryptProtectData` / `CryptUnprotectData`）：
//! 密文与当前 Windows 用户绑定，换用户或换机器都无法解密，且**不引入任何第三方加密库**
//! （直接链接系统 `crypt32` / `kernel32`）。
//!
//! 存储位置同样是「数据根目录」下的 `secrets.json`，只保存一条 `dav_password`（base64 密文）。

use std::path::PathBuf;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

use super::config;

/// 密文文件名（挂在数据根目录下，跟随「用户目录 / 程序目录」切换）
const SECRETS_FILE: &str = "secrets.json";

/// DPAPI：禁止弹出任何 UI（服务或后台调用必须带，否则可能弹框阻塞）
const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

/// CRYPT_INTEGER_BLOB（与 Windows 的 DATA_BLOB 同布局）
#[repr(C)]
struct DataBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

#[link(name = "crypt32")]
extern "system" {
    fn CryptProtectData(
        p_data_in: *const DataBlob,
        sz_data_descr: *const u16,
        p_optional_entropy: *const DataBlob,
        pv_reserved: *mut core::ffi::c_void,
        p_prompt_struct: *mut core::ffi::c_void,
        dw_flags: u32,
        p_data_out: *mut DataBlob,
    ) -> i32;

    fn CryptUnprotectData(
        p_data_in: *const DataBlob,
        pp_sz_data_descr: *mut *mut u16,
        p_optional_entropy: *const DataBlob,
        pv_reserved: *mut core::ffi::c_void,
        p_prompt_struct: *mut core::ffi::c_void,
        dw_flags: u32,
        p_data_out: *mut DataBlob,
    ) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(h_mem: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
}

/// DPAPI 加密；失败返回中文原因。
fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let input = DataBlob {
            cb_data: plain.len() as u32,
            pb_data: plain.as_ptr() as *mut u8,
        };
        let mut out = DataBlob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };
        let ok = CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        );
        if ok == 0 {
            return Err("加密失败（DPAPI 调用失败）".to_string());
        }
        let bytes = std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec();
        LocalFree(out.pb_data as *mut core::ffi::c_void);
        Ok(bytes)
    }
}

/// DPAPI 解密；换用户 / 换机器 / 密文损坏都会失败。
fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let input = DataBlob {
            cb_data: cipher.len() as u32,
            pb_data: cipher.as_ptr() as *mut u8,
        };
        let mut out = DataBlob {
            cb_data: 0,
            pb_data: std::ptr::null_mut(),
        };
        let ok = CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        );
        if ok == 0 {
            return Err("解密失败".to_string());
        }
        let bytes = std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec();
        LocalFree(out.pb_data as *mut core::ffi::c_void);
        Ok(bytes)
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Secrets {
    /// base64 的 DPAPI 密文；None 表示未配置
    #[serde(default)]
    dav_password: Option<String>,
}

fn secrets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(config::data_root(app)?.join(SECRETS_FILE))
}

/// 读取密文文件；不存在 / 损坏一律回落为空（凭据只是锦上添花，不能阻断启动）。
fn read_secrets(app: &tauri::AppHandle) -> Secrets {
    let Ok(path) = secrets_path(app) else {
        return Secrets::default();
    };
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Secrets::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_secrets(app: &tauri::AppHandle, s: &Secrets) -> Result<(), String> {
    let path = secrets_path(app)?;
    let json = serde_json::to_string(s).map_err(|e| format!("序列化失败：{e}"))?;
    super::file_io::atomic_write(&path.to_string_lossy(), json.as_bytes())
}

/// 保存 WebDAV 密码（加密后落盘）。传空串表示清除已保存的密码。
#[tauri::command]
pub fn save_dav_password(app: tauri::AppHandle, password: String) -> Result<(), String> {
    let mut s = read_secrets(&app);
    if password.is_empty() {
        s.dav_password = None;
    } else {
        let cipher = protect(password.as_bytes())?;
        s.dav_password = Some(base64::engine::general_purpose::STANDARD.encode(cipher));
    }
    write_secrets(&app, &s)
}

/// 读取 WebDAV 密码明文；未配置或解密失败返回 None（前端据此提示用户重新填写）。
#[tauri::command]
pub fn load_dav_password(app: tauri::AppHandle) -> Option<String> {
    let s = read_secrets(&app);
    let enc = s.dav_password?;
    let cipher = base64::engine::general_purpose::STANDARD.decode(enc.as_bytes()).ok()?;
    let bytes = unprotect(&cipher).ok()?;
    String::from_utf8(bytes).ok()
}