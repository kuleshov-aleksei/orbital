// orbital-audiocap: per-application audio capture for the Orbital desktop app
// on Windows. Spec: docs/specs/WINDOWS_APP_AUDIO.md
//
// Uses the Windows process loopback API (ActivateAudioInterfaceAsync with
// AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK). Structure follows Microsoft's
// ApplicationLoopback sample (Windows-classic-samples, MIT License,
// Copyright (c) Microsoft Corporation), rewritten without WRL/WIL so it builds
// with mingw-w64 on Linux.
//
// Commands (stdout = data, stderr = logs/events as JSON lines):
//   probe                               {"supported":true,"build":22631}
//   list [--skip-tree <pid>]            [{"pid":1,"name":"...","exe":"...","active":true}]
//   pid-of-hwnd <hwnd>                  {"pid":1234}
//   capture --include <pid>             raw s16le 48 kHz stereo PCM on stdout
//   capture --exclude <pid>
//
// Exit codes: 0 ok / stopped, 1 error, 2 API unsupported, 3 target gone.
// capture stops when stdin closes (the parent died or asked it to stop).

#define WIN32_LEAN_AND_MEAN
#define COBJMACROS
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <propidl.h>
#include <tlhelp32.h>

#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <map>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// Process loopback declarations. Older mingw-w64 headers lack them, so they
// are declared here under our own names (the layouts and IIDs are fixed ABI).
// ---------------------------------------------------------------------------

namespace orb {

enum ActivationType : int {
  ACTIVATION_TYPE_DEFAULT = 0,
  ACTIVATION_TYPE_PROCESS_LOOPBACK = 1,
};

enum LoopbackMode : int {
  LOOPBACK_INCLUDE_TREE = 0,
  LOOPBACK_EXCLUDE_TREE = 1,
};

struct ProcessLoopbackParams {
  DWORD TargetProcessId;
  LoopbackMode ProcessLoopbackMode;
};

struct ActivationParams {
  ActivationType ActivationType;
  ProcessLoopbackParams ProcessLoopbackParams;
};

const wchar_t* const kVirtualDeviceProcessLoopback = L"VAD\\Process_Loopback";

// {72A22D78-CDE4-431D-B8CC-843A71199B6D}
const IID IID_ActivateAsyncOperation = {
    0x72a22d78, 0xcde4, 0x431d, {0xb8, 0xcc, 0x84, 0x3a, 0x71, 0x19, 0x9b, 0x6d}};
// {41D949AB-9862-444A-80F6-C261334DA5EB}
const IID IID_ActivateCompletionHandler = {
    0x41d949ab, 0x9862, 0x444a, {0x80, 0xf6, 0xc2, 0x61, 0x33, 0x4d, 0xa5, 0xeb}};
// {94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90}
const IID IID_AgileObject = {
    0x94ea2b94, 0xe9cc, 0x49e0, {0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90}};

struct ActivateAsyncOperation : public IUnknown {
  virtual HRESULT STDMETHODCALLTYPE GetActivateResult(HRESULT* activateResult,
                                                      IUnknown** activatedInterface) = 0;
};

struct ActivateCompletionHandler : public IUnknown {
  virtual HRESULT STDMETHODCALLTYPE ActivateCompleted(ActivateAsyncOperation* operation) = 0;
};

typedef HRESULT(WINAPI* ActivateAudioInterfaceAsyncFn)(LPCWSTR deviceInterfacePath,
                                                       REFIID riid,
                                                       PROPVARIANT* activationParams,
                                                       ActivateCompletionHandler* handler,
                                                       ActivateAsyncOperation** operation);

}  // namespace orb

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

enum ExitCode { EXIT_OK = 0, EXIT_ERROR = 1, EXIT_UNSUPPORTED = 2, EXIT_TARGET_GONE = 3 };

