# Windows per-app audio capture (spec)

Status: implemented. Waiting for Windows hardware testing (§8).

## 1. Problem

On Windows, screen share audio uses Electron's `audio: "loopback"`, which is set in the display media handler (`electron/main/features/screenshare.ts`). Chromium turns that into WASAPI shared-mode loopback on the **default playback device**. The code uses that API correctly, but the API itself is limited:

- **It captures the whole system mix, including Orbital.** The voices of the people in the call go back to the viewers as echo.
- **It depends on the default playback device.** Capture fails with the generic `NotReadableError: Could not start audio source` in these cases:
  - another app holds the default device in exclusive mode;
  - the default device is a multichannel or virtual endpoint (for example "7.1 surround" in headset software);
  - the device vanishes or changes: a wireless dongle goes to sleep, or a Bluetooth headset switches to the hands-free profile when the mic opens.

  The README blames headset drivers, but WASAPI loopback runs in the Windows audio engine, not in the driver.
- **It can't target one app.** That is why sharing a single window on Windows drops audio (commit 7954fcb).

The README also says per-app capture "would need DLL injection". That is no longer true. Since Windows 10 2004 / Windows 11, the **Process Loopback API** captures the audio that one process tree plays, or everything except one process tree. It needs no injection and doesn't depend on the default device:

- `ActivateAudioInterfaceAsync` + `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`
- `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE` / `..._EXCLUDE_...`

OBS's "Application Audio Capture" uses this API.

## 2. Goals and non-goals

Goals:
- Share the audio of one app.
- Share "system audio without Orbital" (no echo of the call).
- Work no matter which device is the default.
- When the API is missing, fall back to the current `loopback` path.

Non-goals (v1):
- Per-window audio. The API works per process tree, so a window share captures the process that owns the window.
- Mixing several selected apps. One PID per stream; v2 can mix several streams in the renderer.
- x86 and ARM64 Windows builds.

## 3. Decisions

### 3.1 No third-party package

Packages considered:

