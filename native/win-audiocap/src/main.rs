//! orbital-audiocap: per-application audio capture for the Orbital desktop app
//! on Windows. Spec: docs/specs/WINDOWS_APP_AUDIO.md
//!
//! Uses the Windows process loopback API (ActivateAudioInterfaceAsync with
//! AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK). The flow follows Microsoft's
//! ApplicationLoopback sample (Windows-classic-samples, MIT License,
//! Copyright (c) Microsoft Corporation).
//!
//! Commands (stdout = data, stderr = logs/events as JSON lines):
//!   probe                                {"supported":true,"build":22631}
//!   list [--skip-tree <pid>]             [{"pid":1,"name":"...","exe":"...","active":true}]
//!   pid-of-hwnd <hwnd>                   {"pid":1234}
//!   capture --include <pid> [--out f.wav]  raw s16le 48 kHz stereo PCM on stdout
//!   capture --exclude <pid> [--out f.wav]  (or a WAV file with --out)
//!
//! Exit codes: 0 ok / stopped, 1 error, 2 API unsupported, 3 target gone.
//! capture stops when stdin closes (the parent died or asked it to stop) or on
//! Ctrl+C.

#[cfg(not(windows))]
compile_error!("orbital-audiocap only builds for Windows (cargo uses x86_64-pc-windows-gnu by default here)");

mod list;
mod loopback;
mod wav;
mod win;

use std::ffi::OsString;
use std::path::PathBuf;

use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
use windows::core::HRESULT;

pub const EXIT_OK: i32 = 0;
pub const EXIT_ERROR: i32 = 1;
pub const EXIT_UNSUPPORTED: i32 = 2;
pub const EXIT_TARGET_GONE: i32 = 3;

/// JSON string literal for `s` (quotes included).
pub fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// One JSON line on stderr (events and errors; stdout may carry PCM).
pub fn emit_event(line: &str) {
    eprintln!("{line}");
}

/// Logs an error as JSON on stderr and returns `code`.
pub fn fail(code: i32, message: &str, hr: HRESULT) -> i32 {
    emit_event(&format!(
        "{{\"error\":{},\"hresult\":\"0x{:08X}\"}}",
        json_string(message),
        hr.0 as u32
    ));
    code
}

fn usage() -> i32 {
    eprintln!(
        "usage: orbital-audiocap probe\n       \
         orbital-audiocap list [--skip-tree <pid>]\n       \
         orbital-audiocap pid-of-hwnd <hwnd>\n       \
         orbital-audiocap capture (--include|--exclude) <pid> [--out <file.wav>]"
    );
    EXIT_ERROR
}

fn parse_pid(s: &OsString) -> Option<u32> {
    let v: u64 = s.to_str()?.parse().ok()?;
    (v != 0 && v <= u32::MAX as u64).then_some(v as u32)
}

fn run(args: &[OsString]) -> i32 {
    let cmd = args.first().and_then(|a| a.to_str()).unwrap_or("");
    match (cmd, args.len()) {
        ("probe", 1) => loopback::cmd_probe(),
        ("list", 1) => list::cmd_list(None),
        ("list", 3) if args[1] == "--skip-tree" => match parse_pid(&args[2]) {
            Some(pid) => list::cmd_list(Some(pid)),
            None => usage(),
        },
        ("pid-of-hwnd", 2) => list::cmd_pid_of_hwnd(&args[1]),
        ("capture", 3 | 5) => {
            let mode = match args[1].to_str() {
                Some("--include") => loopback::Mode::IncludeTree,
                Some("--exclude") => loopback::Mode::ExcludeTree,
                _ => return usage(),
            };
            let Some(pid) = parse_pid(&args[2]) else { return usage() };
            let out = match args.get(3..) {
                Some([flag, path]) if flag == "--out" => Some(PathBuf::from(path)),
                Some([]) | None => None,
                _ => return usage(),
            };
            loopback::cmd_capture(pid, mode, out)
        }
        _ => usage(),
    }
}

fn main() {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    if args.is_empty() {
        std::process::exit(usage());
    }

    // SAFETY: called once on the main thread before any COM use; balanced by
    // CoUninitialize below after every COM object created in `run` is dropped.
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if hr.is_err() {
        std::process::exit(fail(EXIT_ERROR, "CoInitializeEx failed", hr));
    }
    let code = run(&args);
    // SAFETY: matches the successful CoInitializeEx above.
    unsafe { CoUninitialize() };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::json_string;

    #[test]
    fn escapes_json() {
        assert_eq!(json_string("a\"b\\c\n\u{1}"), "\"a\\\"b\\\\c\\n\\u0001\"");
        assert_eq!(json_string("Spotify"), "\"Spotify\"");
    }
}