static std::string Utf8(const wchar_t* s) {
  if (!s || !*s) return std::string();
  int len = WideCharToMultiByte(CP_UTF8, 0, s, -1, nullptr, 0, nullptr, nullptr);
  if (len <= 1) return std::string();
  std::string out(static_cast<size_t>(len - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, s, -1, &out[0], len, nullptr, nullptr);
  return out;
}

static std::string JsonString(const std::string& s) {
  std::string out = "\"";
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out + "\"";
}

static void Emit(FILE* f, const std::string& line) {
  fputs(line.c_str(), f);
  fputc('\n', f);
  fflush(f);
}

static int Fail(int code, const char* message, HRESULT hr = S_OK) {
  char buf[16];
  snprintf(buf, sizeof(buf), "0x%08lX", static_cast<unsigned long>(hr));
  Emit(stderr, std::string("{\"error\":") + JsonString(message) + ",\"hresult\":\"" + buf + "\"}");
  return code;
}

template <typename T>
static void SafeRelease(T*& p) {
  if (p) {
    p->Release();
    p = nullptr;
  }
}

static bool ParsePid(const wchar_t* s, DWORD* out) {
  if (!s || !*s) return false;
  wchar_t* end = nullptr;
  unsigned long long v = wcstoull(s, &end, 10);
  if (*end != L'\0' || v == 0 || v > 0xFFFFFFFFull) return false;
  *out = static_cast<DWORD>(v);
  return true;
}

static DWORD WindowsBuild() {
  typedef LONG(WINAPI * RtlGetVersionFn)(OSVERSIONINFOW*);
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return 0;
  auto fn = reinterpret_cast<RtlGetVersionFn>(
      reinterpret_cast<void (*)()>(GetProcAddress(ntdll, "RtlGetVersion")));
  if (!fn) return 0;
  OSVERSIONINFOW info = {};
  info.dwOSVersionInfoSize = sizeof(info);
  if (fn(&info) != 0) return 0;
  return info.dwBuildNumber;
}

// ---------------------------------------------------------------------------
// Process loopback activation
// ---------------------------------------------------------------------------

class CompletionHandler final : public orb::ActivateCompletionHandler {
 public:
  CompletionHandler() : refs_(1), done_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
  ~CompletionHandler() {
    if (done_) CloseHandle(done_);
  }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** out) override {
    if (!out) return E_POINTER;
    if (IsEqualIID(riid, IID_IUnknown) || IsEqualIID(riid, orb::IID_ActivateCompletionHandler) ||
        IsEqualIID(riid, orb::IID_AgileObject)) {
      *out = static_cast<orb::ActivateCompletionHandler*>(this);
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs_); }
  ULONG STDMETHODCALLTYPE Release() override {
    LONG n = InterlockedDecrement(&refs_);
    if (n == 0) delete this;
    return static_cast<ULONG>(n);
  }

  HRESULT STDMETHODCALLTYPE ActivateCompleted(orb::ActivateAsyncOperation*) override {
    SetEvent(done_);
    return S_OK;
  }

  HANDLE done() const { return done_; }

 private:
  LONG refs_;
  HANDLE done_;
};