| Package | What it is | Why not |
|---|---|---|
| [`electron-audio-loopback`](https://github.com/alectrocute/electron-audio-loopback) | Feature flags for system loopback | System-wide only; brings nothing over `audio: "loopback"` |
| [`application-loopback`](https://github.com/WerdoxDev/application-loopback) | Node wrapper around a prebuilt C++ exe | Small, single maintainer, ships prebuilt binaries |
| [`@kokapuk/application-loopback`](https://www.pkgstats.com/pkg:@kokapuk/application-loopback) | Same idea | Same; tested only on Windows 11 |
| `process-audio-capture`, `native-audio-node` | Native addons | Same; a Node ABI addon also has to be rebuilt for every Electron update |

None of them saves much work: the capture code is about 400 lines based on Microsoft's sample. In exchange each one brings an unaudited prebuilt binary into an app that updates itself automatically. **We write our own helper.**

### 3.2 A standalone helper exe, not a Node addon

`orbital-audiocap.exe` is a plain Win32 console program. Electron spawns it as a child process.

- **No Node/Electron ABI.** No `node.lib`, node-gyp, prebuilds, or rebuild when Electron updates.
- **Isolated.** A crash or hang in COM or audio code kills only the helper. This is the same reason venmic runs behind a utilityProcess bridge (`electron/main/venmic.ts`).
- **Built on Linux.** It is cross-compiled with mingw-w64 (Debian `g++-mingw-w64-x86-64`, an apt package) inside the existing `docker/Dockerfile.electron`, which already builds the Windows installer on Linux. `-static` produces one exe with no DLLs.
- **Easy to debug.** It can be run by hand from `cmd` on a user's machine.

## 4. Helper: `native/win-audiocap/`

```
native/win-audiocap/
  audiocap.cpp   # the whole helper, builds orbital-audiocap.exe
  Makefile
  README.md      # build, CLI, attribution
```

The code follows Microsoft's MIT-licensed [ApplicationLoopback sample](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/); credit it in the file header. It uses plain COM: a hand-written `IActivateAudioInterfaceCompletionHandler` that also implements `IAgileObject`, with no WRL or ATL.

### 4.1 CLI

stdout carries data, stderr carries logs. Control output is newline-delimited JSON.

| Command | Output |
|---|---|
| `probe` | `{"supported":true,"build":22631}` and exit 0. The exit code is 2 when the API is missing. |
| `list [--skip-tree <pid>]` | A JSON array `[{"pid":1234,"name":"Spotify","exe":"Spotify.exe","active":true}]` listing processes with an audio session. `--skip-tree` hides a process tree (Orbital passes its own PID). A session from a child process is reported under the topmost ancestor that runs the same exe (browsers play audio from a child process), so an include capture covers the whole app. It walks every active render endpoint (`IMMDeviceEnumerator` → `IAudioSessionManager2` → `IAudioSessionEnumerator`), removes duplicate PIDs, and skips the system sounds session. |
| `pid-of-hwnd <hwnd>` | `{"pid":1234}` for the process that owns the window, via `GetWindowThreadProcessId`. `desktopCapturer` window ids look like `window:<hwnd>:<n>`. |
| `capture --include <pid>` / `--exclude <pid>` | Raw PCM on stdout until it stops. |

How `capture` works:
- **Format:** s16le, 48 kHz, stereo. The format is fixed and the client is initialized with `AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM`, so Windows converts whatever the app plays. Throughput is about 192 KB/s.
- **Gaps:** when the target is silent, no packets arrive. The renderer handles that, so the helper doesn't fill the gaps with silence.
- **Started event:** once audio flows, stderr gets `{"event":"started",...}`. The Electron side waits for it before reporting success.
- **Lifetime:** the helper exits when **stdin closes** (the parent died or stopped it), when the target process exits, or on an error.
- **Exit codes:** 0 = stopped normally, 2 = API unsupported, 3 = target gone, 1 = any other error. The last stderr line is `{"error":"...","hresult":"0x8889000A"}`.

### 4.2 Old Windows

`ActivateAudioInterfaceAsync` is resolved at run time with `GetProcAddress(LoadLibrary("mmdevapi.dll"))`. The exe therefore starts on any Windows 10 and reports "unsupported" (exit code 2) when process loopback activation fails.

Microsoft documents build 20348 as the minimum, but the API works from 19041 (2004) onward. **Detect support at run time and never hard-code a build number.**

Debian trixie's mingw-w64 has no `audioclientactivationparams.h`, so `audiocap.cpp` declares the activation structs, the async-activation interfaces and their IIDs itself, in `namespace orb`.

Target for orbital app is Windows 11, so we do not need to support old Windows anyway

### 4.3 Build

```make
# native/win-audiocap/Makefile
CXX := x86_64-w64-mingw32-g++   # unless set by the caller
orbital-audiocap.exe: audiocap.cpp
	$(CXX) -std=c++17 -O2 -Wall -Wextra -static -municode -o $@ $< -lole32 -luuid -lversion
```

- `docker/Dockerfile.electron`:
  - add `g++-mingw-w64-x86-64` to the apt list;
  - copy `native/win-audiocap/` and run `make` before the version-sensitive layers, so the result stays cached;
  - `.dockerignore` excludes a locally built exe, so the image always builds its own.
- electron-builder `win.extraResources`: `{ from: "../native/win-audiocap/orbital-audiocap.exe", to: "orbital-audiocap.exe" }`. Ship it next to the asar, not inside it, because an exe can't be launched from inside an asar.
- Root `Makefile`: a `build-win-audiocap` target, which `build-electron-win` depends on.
- `orbital-audiocap.exe` is gitignored (`*.exe`) and never committed.
- Later, if the installer gets signed: sign the helper with the same certificate. An unsigned helper inside a signed app can trigger SmartScreen or antivirus heuristics.

## 5. Electron main: `electron/main/winAudioCapture.ts`

This is the Windows counterpart of `electron/main/venmic.ts` and follows the same discipline: timeouts on every call, and kill the child on any failure.

- Path: `path.join(process.resourcesPath, "orbital-audiocap.exe")`. In dev, use `native/win-audiocap/orbital-audiocap.exe`.
- `probe()` / `listApps()` / `pidOfSource()`: `execFile` with a 5 s timeout, then parse the JSON. Cache the `probe` result for the session.
- `start(target)`:
  - `spawn` the helper with `stdio: ["pipe", "pipe", "pipe"]`;
  - open a `MessageChannelMain` and hand one port to the renderer with `webContents.postMessage("win-audio-port", null, [port])`;
  - forward stdout chunks to the other port. Each chunk is cut to whole frames and copied, since `MessagePortMain` can't transfer buffers;
  - forward stderr to `electron-log`;
  - resolve once the helper prints `started` (6 s timeout).
- On exit, post `{type:"ended", code}` on the port. Exit code 2 or a failed spawn means "use the fallback".
- `stop()`:
  - close stdin, so the helper stops on its own;
  - after 1 s, kill it if it is still running.

  Call it on screen share stop, window close and app quit, in the same places venmic is torn down (`electron/main/features/window.ts`, `electron/main/index.ts`).
- Only one capture at a time. A new `start()` stops the previous one first.

IPC (preload + `frontend/src/services/electron.ts`), Windows only, under `window.electronAPI.winAudio`:

These are flat methods on `window.electronAPI`, following the `venmic*` naming:

```ts
winAudioProbe(): Promise<{ supported: boolean; build?: number }>
winAudioList(): Promise<WinAudioApp[]>
winAudioPidOfSource(sourceId: string): Promise<number | null>
winAudioStart(target: { mode: "include"; pid: number } | { mode: "exclude-self" }): Promise<WinAudioStartResult>
winAudioStop(): Promise<boolean>
```

The PCM `MessagePort` arrives separately. The main process sends it on `win-audio:port`, and the preload forwards it to the page with `window.postMessage({ type: "orbital:win-audio-port", sessionId }, "*", ports)`, because contextBridge can't carry ports.

`exclude-self` is resolved in the main process to `process.pid` of the Electron main process, so the renderer can never exclude an arbitrary process. Renderer and GPU processes are children of the main process, so the whole Orbital tree is excluded.

## 6. Renderer

New `frontend/src/services/winAudio/`:

- An `AudioWorkletProcessor` (`orbital-pcm-player`, `pcmPlayer.worklet.ts`, loaded with `?worker&url`):
  - the PCM port is transferred into the worklet, so audio never touches the renderer main thread;
  - the ring buffer (`pcmRing.ts`) holds up to 150 ms and starts playback after 30 ms of prebuffer;
  - outputs silence on underrun and drops the oldest samples on overflow. This keeps the latency bounded and absorbs clock drift.
- Pipeline: `AudioContext({ sampleRate: 48000 })` → worklet node → `MediaStreamAudioDestinationNode` → `stream.getAudioTracks()[0]`.
- `useLiveKitScreenShare.ts` `startElectronScreenShare`:
  - when Windows per-app audio is chosen, start the helper first, then call `getDisplayMedia` with `audio: false`;
  - publish the worklet track through `publishScreenShareAudio`, which is now shared by the venmic, system-loopback and Windows branches;
  - if the helper ends mid-share (the app quit, or an error), `handleWinAudioEnded` unpublishes only the audio, keeps the video and shows a warning.
  - `stopScreenShare` calls `winAudio.stop()` and closes the `AudioContext`, next to the existing `stopAudioCapture()` (venmic).
- The backend needs no change: `ScreenShareAudio` is already mapped in `PublishSourcesFor`.

## 7. UX (`ScreenShareQualityModal.vue`)

On Windows, when `probe().supported` is true, the audio section offers three buttons:

1. **Off**: the default, as with the old toggle.
2. **System (without Orbital)**: `exclude-self`.
3. **One app**: a picker filled from `list()` with a refresh button (`include` + PID). Choosing a window source preselects the app that owns it (`pidOfSource`), even if that app has no audio session yet. This replaces the "audio is not supported for windows" note.

When `probe().supported` is false, the modal keeps today's behaviour (`audio: "loopback"`, no audio for window shares).

When `start()` fails at share time with an unsupported or spawn error, the share falls back to `audio: "loopback"` and shows the existing `screenShareAudioWarning`. Any other failure gives a video-only share with the same warning.

## 8. Testing

- **Linux / CI:** compile only (`make build-win-audiocap`, and the Docker build). Under Wine the CLI runs (`probe` reports `{"supported":false}` with exit 2, missing targets exit 3), but Wine doesn't implement process loopback, so there is no capture test here.
- **Unit:** the renderer ring buffer (underrun, overflow, s16 → float) with Vitest.
- **Manual checklist on Windows:**
  - [ ] `audiocap probe`, `list` and `capture --include <pid> > out.raw` from `cmd`; the file plays back correctly (e.g. `ffplay -f s16le -ar 48000 -ac 2 out.raw`).
  - [ ] Include mode: a browser playing music is heard by the viewers; other apps are not.
  - [ ] Exclude mode during a call: the viewers hear system audio but **not** the call's voices.
  - [ ] Window share preselects the owning app.
  - [ ] Default device in exclusive use, set to 7.1/virtual, or Bluetooth headset with the mic open: capture still works.
  - [ ] The target app quits mid-share: the audio track ends and the video keeps going, or the share stops cleanly. Same behaviour as venmic, commit a593daa.
  - [ ] Orbital quits or crashes mid-capture: no `orbital-audiocap.exe` process is left behind.
  - [ ] Windows 10 19041, Windows 10 22H2 and Windows 11: probe results recorded; fallback used where unsupported.
  - [ ] Long share (1 h): no growing latency, no audible drift.

## 9. Risks and open questions

- **Minimum Windows build** (19041 or 20348): settled at run time by `probe`, but record the results in this spec after testing.
- **Exclude mode with several endpoints:** check that it captures apps playing to a non-default device.
- **Protected audio** (DRM streams) is silent in loopback. This is expected; document it.
- **Antivirus:** an unsigned helper that captures audio may be flagged. Sign it together with the installer once signing exists.
- **Clock drift** between WASAPI and the `AudioContext` clock: the drop-oldest policy covers it. Revisit only if it is audible.

## 10. Follow-ups once implemented

- README "Known issues": rewrite it. Capture no longer depends on the default device, and the driver/DLL-injection explanation goes away. Note the minimum Windows build.
- `AGENTS.md`: add a short "Windows audio helper" trap note. The exe ships through `extraResources` (never asar), its lifetime is tied to stdin, and it is built by mingw in `Dockerfile.electron`.

## References

- [AUDIOCLIENT_ACTIVATION_TYPE (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-audioclient_activation_type)
- [ApplicationLoopback sample (Microsoft)](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
- [Electron `setDisplayMediaRequestHandler`](https://github.com/electron/electron/blob/main/docs/api/session.md)
- Current path: `electron/main/features/screenshare.ts`, `frontend/src/composables/useLiveKitScreenShare.ts`, `electron/main/venmic.ts`
