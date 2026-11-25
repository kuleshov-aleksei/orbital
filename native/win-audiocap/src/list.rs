//! `list` (apps with audio sessions) and `pid-of-hwnd`.

use std::collections::BTreeMap;
use std::ffi::{OsString, c_void};

use windows::Win32::Foundation::{HWND, MAX_PATH, S_OK};
use windows::Win32::Media::Audio::{
    AudioSessionStateActive, AudioSessionStateExpired, DEVICE_STATE_ACTIVE, IAudioSessionControl2,
    IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator, eRender,
};
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsWindow};
use windows::core::{Interface, PCWSTR, PWSTR};

use crate::win::{OwnedHandle, from_wide, to_wide};
use crate::{EXIT_ERROR, EXIT_OK, EXIT_TARGET_GONE, fail, json_string};

struct ProcInfo {
    parent: u32,
    exe: String, // file name only, from the snapshot
}

type Procs = BTreeMap<u32, ProcInfo>;

fn snapshot_processes() -> Procs {
    let mut procs = Procs::new();
    // SAFETY: snapshot handle is owned and closed by OwnedHandle.
    let Ok(snap) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return procs;
    };
    let snap = OwnedHandle::new(snap);
    let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
    // SAFETY: `entry` is a correctly sized PROCESSENTRY32W.
    let mut ok = unsafe { Process32FirstW(snap.raw(), &mut entry) }.is_ok();
    while ok {
        procs.insert(
            entry.th32ProcessID,
            ProcInfo { parent: entry.th32ParentProcessID, exe: from_wide(&entry.szExeFile) },
        );
        // SAFETY: as above.
        ok = unsafe { Process32NextW(snap.raw(), &mut entry) }.is_ok();
    }
    procs
}

/// Browsers and Electron apps play audio from a child process. Walk up while
/// the parent runs the same executable, so the app shows up once and an
/// include capture covers the whole tree.
fn app_root(mut pid: u32, procs: &Procs) -> u32 {
    for _ in 0..16 {
        let Some(info) = procs.get(&pid) else { break };
        let Some(parent) = procs.get(&info.parent) else { break };
        if info.parent == pid || !parent.exe.eq_ignore_ascii_case(&info.exe) {
            break;
        }
        pid = info.parent;
    }
    pid
}

fn in_tree(mut pid: u32, root: u32, procs: &Procs) -> bool {
    for _ in 0..32 {
        if pid == 0 {
            return false;
        }
        if pid == root {
            return true;
        }
        match procs.get(&pid) {
            Some(info) if info.parent != pid => pid = info.parent,
            _ => return false,
        }
    }
    false
}

fn process_image_path(pid: u32) -> Option<String> {
    // SAFETY: query-only handle, owned by OwnedHandle.
    let h = OwnedHandle::new(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?);
    let mut buf = [0u16; MAX_PATH as usize * 2];
    let mut size = buf.len() as u32;
    // SAFETY: `buf` has room for `size` UTF-16 units; size is updated on return.
    unsafe { QueryFullProcessImageNameW(h.raw(), PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut size) }
        .ok()?;
    Some(String::from_utf16_lossy(&buf[..size as usize]))
}

/// "Spotify" instead of "Spotify.exe" when the binary has a FileDescription.
fn file_description(path: &str) -> Option<String> {
    let wpath = to_wide(path);
    let path = PCWSTR(wpath.as_ptr());
    // SAFETY: `path` is NUL-terminated and outlives the calls.
    let size = unsafe { GetFileVersionInfoSizeW(path, None) };
    if size == 0 {
        return None;
    }
    let mut data = vec![0u8; size as usize];
    // SAFETY: `data` is exactly `size` bytes.
    unsafe { GetFileVersionInfoW(path, None, size, data.as_mut_ptr().cast()) }.ok()?;

    #[repr(C)]
    struct LangCodePage {
        lang: u16,
        codepage: u16,
    }
    let mut ptr: *mut c_void = std::ptr::null_mut();
    let mut len: u32 = 0;
    let key = to_wide("\\VarFileInfo\\Translation");
    // SAFETY: VerQueryValueW returns a pointer into `data`, valid while `data` lives.
    let found = unsafe { VerQueryValueW(data.as_ptr().cast(), PCWSTR(key.as_ptr()), &mut ptr, &mut len) };
    if !found.as_bool() || ptr.is_null() || (len as usize) < size_of::<LangCodePage>() {
        return None;
    }
    // SAFETY: at least one LangCodePage is present (checked above); unaligned
    // read because the version block makes no alignment promise.
    let tr = unsafe { std::ptr::read_unaligned(ptr as *const LangCodePage) };

    let key = to_wide(&format!(
        "\\StringFileInfo\\{:04x}{:04x}\\FileDescription",
        tr.lang, tr.codepage
    ));
    let mut value: *mut c_void = std::ptr::null_mut();
    let mut len: u32 = 0;
    // SAFETY: as above.
    let found = unsafe { VerQueryValueW(data.as_ptr().cast(), PCWSTR(key.as_ptr()), &mut value, &mut len) };
    if !found.as_bool() || value.is_null() || len == 0 {
        return None;
    }
    // SAFETY: `len` UTF-16 units (including the NUL) inside `data`.
    let units = unsafe { std::slice::from_raw_parts(value as *const u16, len as usize) };
    let name = from_wide(units).trim().to_string();
    (!name.is_empty()).then_some(name)
}

