# orbital-audiocap

A small Windows helper used by the Orbital desktop app. It captures the audio of one app, or of every app except Orbital, for screen sharing. It uses the Windows process loopback API, so there is no DLL injection and it doesn't depend on the default playback device.

Design and decisions: [`docs/specs/WINDOWS_APP_AUDIO.md`](../../docs/specs/WINDOWS_APP_AUDIO.md).

## Build

Cross-compiled on Linux with mingw-w64:

```sh
make build-win-audiocap        # from the repo root
# or
make -C native/win-audiocap
```

You need the `g++-mingw-w64-x86-64` package (Debian/Ubuntu) or `mingw-w64-gcc` (Arch). The release build runs inside `docker/Dockerfile.electron`, and electron-builder ships the result next to `app.asar` through `win.extraResources`. `orbital-audiocap.exe` is a build artifact and is never committed.

## CLI

stdout carries data and stderr carries logs and events, one JSON object per line.

```
orbital-audiocap probe                        {"supported":true,"build":22631}
orbital-audiocap list [--skip-tree <pid>]     [{"pid":1234,"name":"Spotify","exe":"Spotify.exe","active":true}]
orbital-audiocap pid-of-hwnd <hwnd>           {"pid":1234}
orbital-audiocap capture --include <pid>      raw s16le 48 kHz stereo PCM on stdout
orbital-audiocap capture --exclude <pid>
```

`capture` prints `{"event":"started",...}` to stderr once audio flows. It stops when stdin closes.

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
orbital-audiocap capture --include 1234 > out.raw
ffplay -f s16le -ar 48000 -ac 2 out.raw
```

When run by hand, `capture` stops on Ctrl+Z then Enter, which closes stdin, or on Ctrl+C.

## Attribution

The structure follows Microsoft's [ApplicationLoopback sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/) (MIT License, Copyright (c) Microsoft Corporation).