// Activates an IAudioClient on the process loopback virtual device.
// Returns EXIT_OK on success, EXIT_UNSUPPORTED when the API is unavailable.
static int ActivateLoopbackClient(DWORD pid, orb::LoopbackMode mode, IAudioClient** client,
                                  HRESULT* hrOut) {
  *client = nullptr;
  *hrOut = S_OK;

  HMODULE mmdevapi = LoadLibraryW(L"Mmdevapi.dll");
  if (!mmdevapi) return EXIT_UNSUPPORTED;
  auto activate = reinterpret_cast<orb::ActivateAudioInterfaceAsyncFn>(
      reinterpret_cast<void (*)()>(GetProcAddress(mmdevapi, "ActivateAudioInterfaceAsync")));
  if (!activate) return EXIT_UNSUPPORTED;

  orb::ActivationParams params = {};
  params.ActivationType = orb::ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = mode;

  PROPVARIANT pv;
  PropVariantInit(&pv);
  pv.vt = VT_BLOB;
  pv.blob.cbSize = sizeof(params);
  pv.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  CompletionHandler* handler = new CompletionHandler();
  orb::ActivateAsyncOperation* op = nullptr;
  HRESULT hr = activate(orb::kVirtualDeviceProcessLoopback, __uuidof(IAudioClient), &pv, handler,
                        &op);
  if (FAILED(hr)) {
    handler->Release();
    *hrOut = hr;
    return EXIT_UNSUPPORTED;
  }

  DWORD wait = WaitForSingleObject(handler->done(), 5000);
  handler->Release();
  if (wait != WAIT_OBJECT_0) {
    SafeRelease(op);
    *hrOut = HRESULT_FROM_WIN32(ERROR_TIMEOUT);
    return EXIT_ERROR;
  }

  HRESULT activateResult = E_FAIL;
  IUnknown* unk = nullptr;
  hr = op->GetActivateResult(&activateResult, &unk);
  SafeRelease(op);
  if (FAILED(hr) || FAILED(activateResult) || !unk) {
    SafeRelease(unk);
    *hrOut = FAILED(hr) ? hr : activateResult;
    return EXIT_UNSUPPORTED;
  }

  hr = unk->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(client));
  unk->Release();
  if (FAILED(hr)) {
    *hrOut = hr;
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// probe
// ---------------------------------------------------------------------------

static int CmdProbe() {
  // Activating with "everything except ourselves" exercises the real API
  // path without needing a target.
  IAudioClient* client = nullptr;
  HRESULT hr = S_OK;
  int rc = ActivateLoopbackClient(GetCurrentProcessId(), orb::LOOPBACK_EXCLUDE_TREE, &client, &hr);
  SafeRelease(client);
  bool supported = rc == EXIT_OK;
  char buf[96];
  snprintf(buf, sizeof(buf), "{\"supported\":%s,\"build\":%lu}", supported ? "true" : "false",
           static_cast<unsigned long>(WindowsBuild()));
  Emit(stdout, buf);
  if (!supported && rc == EXIT_UNSUPPORTED) return EXIT_UNSUPPORTED;
  return supported ? EXIT_OK : Fail(rc, "probe failed", hr);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

struct ProcInfo {
  DWORD parent;
  std::wstring exe;  // file name only, from the snapshot
};

static std::map<DWORD, ProcInfo> SnapshotProcesses() {
  std::map<DWORD, ProcInfo> procs;
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return procs;
  PROCESSENTRY32W entry = {};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snap, &entry)) {
    do {
      procs[entry.th32ProcessID] = ProcInfo{entry.th32ParentProcessID, entry.szExeFile};
    } while (Process32NextW(snap, &entry));
  }
  CloseHandle(snap);
  return procs;
}

// Browsers and Electron apps play audio from a child process. Walk up while
// the parent runs the same executable, so the app shows up once and an
// include capture covers the whole tree.
static DWORD AppRoot(DWORD pid, const std::map<DWORD, ProcInfo>& procs) {
  for (int depth = 0; depth < 16; ++depth) {
    auto it = procs.find(pid);
    if (it == procs.end()) break;
    auto parent = procs.find(it->second.parent);
    if (parent == procs.end() || parent->first == pid) break;
    if (_wcsicmp(parent->second.exe.c_str(), it->second.exe.c_str()) != 0) break;
    pid = parent->first;
  }
  return pid;
}

static bool InTree(DWORD pid, DWORD root, const std::map<DWORD, ProcInfo>& procs) {
  for (int depth = 0; depth < 32 && pid != 0; ++depth) {
    if (pid == root) return true;
    auto it = procs.find(pid);
    if (it == procs.end() || it->second.parent == pid) return false;
    pid = it->second.parent;
  }
  return false;
}

static std::wstring ProcessImagePath(DWORD pid) {
  std::wstring path;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return path;
  wchar_t buf[MAX_PATH * 2];
  DWORD size = static_cast<DWORD>(sizeof(buf) / sizeof(buf[0]));
  if (QueryFullProcessImageNameW(h, 0, buf, &size)) path.assign(buf, size);
  CloseHandle(h);
  return path;
}

