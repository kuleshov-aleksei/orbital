# orbital-audiocap

A small Windows helper used by the Orbital desktop app. It captures the audio of one app, or of every app except Orbital, for screen sharing. It uses the Windows process loopback API, so there is no DLL injection and it doesn't depend on the default playback device.

Design and decisions: [`docs/specs/WINDOWS_APP_AUDIO.md`](../../docs/specs/WINDOWS_APP_AUDIO.md).

## Build

Written in Rust (the [`windows`](https://crates.io/crates/windows) crate) and cross-compiled on Linux:

```sh
make build-win-audiocap        # from the repo root
# or
make -C native/win-audiocap
```

You need the Windows GNU target (`rustup target add x86_64-pc-windows-gnu`) and the mingw-w64 C toolchain as linker: `gcc-mingw-w64-x86-64` (Debian/Ubuntu) or `mingw-w64-gcc` (Arch). `.cargo/config.toml` sets the target, the linker and a static C runtime, so plain `cargo build`/`cargo clippy` in this directory work too. The release build runs in the `audiocap` stage of `docker/Dockerfile.electron`, and electron-builder ships the result next to `app.asar` through `win.extraResources`. `orbital-audiocap.exe` is a build artifact and is never committed.

Unit tests (pure logic: JSON escaping, WAV header, process tree) run under Wine: `CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUNNER=wine cargo test`.

## CLI

stdout carries data and stderr carries logs and events, one JSON object per line.

```
orbital-audiocap probe                        {"supported":true,"build":22631}
orbital-audiocap list [--skip-tree <pid>]     [{"pid":1234,"name":"Spotify","exe":"Spotify.exe","active":true}]
orbital-audiocap pid-of-hwnd <hwnd>           {"pid":1234}
orbital-audiocap capture --include <pid>      raw s16le 48 kHz stereo PCM on stdout
orbital-audiocap capture --exclude <pid>
orbital-audiocap capture --include <pid> --out test.wav    the same, into a WAV file
```

`capture` prints `{"event":"started",...}` to stderr once audio flows, then `{"event":"stats",...}` every 5 s (frames, packets, silent packets, peak sample). It stops when stdin closes or on Ctrl+C.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | OK or stopped |
| 1 | Error |
| 2 | Process loopback unsupported |
| 3 | Target process or window gone |

Manual test on Windows:

```bat
orbital-audiocap list
orbital-audiocap capture --include 1234 --out test.wav
```

Press Ctrl+C to stop, then play `test.wav` in any player.

**Don't redirect PCM with `>` in PowerShell 5.** It decodes the bytes as text and writes them back as UTF-16 (the file starts with `FF FE`), which turns valid audio into noise. `cmd.exe`'s `>` and PowerShell 7.4+ keep the bytes intact, but `--out` is the safe choice.

## Attribution

The structure follows Microsoft's [ApplicationLoopback sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/) (MIT License, Copyright (c) Microsoft Corporation).