fn base_name(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

struct AppEntry {
    name: String,
    exe: String,
    active: bool,
}

/// Every process with a live audio session on an active render device.
fn session_pids() -> windows::core::Result<Vec<(u32, bool)>> {
    let mut out = Vec::new();
    // SAFETY: COM is initialized (MTA) in main; all interfaces Release on drop.
    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        for d in 0..devices.GetCount()? {
            let Ok(device) = devices.Item(d) else { continue };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
            let Ok(sessions) = manager.GetSessionEnumerator() else { continue };
            for s in 0..sessions.GetCount().unwrap_or(0) {
                let Ok(control) = sessions.GetSession(s) else { continue };
                let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
                if control2.IsSystemSoundsSession() == S_OK {
                    continue; // S_OK = system sounds session, S_FALSE = an app
                }
                let Ok(pid) = control2.GetProcessId() else { continue };
                let Ok(state) = control2.GetState() else { continue };
                if pid == 0 || state == AudioSessionStateExpired {
                    continue;
                }
                out.push((pid, state == AudioSessionStateActive));
            }
        }
    }
    Ok(out)
}

pub fn cmd_list(skip_tree: Option<u32>) -> i32 {
    let sessions = match session_pids() {
        Ok(s) => s,
        Err(e) => return fail(EXIT_ERROR, "enumerating audio sessions failed", e.code()),
    };
    let procs = snapshot_processes();
    let mut apps: BTreeMap<u32, AppEntry> = BTreeMap::new(); // keyed by app root pid

    for (pid, active) in sessions {
        if skip_tree.is_some_and(|root| in_tree(pid, root, &procs)) {
            continue;
        }
        let root = app_root(pid, &procs);
        if let Some(existing) = apps.get_mut(&root) {
            existing.active |= active;
            continue;
        }
        let path = process_image_path(root);
        let exe = match path.as_deref().map(base_name).filter(|s| !s.is_empty()) {
            Some(exe) => exe.to_string(),
            None => match procs.get(&root) {
                Some(info) if !info.exe.is_empty() => info.exe.clone(),
                _ => continue,
            },
        };
        let name = path.as_deref().and_then(file_description).unwrap_or_else(|| {
            exe.rsplit_once('.').map_or(exe.clone(), |(stem, _)| stem.to_string())
        });
        apps.insert(root, AppEntry { name, exe, active });
    }

    let items: Vec<String> = apps
        .iter()
        .map(|(pid, app)| {
            format!(
                "{{\"pid\":{pid},\"name\":{},\"exe\":{},\"active\":{}}}",
                json_string(&app.name),
                json_string(&app.exe),
                app.active
            )
        })
        .collect();
    println!("[{}]", items.join(","));
    EXIT_OK
}

pub fn cmd_pid_of_hwnd(arg: &OsString) -> i32 {
    let Some(value) = arg.to_str().and_then(|s| s.parse::<u64>().ok()).filter(|&v| v != 0) else {
        return fail(EXIT_ERROR, "invalid hwnd", windows::core::HRESULT(0));
    };
    let hwnd = HWND(value as usize as *mut c_void);
    let mut pid: u32 = 0;
    // SAFETY: IsWindow validates the handle before we query its owner.
    let found = unsafe { IsWindow(Some(hwnd)).as_bool() && GetWindowThreadProcessId(hwnd, Some(&mut pid)) != 0 };
    if !found || pid == 0 {
        return fail(EXIT_TARGET_GONE, "window not found", windows::core::HRESULT(0));
    }
    println!("{{\"pid\":{}}}", app_root(pid, &snapshot_processes()));
    EXIT_OK
}

#[cfg(test)]
mod tests {
    use super::*;

    fn procs(list: &[(u32, u32, &str)]) -> Procs {
        list.iter()
            .map(|&(pid, parent, exe)| (pid, ProcInfo { parent, exe: exe.to_string() }))
            .collect()
    }

    #[test]
    fn app_root_walks_same_exe_parents() {
        let p = procs(&[(1, 0, "explorer.exe"), (10, 1, "firefox.exe"), (11, 10, "FIREFOX.EXE"), (12, 11, "firefox.exe")]);
        assert_eq!(app_root(12, &p), 10);
        assert_eq!(app_root(1, &p), 1);
        assert_eq!(app_root(99, &p), 99);
    }

    #[test]
    fn in_tree_follows_parents() {
        let p = procs(&[(1, 0, "a.exe"), (2, 1, "b.exe"), (3, 2, "c.exe"), (4, 4, "loop.exe")]);
        assert!(in_tree(3, 1, &p));
        assert!(!in_tree(1, 3, &p));
        assert!(!in_tree(4, 1, &p));
    }

    #[test]
    fn base_name_strips_dirs() {
        assert_eq!(base_name("C:\\Program Files\\Spotify\\Spotify.exe"), "Spotify.exe");
        assert_eq!(base_name("Spotify.exe"), "Spotify.exe");
    }
}