// "Spotify" instead of "Spotify.exe" when the binary has a FileDescription.
static std::wstring FileDescription(const std::wstring& path) {
  if (path.empty()) return std::wstring();
  DWORD ignored = 0;
  DWORD size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
  if (size == 0) return std::wstring();
  std::vector<BYTE> data(size);
  if (!GetFileVersionInfoW(path.c_str(), 0, size, data.data())) return std::wstring();

  struct LangCodePage {
    WORD lang;
    WORD codepage;
  }* translations = nullptr;
  UINT len = 0;
  if (!VerQueryValueW(data.data(), L"\\VarFileInfo\\Translation",
                      reinterpret_cast<void**>(&translations), &len) ||
      len < sizeof(LangCodePage)) {
    return std::wstring();
  }
  wchar_t key[64];
  swprintf(key, 64, L"\\StringFileInfo\\%04x%04x\\FileDescription", translations[0].lang,
           translations[0].codepage);
  wchar_t* value = nullptr;
  if (!VerQueryValueW(data.data(), key, reinterpret_cast<void**>(&value), &len) || len == 0 ||
      !value) {
    return std::wstring();
  }
  return std::wstring(value);
}

static std::wstring BaseName(const std::wstring& path) {
  size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

struct AppEntry {
  std::wstring name;
  std::wstring exe;
  bool active;
};

static int CmdList(DWORD skipTree) {
  IMMDeviceEnumerator* enumerator = nullptr;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                __uuidof(IMMDeviceEnumerator),
                                reinterpret_cast<void**>(&enumerator));
  if (FAILED(hr)) return Fail(EXIT_ERROR, "MMDeviceEnumerator failed", hr);

  IMMDeviceCollection* devices = nullptr;
  hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices);
  if (FAILED(hr)) {
    SafeRelease(enumerator);
    return Fail(EXIT_ERROR, "EnumAudioEndpoints failed", hr);
  }

  const std::map<DWORD, ProcInfo> procs = SnapshotProcesses();
  std::map<DWORD, AppEntry> apps;  // keyed by app root pid

  UINT deviceCount = 0;
  devices->GetCount(&deviceCount);
  for (UINT d = 0; d < deviceCount; ++d) {
    IMMDevice* device = nullptr;
    IAudioSessionManager2* manager = nullptr;
    IAudioSessionEnumerator* sessions = nullptr;
    if (FAILED(devices->Item(d, &device)) ||
        FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
                                reinterpret_cast<void**>(&manager))) ||
        FAILED(manager->GetSessionEnumerator(&sessions))) {
      SafeRelease(sessions);
      SafeRelease(manager);
      SafeRelease(device);
      continue;
    }

    int sessionCount = 0;
    sessions->GetCount(&sessionCount);
    for (int s = 0; s < sessionCount; ++s) {
      IAudioSessionControl* control = nullptr;
      IAudioSessionControl2* control2 = nullptr;
      if (FAILED(sessions->GetSession(s, &control)) ||
          FAILED(control->QueryInterface(__uuidof(IAudioSessionControl2),
                                         reinterpret_cast<void**>(&control2)))) {
        SafeRelease(control);
        continue;
      }

      DWORD pid = 0;
      AudioSessionState state = AudioSessionStateInactive;
      bool skip = control2->IsSystemSoundsSession() == S_OK ||
                  FAILED(control2->GetProcessId(&pid)) || pid == 0 ||
                  FAILED(control2->GetState(&state)) || state == AudioSessionStateExpired;
      SafeRelease(control2);
      SafeRelease(control);
      if (skip) continue;
      if (skipTree != 0 && InTree(pid, skipTree, procs)) continue;

      DWORD root = AppRoot(pid, procs);
      bool active = state == AudioSessionStateActive;
      auto existing = apps.find(root);
      if (existing != apps.end()) {
        existing->second.active = existing->second.active || active;
        continue;
      }

      std::wstring path = ProcessImagePath(root);
      std::wstring exe = BaseName(path);
      if (exe.empty()) {
        auto it = procs.find(root);
        if (it != procs.end()) exe = it->second.exe;
      }
      if (exe.empty()) continue;
      std::wstring name = FileDescription(path);
      if (name.empty()) {
        name = exe;
        size_t dot = name.rfind(L'.');
        if (dot != std::wstring::npos) name = name.substr(0, dot);
      }
      apps[root] = AppEntry{name, exe, active};
    }

    SafeRelease(sessions);
    SafeRelease(manager);
    SafeRelease(device);
  }
  SafeRelease(devices);
  SafeRelease(enumerator);

  std::string out = "[";
  bool first = true;
  for (const auto& kv : apps) {
    if (!first) out += ",";
    first = false;
    out += "{\"pid\":" + std::to_string(kv.first) +
           ",\"name\":" + JsonString(Utf8(kv.second.name.c_str())) +
           ",\"exe\":" + JsonString(Utf8(kv.second.exe.c_str())) +
           ",\"active\":" + (kv.second.active ? "true" : "false") + "}";
  }
  out += "]";
  Emit(stdout, out);
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// pid-of-hwnd
// ---------------------------------------------------------------------------

