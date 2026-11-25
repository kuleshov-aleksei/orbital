//! Process loopback activation, `probe` and `capture`.

use std::io::{self, BufWriter, Read, Write};
use std::mem::ManuallyDrop;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use windows::Win32::Foundation::{E_FAIL, ERROR_TIMEOUT, HANDLE, WAIT_FAILED, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, PROCESS_LOOPBACK_MODE,
    PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
    WAVE_FORMAT_PCM, WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{BLOB, IAgileObject, IAgileObject_Impl};
use windows::Win32::System::Console::SetConsoleCtrlHandler;
use windows::Win32::System::SystemInformation::OSVERSIONINFOW;
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, PROCESS_SYNCHRONIZE, WaitForMultipleObjects,
    WaitForSingleObject,
};
use windows::Win32::System::Variant::VT_BLOB;
use windows::Wdk::System::SystemServices::RtlGetVersion;
use windows::core::{BOOL, HRESULT, IUnknown, Interface, Ref, implement, w};

use crate::wav::WavWriter;
use crate::win::{OwnedHandle, create_event, signal_raw};
use crate::{EXIT_ERROR, EXIT_OK, EXIT_TARGET_GONE, EXIT_UNSUPPORTED, emit_event, fail};

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: u16 = 2;
pub const BITS: u16 = 16;
const BLOCK_ALIGN: u32 = CHANNELS as u32 * BITS as u32 / 8;

const ACTIVATE_TIMEOUT_MS: u32 = 5_000;
const WAIT_TIMEOUT_MS: u32 = 2_000;
/// 100 ms engine buffer, in 100 ns units.
const BUFFER_DURATION: i64 = 1_000_000;
const STATS_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Clone, Copy)]
pub enum Mode {
    IncludeTree,
    ExcludeTree,
}

impl Mode {
    fn api(self) -> PROCESS_LOOPBACK_MODE {
        match self {
            Mode::IncludeTree => PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            Mode::ExcludeTree => PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
        }
    }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/// Completion handler: just signals an event; the result is read afterwards.
/// Agile, because the audio service calls it on an arbitrary thread.
#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Completion {
    done: usize, // raw event handle, owned by `activate_loopback_client`
}

impl IActivateAudioInterfaceCompletionHandler_Impl for Completion_Impl {
    fn ActivateCompleted(
        &self,
        _operation: Ref<'_, IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        signal_raw(self.done);
        Ok(())
    }
}

impl IAgileObject_Impl for Completion_Impl {}

/// Why activation failed: `Unsupported` means process loopback isn't
/// available here (old Windows, missing API); `Error` is anything else.
enum ActivateError {
    Unsupported(HRESULT),
    Error(HRESULT),
}

/// Activates an IAudioClient on the process loopback virtual device.
fn activate_loopback_client(pid: u32, mode: Mode) -> Result<IAudioClient, ActivateError> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: mode.api(),
            },
        },
    };
    // A VT_BLOB PROPVARIANT pointing at `params` on our stack. It does not own
    // the blob, so it must never be passed to PropVariantClear (ManuallyDrop).
    let pv = ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: (&raw mut params).cast(),
                    },
                },
            }),
        },
    });

    let done = create_event(true).map_err(|e| ActivateError::Error(e.code()))?;
    let handler: IActivateAudioInterfaceCompletionHandler =
        Completion { done: done.raw().0 as usize }.into();

    // SAFETY: `pv` and `params` outlive the call and the wait below (the API
    // copies the activation params before completing); IID matches IAudioClient.
    let operation = unsafe {
        ActivateAudioInterfaceAsync(
            w!("VAD\\Process_Loopback"),
            &IAudioClient::IID,
            Some(&*pv as *const PROPVARIANT),
            &handler,
        )
    }
    .map_err(|e| ActivateError::Unsupported(e.code()))?;

    // SAFETY: `done` is a valid event handle owned by this function.
    if unsafe { WaitForSingleObject(done.raw(), ACTIVATE_TIMEOUT_MS) } != WAIT_OBJECT_0 {
        return Err(ActivateError::Error(ERROR_TIMEOUT.to_hresult()));
    }

    let mut activate_result = E_FAIL;
    let mut unknown: Option<IUnknown> = None;
    // SAFETY: both out pointers are valid locals; the operation has completed.
    unsafe { operation.GetActivateResult(&mut activate_result, &mut unknown) }
        .map_err(|e| ActivateError::Unsupported(e.code()))?;
    activate_result.ok().map_err(|e| ActivateError::Unsupported(e.code()))?;
    let unknown = unknown.ok_or(ActivateError::Unsupported(E_FAIL))?;
    unknown.cast::<IAudioClient>().map_err(|e| ActivateError::Error(e.code()))
}

fn windows_build() -> u32 {
    let mut info = OSVERSIONINFOW {
        dwOSVersionInfoSize: size_of::<OSVERSIONINFOW>() as u32,
        ..Default::default()
    };
    // SAFETY: `info` is a valid, correctly sized OSVERSIONINFOW.
    let status = unsafe { RtlGetVersion(&mut info) };
    if status.is_ok() { info.dwBuildNumber } else { 0 }
}

