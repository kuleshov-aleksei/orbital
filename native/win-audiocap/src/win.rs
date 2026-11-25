//! Small RAII and string helpers around raw Win32 handles.

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Threading::{CreateEventW, SetEvent};
use windows::core::Result;

/// A kernel handle closed on drop.
pub struct OwnedHandle(HANDLE);

impl OwnedHandle {
    /// Takes ownership of `h`; it must be a valid handle that nothing else closes.
    pub fn new(h: HANDLE) -> Self {
        Self(h)
    }

    pub fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // SAFETY: we own the handle and close it exactly once.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}

/// An unnamed event. `manual_reset` keeps it signalled until reset.
pub fn create_event(manual_reset: bool) -> Result<OwnedHandle> {
    // SAFETY: no security attributes and no name; the returned handle is owned.
    let h = unsafe { CreateEventW(None, manual_reset, false, None)? };
    Ok(OwnedHandle::new(h))
}

/// Signals an event given as a raw handle value (shared with other threads).
pub fn signal_raw(raw: usize) {
    if raw != 0 {
        // SAFETY: `raw` is an event handle that stays open for the program's
        // lifetime (see loopback::STOP_EVENT); SetEvent on it is thread-safe.
        let _ = unsafe { SetEvent(HANDLE(raw as *mut _)) };
    }
}

/// UTF-16 buffer (without the terminating NUL) to a Rust string.
pub fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// NUL-terminated UTF-16 copy of `s`, for PCWSTR parameters.
pub fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