static int CmdPidOfHwnd(const wchar_t* arg) {
  wchar_t* end = nullptr;
  unsigned long long value = wcstoull(arg, &end, 10);
  if (!arg || !*arg || *end != L'\0' || value == 0) {
    return Fail(EXIT_ERROR, "invalid hwnd");
  }
  HWND hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(value));
  DWORD pid = 0;
  if (!IsWindow(hwnd) || GetWindowThreadProcessId(hwnd, &pid) == 0 || pid == 0) {
    return Fail(EXIT_TARGET_GONE, "window not found");
  }
  const std::map<DWORD, ProcInfo> procs = SnapshotProcesses();
  Emit(stdout, "{\"pid\":" + std::to_string(AppRoot(pid, procs)) + "}");
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

static HANDLE g_stopEvent = nullptr;

// Blocks on stdin until the parent closes it (or dies), then signals stop.
static DWORD WINAPI StdinWatcher(LPVOID) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char buf[64];
  DWORD read = 0;
  while (ReadFile(in, buf, sizeof(buf), &read, nullptr) && read > 0) {
  }
  SetEvent(g_stopEvent);
  return 0;
}

static bool WriteAll(HANDLE out, const BYTE* data, DWORD size) {
  while (size > 0) {
    DWORD written = 0;
    if (!WriteFile(out, data, size, &written, nullptr) || written == 0) return false;
    data += written;
    size -= written;
  }
  return true;
}