// ---------------------------------------------------------------------------
// probe
// ---------------------------------------------------------------------------

pub fn cmd_probe() -> i32 {
    // Activating with "everything except ourselves" exercises the real API
    // path without needing a target.
    // SAFETY: trivial call without arguments.
    let me = unsafe { GetCurrentProcessId() };
    let result = activate_loopback_client(me, Mode::ExcludeTree);
    let supported = result.is_ok();
    println!("{{\"supported\":{supported},\"build\":{}}}", windows_build());
    match result {
        Ok(_) => EXIT_OK,
        Err(ActivateError::Unsupported(_)) => EXIT_UNSUPPORTED,
        Err(ActivateError::Error(hr)) => fail(EXIT_ERROR, "probe failed", hr),
    }
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

/// Stop event shared with the stdin watcher thread and the Ctrl+C handler, as
/// a raw handle value. The event is created once and never closed.
static STOP_EVENT: AtomicUsize = AtomicUsize::new(0);

unsafe extern "system" fn on_console_ctrl(_ctrl_type: u32) -> BOOL {
    signal_raw(STOP_EVENT.load(Ordering::SeqCst));
    true.into() // handled: let the capture loop stop cleanly
}

/// Blocks on stdin until the parent closes it (or dies), then signals stop.
fn watch_stdin() {
    let mut stdin = io::stdin().lock();
    let mut buf = [0u8; 64];
    while matches!(stdin.read(&mut buf), Ok(n) if n > 0) {}
    signal_raw(STOP_EVENT.load(Ordering::SeqCst));
}

/// Where the PCM goes: the parent's pipe, or a WAV file (`--out`).
enum Sink {
    Stdout(BufWriter<io::StdoutLock<'static>>),
    Wav(WavWriter),
}

impl Sink {
    fn write(&mut self, data: &[u8]) -> io::Result<()> {
        match self {
            Sink::Stdout(w) => w.write_all(data),
            Sink::Wav(w) => w.write(data),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Sink::Stdout(w) => w.flush(),
            Sink::Wav(_) => Ok(()),
        }
    }

    fn finish(self) {
        match self {
            Sink::Stdout(mut w) => {
                let _ = w.flush();
            }
            Sink::Wav(w) => {
                if let Err(e) = w.finish() {
                    fail(EXIT_ERROR, &format!("finishing WAV file failed: {e}"), E_FAIL);
                }
            }
        }
    }
}

/// Running counters for the periodic `stats` event.
#[derive(Default)]
struct Stats {
    frames: u64,
    packets: u64,
    silent_packets: u64,
    peak: i32,
}

impl Stats {
    fn add(&mut self, pcm: &[u8], frames: u32, silent: bool) {
        self.frames += frames as u64;
        self.packets += 1;
        if silent {
            self.silent_packets += 1;
            return;
        }
        let (samples, _) = pcm.as_chunks::<2>();
        for s in samples {
            let v = (i16::from_le_bytes(*s) as i32).abs();
            if v > self.peak {
                self.peak = v;
            }
        }
    }

    /// Emits the totals since the last report, then resets them.
    fn report(&mut self) {
        emit_event(&format!(
            "{{\"event\":\"stats\",\"frames\":{},\"packets\":{},\"silent_packets\":{},\"peak\":{}}}",
            self.frames, self.packets, self.silent_packets, self.peak
        ));
        *self = Stats::default();
    }
}

pub fn cmd_capture(pid: u32, mode: Mode, out: Option<PathBuf>) -> i32 {
    // Watch the target so the capture ends when the app quits.
    let target = match mode {
        // SAFETY: plain handle query; the result is owned by OwnedHandle.
        Mode::IncludeTree => match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
            Ok(h) => Some(OwnedHandle::new(h)),
            Err(e) => return fail(EXIT_TARGET_GONE, "target process not found", e.code()),
        },
        Mode::ExcludeTree => None,
    };

    let client = match activate_loopback_client(pid, mode) {
        Ok(c) => c,
        Err(ActivateError::Unsupported(hr)) => {
            return fail(EXIT_UNSUPPORTED, "process loopback unsupported", hr);
        }
        Err(ActivateError::Error(hr)) => return fail(EXIT_ERROR, "activation failed", hr),
    };

    // The process loopback device has no mix format: we pick one and the audio
    // engine converts to it (AUTOCONVERTPCM).
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: CHANNELS,
        nSamplesPerSec: SAMPLE_RATE,
        nAvgBytesPerSec: SAMPLE_RATE * BLOCK_ALIGN,
        nBlockAlign: BLOCK_ALIGN as u16,
        wBitsPerSample: BITS,
        cbSize: 0,
    };
    // SAFETY: `format` is a valid PCM WAVEFORMATEX that outlives the call.
    if let Err(e) = unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK
                | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
            BUFFER_DURATION,
            0,
            &format,
            None,
        )
    } {
        return fail(EXIT_ERROR, "IAudioClient::Initialize failed", e.code());
    }

    let sample_ready = match create_event(false) {
        Ok(h) => h,
        Err(e) => return fail(EXIT_ERROR, "CreateEvent failed", e.code()),
    };
    // SAFETY: the event outlives the client (dropped after `client` stops).
    let capture: IAudioCaptureClient = match unsafe { client.SetEventHandle(sample_ready.raw()) }
        .and_then(|()| unsafe { client.GetService::<IAudioCaptureClient>() })
    {
        Ok(c) => c,
        Err(e) => return fail(EXIT_ERROR, "capture start failed", e.code()),
    };

    let mut sink = match &out {
        Some(path) => match WavWriter::create(path) {
            Ok(w) => Sink::Wav(w),
            Err(e) => return fail(EXIT_ERROR, &format!("cannot create {}: {e}", path.display()), E_FAIL),
        },
        None => Sink::Stdout(BufWriter::with_capacity(64 * 1024, io::stdout().lock())),
    };

    // The stop event lives for the rest of the process (the watcher thread and
    // Ctrl+C handler may still signal it), so it is intentionally leaked.
    let stop = match create_event(true) {
        Ok(h) => ManuallyDrop::new(h),
        Err(e) => return fail(EXIT_ERROR, "CreateEvent failed", e.code()),
    };
    STOP_EVENT.store(stop.raw().0 as usize, Ordering::SeqCst);
    // SAFETY: registers a plain extern "system" handler; failure just means
    // Ctrl+C kills the process instead of stopping cleanly.
    let _ = unsafe { SetConsoleCtrlHandler(Some(on_console_ctrl), true) };
    std::thread::spawn(watch_stdin);

    // SAFETY: the client is initialized and has an event handle.
    if let Err(e) = unsafe { client.Start() } {
        return fail(EXIT_ERROR, "capture start failed", e.code());
    }
    emit_event(&format!(
        "{{\"event\":\"started\",\"rate\":{SAMPLE_RATE},\"channels\":{CHANNELS},\"format\":\"s16le\"}}"
    ));

    let mut waits: Vec<HANDLE> = vec![stop.raw(), sample_ready.raw()];
    if let Some(t) = &target {
        waits.push(t.raw());
    }

    let mut silence: Vec<u8> = Vec::new();
    let mut stats = Stats::default();
    let mut last_stats = Instant::now();
    let mut failure: Option<(i32, &str, HRESULT)> = None;

    'outer: loop {
        // SAFETY: every handle in `waits` stays open for the whole loop.
        let w = unsafe { WaitForMultipleObjects(&waits, false, WAIT_TIMEOUT_MS) };
        if w == WAIT_OBJECT_0 {
            break; // stdin closed or Ctrl+C
        }
        if w.0 == WAIT_OBJECT_0.0 + 2 {
            failure = Some((EXIT_TARGET_GONE, "target process exited", HRESULT(0)));
            break;
        }
        if w == WAIT_FAILED {
            failure = Some((EXIT_ERROR, "wait failed", windows::core::Error::from_thread().code()));
            break;
        }

        // Drain every available packet (also on timeout, as a safety net).
        loop {
            // SAFETY: the capture client is running.
            let packet = match unsafe { capture.GetNextPacketSize() } {
                Ok(n) => n,
                Err(e) => {
                    failure = Some((EXIT_ERROR, "GetNextPacketSize failed", e.code()));
                    break 'outer;
                }
            };
            if packet == 0 {
                break;
            }

            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames: u32 = 0;
            let mut flags: u32 = 0;
            // SAFETY: valid out pointers; the buffer is released below before
            // the next GetBuffer.
            if let Err(e) =
                unsafe { capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }
            {
                failure = Some((EXIT_ERROR, "GetBuffer failed", e.code()));
                break 'outer;
            }
            let bytes = (frames * BLOCK_ALIGN) as usize;
            let silent = flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
            let payload: &[u8] = if silent || data.is_null() || bytes == 0 {
                if silence.len() < bytes {
                    silence.resize(bytes, 0);
                }
                &silence[..bytes]
            } else {
                // SAFETY: GetBuffer returned `frames` frames of our
                // BLOCK_ALIGN-byte format at `data`, valid until ReleaseBuffer.
                unsafe { std::slice::from_raw_parts(data, bytes) }
            };
            stats.add(payload, frames, silent);
            let written = bytes == 0 || sink.write(payload).is_ok();
            // SAFETY: releases exactly the frames obtained above.
            let _ = unsafe { capture.ReleaseBuffer(frames) };
            if !written {
                break 'outer; // the reader went away: stop quietly
            }
        }
        if sink.flush().is_err() {
            break;
        }

        if last_stats.elapsed() >= STATS_INTERVAL {
            stats.report();
            last_stats = Instant::now();
        }
    }

    // SAFETY: stopping a started client; errors are irrelevant at shutdown.
    let _ = unsafe { client.Stop() };
    sink.finish();

    if let Some((code, reason, hr)) = failure {
        return fail(code, reason, hr);
    }
    emit_event("{\"event\":\"stopped\"}");
    EXIT_OK
}