static int CmdCapture(DWORD pid, orb::LoopbackMode mode) {
  HANDLE target = nullptr;
  if (mode == orb::LOOPBACK_INCLUDE_TREE) {
    target = OpenProcess(SYNCHRONIZE, FALSE, pid);
    if (!target) return Fail(EXIT_TARGET_GONE, "target process not found",
                             HRESULT_FROM_WIN32(GetLastError()));
  }

  IAudioClient* client = nullptr;
  HRESULT hr = S_OK;
  int rc = ActivateLoopbackClient(pid, mode, &client, &hr);
  if (rc != EXIT_OK) {
    if (target) CloseHandle(target);
    return Fail(rc, rc == EXIT_UNSUPPORTED ? "process loopback unsupported" : "activation failed",
                hr);
  }

  // The process loopback device has no mix format: we pick one and the
  // audio engine converts to it (AUTOCONVERTPCM).
  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 16;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  const REFERENCE_TIME bufferDuration = 1000000;  // 100 ms, in 100 ns units
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
                              AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                          bufferDuration, 0, &format, nullptr);
  if (FAILED(hr)) {
    SafeRelease(client);
    if (target) CloseHandle(target);
    return Fail(EXIT_ERROR, "IAudioClient::Initialize failed", hr);
  }

  HANDLE sampleReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  IAudioCaptureClient* capture = nullptr;
  hr = client->SetEventHandle(sampleReady);
  if (SUCCEEDED(hr)) {
    hr = client->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&capture));
  }
  if (SUCCEEDED(hr)) hr = client->Start();
  if (FAILED(hr)) {
    SafeRelease(capture);
    SafeRelease(client);
    CloseHandle(sampleReady);
    if (target) CloseHandle(target);
    return Fail(EXIT_ERROR, "capture start failed", hr);
  }

  g_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HANDLE watcher = CreateThread(nullptr, 0, StdinWatcher, nullptr, 0, nullptr);
  if (watcher) CloseHandle(watcher);

  Emit(stderr, "{\"event\":\"started\",\"rate\":48000,\"channels\":2,\"format\":\"s16le\"}");

  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  std::vector<BYTE> silence;
  int exitCode = EXIT_OK;
  const char* reason = nullptr;

  HANDLE waits[3] = {g_stopEvent, sampleReady, target};
  const DWORD waitCount = target ? 3 : 2;
  bool running = true;
  while (running) {
    DWORD w = WaitForMultipleObjects(waitCount, waits, FALSE, 2000);
    if (w == WAIT_OBJECT_0) break;  // stdin closed
    if (w == WAIT_OBJECT_0 + 2) {
      exitCode = EXIT_TARGET_GONE;
      reason = "target process exited";
      break;
    }
    if (w == WAIT_FAILED) {
      exitCode = EXIT_ERROR;
      reason = "wait failed";
      break;
    }

    // Drain every available packet (also on timeout, as a safety net).
    for (;;) {
      UINT32 packet = 0;
      hr = capture->GetNextPacketSize(&packet);
      if (FAILED(hr)) {
        exitCode = EXIT_ERROR;
        reason = "GetNextPacketSize failed";
        running = false;
        break;
      }
      if (packet == 0) break;

      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        exitCode = EXIT_ERROR;
        reason = "GetBuffer failed";
        running = false;
        break;
      }
      DWORD bytes = frames * format.nBlockAlign;
      const BYTE* payload = data;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        if (silence.size() < bytes) silence.assign(bytes, 0);
        payload = silence.data();
      }
      bool ok = bytes == 0 || WriteAll(out, payload, bytes);
      capture->ReleaseBuffer(frames);
      if (!ok) {  // the reader went away: stop quietly
        running = false;
        break;
      }
    }
  }

  client->Stop();
  SafeRelease(capture);
  SafeRelease(client);
  CloseHandle(sampleReady);
  if (target) CloseHandle(target);

  if (reason) return Fail(exitCode, reason, hr);
  Emit(stderr, "{\"event\":\"stopped\"}");
  return EXIT_OK;
}

// ---------------------------------------------------------------------------

static int Usage() {
  fputs(
      "usage: orbital-audiocap probe\n"
      "       orbital-audiocap list [--skip-tree <pid>]\n"
      "       orbital-audiocap pid-of-hwnd <hwnd>\n"
      "       orbital-audiocap capture (--include|--exclude) <pid>\n",
      stderr);
  return EXIT_ERROR;
}

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) return Usage();
  const std::wstring cmd = argv[1];

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return Fail(EXIT_ERROR, "CoInitializeEx failed", hr);

  int rc = EXIT_ERROR;
  if (cmd == L"probe") {
    rc = CmdProbe();
  } else if (cmd == L"list") {
    DWORD skip = 0;
    if (argc == 4 && std::wstring(argv[2]) == L"--skip-tree" && !ParsePid(argv[3], &skip)) {
      rc = Usage();
    } else {
      rc = CmdList(skip);
    }
  } else if (cmd == L"pid-of-hwnd" && argc == 3) {
    rc = CmdPidOfHwnd(argv[2]);
  } else if (cmd == L"capture" && argc == 4) {
    const std::wstring flag = argv[2];
    DWORD pid = 0;
    if ((flag != L"--include" && flag != L"--exclude") || !ParsePid(argv[3], &pid)) {
      rc = Usage();
    } else {
      rc = CmdCapture(pid, flag == L"--include" ? orb::LOOPBACK_INCLUDE_TREE
                                                : orb::LOOPBACK_EXCLUDE_TREE);
    }
  } else {
    rc = Usage();
  }

  CoUninitialize();
  return rc;
}
