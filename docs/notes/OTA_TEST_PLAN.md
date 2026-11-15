# OTA frontend updates: manual test plan

Step-by-step checks for over-the-air (OTA) frontend updates on the desktop
(Electron) and Android apps. Read "OTA frontend" in
[`MIGRATION_TO_S3.md`](./MIGRATION_TO_S3.md) for how it works. Run this plan
after changes to:

- `electron/main/features/ota.ts`, `otaPlan.ts`, `protocol.ts` or `update.ts`
- `OtaBundlePlugin.java`
- `frontend/src/services/ota.ts`, `stores/ota.ts` or `stores/appUpdate.ts`
- `scripts/ota-manifest.mjs`, or the release workflows

Everything below runs against a **local feed** (a folder served over HTTP), so
it never touches the production bucket or the production installer.

## 0. Before you start

### 0.1 Automated tests (must be green)

```bash
cd ~/github/orbital && make test-ota
cd ~/github/orbital/frontend && pnpm exec vitest run src/stores/ota.test.ts
cd ~/github/orbital/backend && go test ./internal/handlers/ -run Release
```

### 0.2 Conventions

| Name | Value used below |
|---|---|
| Feed folder | `~/ota-test/feed` |
| Feed server log | `~/ota-test/feed.log` |
| Feed port | `8765` |
| Host IP reachable from the phone (Headscale/LAN) | `100.111.0.8` (adjust) |
| Built-in version | `1.0.0` |

Every "new" bundle is the built-in build with two changes, made by the helper
below: the version baked into its JS is replaced with the bundle version (as a
real release build has it), and a red banner is added to `index.html` so you can
see which bundle is running. Only those files change: about 7 of ~220 (a few JS
chunks plus `index.html`), which is how the delta-download checks work.

Bundles made with an older copy of the helper still report `1.0.0` from their JS,
so the app shows the APK prompt ("You have 1.0.0") right after applying them.
Re-create the helper (0.3), then run `adb shell pm clear app.orbital.dev` (or, on
desktop, `rm -rf ~/.config/Orbital/ota`) and rebuild the bundles.

### 0.3 Helper script

Create `~/ota-test/make-bundle.sh`:

```bash
mkdir -p ~/ota-test/feed
cat > ~/ota-test/make-bundle.sh <<'EOF'
#!/usr/bin/env bash
# make-bundle.sh <srcDist> <electron|android> <version> <backendUrl> <label> [broken]
# Copies a built dist, stamps the bundle version into its JS (as a real release
# build would), adds a visible banner (or breaks it), and writes the OTA
# manifest + blobs into ~/ota-test/feed.
set -euo pipefail
SRC="$1" PLATFORM="$2" VERSION="$3" BACKEND="$4" LABEL="$5" MODE="${6:-}"
ROOT="${OTA_TEST_ROOT:-$HOME/ota-test}"
WORK="$ROOT/work-$PLATFORM-$VERSION" FEED="$ROOT/feed"
REPO="$HOME/github/orbital"
rm -rf "$WORK" && cp -r "$SRC" "$WORK"
# The dist reports the version it was built with; make it report $VERSION.
BT='`'
OLD=$(grep -rhoE 'Frontend version: [0-9]+\.[0-9]+\.[0-9]+[^ "`]*' "$WORK/assets" | head -1 | awk '{print $3}' || true)
[ -n "$OLD" ] || { echo "built-in version not found in $WORK/assets" >&2; exit 1; }
FILES=$(grep -rlF "$OLD" "$WORK/assets" || true)
[ -n "$FILES" ] && printf '%s\n' "$FILES" | xargs sed -i "s/${BT}${OLD//./\\.}${BT}/${BT}${VERSION}${BT}/g; s/Frontend version: ${OLD//./\\.}/Frontend version: ${VERSION}/g"
if [ "$MODE" = "broken" ]; then
  # Valid HTML that never loads the app, so it never calls confirmBoot.
  printf '<!doctype html><html><body>broken %s</body></html>\n' "$VERSION" > "$WORK/index.html"
else
  sed -i "s|<body>|<body><div style=\"position:fixed;top:0;left:0;z-index:99999;background:#d00;color:#fff;padding:2px 8px;font:12px monospace\">$LABEL</div>|" "$WORK/index.html"
fi
node "$REPO/scripts/ota-manifest.mjs" "$WORK" "$PLATFORM" "$VERSION" "$BACKEND" "$FEED"
EOF
chmod +x ~/ota-test/make-bundle.sh
```

Check that a bundle reports its own version (after the first `make-bundle.sh` run):

```bash
grep -rhoE 'Frontend version: [^ `"]+' ~/ota-test/work-android-1.0.1/assets | sort -u   # must show 1.0.1
```

### 0.4 Feed server

Run it in its own terminal and keep it running. Its access log goes to
`~/ota-test/feed.log` (appended, so it can be emptied between steps):

```bash
cd ~/ota-test/feed && python -u -m http.server 8765 --bind 0.0.0.0 2>&1 | tee -a ~/ota-test/feed.log
```

Two commands used in many checks:

```bash
: > ~/ota-test/feed.log                                  # empty the access log before a step
grep -c 'GET /ota/<platform>/files/' ~/ota-test/feed.log  # count blob downloads after it
```

---

## Part A: Desktop (Electron, Linux AppImage)

### A0. Build a test app that points at the local feed

```bash
cd ~/github/orbital && make build-electron UPDATE_URL=http://127.0.0.1:8765/
```

- The installed (built-in) version is `electron/package.json` `version` (`1.0.0`).
- The backend URL baked into the build defaults to `https://orb.encamy.com`. Pass
  the **same** value as `<backendUrl>` to `make-bundle.sh`.

Commands used throughout Part A:

```bash
# Quit the app
pkill -f 'Orbital-.*\.AppImage'
# Empty the app log (only while the app is not running)
: > ~/.config/Orbital/logs/main.log
# Launch
~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
# OTA log lines
grep '\[OTA\]' ~/.config/Orbital/logs/main.log
# OTA state
cat ~/.config/Orbital/ota/state.json; echo
# Downloaded bundles
ls ~/.config/Orbital/ota/bundles/
# Reset OTA to the built-in bundle (keeps login and other data)
rm -rf ~/.config/Orbital/ota
```

> `ORBITAL_OTA_URL=http://127.0.0.1:8765/` overrides the baked feed for the OTA
> check only. Use it with a build that points at production, but then skip A5:
> the native fallback would use the production feed.

### A1. No manifest: falls back to the old updater

```bash
pkill -f 'Orbital-.*\.AppImage'; rm -rf ~/.config/Orbital/ota
rm -rf ~/ota-test/feed/* && : > ~/.config/Orbital/logs/main.log
~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
```

- [ ] `grep -E '\[OTA\]|Checking for update' ~/.config/Orbital/logs/main.log` shows
  `[OTA] Manifest fetch failed`, then `Checking for update`.
- [ ] The update overlay appears and ends in an error (there is no `latest-linux.yml`).
- [ ] After dismissing the error ("Try Again" / reload) the app works normally.

### A2. Stage and apply a bundle with the toast

1. Create v1.0.1 and launch:
   ```bash
   pkill -f 'Orbital-.*\.AppImage'
   ~/ota-test/make-bundle.sh ~/github/orbital/electron/dist electron 1.0.1 https://orb.encamy.com "OTA 1.0.1"
   : > ~/ota-test/feed.log; : > ~/.config/Orbital/logs/main.log
   ~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
   ```
2. Sign in. Don't join a voice room.
   - [ ] `grep '\[OTA\] Staged' ~/.config/Orbital/logs/main.log` shows
     `Staged 1.0.1: K of N files downloaded`, with K about 7 and N about 250.
   - [ ] `grep -c 'GET /ota/electron/files/' ~/ota-test/feed.log` prints the same K.
   - [ ] `cat ~/.config/Orbital/ota/state.json` shows `"pending": "1.0.1"`.
   - [ ] The "Orbital 1.0.1 is ready. Reload to update." toast appears at the bottom.
3. Click **Reload**.
   - [ ] The red **OTA 1.0.1** banner is visible.
   - [ ] `grep -E 'Applying|booted' ~/.config/Orbital/logs/main.log` shows
     `[OTA] Applying 1.0.1`, then `[OTA] Bundle 1.0.1 booted`.
   - [ ] You are still signed in. A text channel you opened before still shows
     its cached messages (IndexedDB kept, same `orbital://app` origin).
4. Relaunch:
   ```bash
   pkill -f 'Orbital-.*\.AppImage'; : > ~/.config/Orbital/logs/main.log
   ~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
   ```
   - [ ] The banner is still there.
   - [ ] `cat ~/.config/Orbital/ota/state.json` shows `"active": "1.0.1"`.
   - [ ] `grep '\[OTA\] Latest' ~/.config/Orbital/logs/main.log` shows `nothing to do (up to date)`.

### A3. "Later" applies on the next launch

1. Create v1.0.2 and launch:
   ```bash
   pkill -f 'Orbital-.*\.AppImage'
   ~/ota-test/make-bundle.sh ~/github/orbital/electron/dist electron 1.0.2 https://orb.encamy.com "OTA 1.0.2"
   : > ~/ota-test/feed.log; : > ~/.config/Orbital/logs/main.log
   ~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
   ```
2. When the toast appears, click **Later**.
   - [ ] The toast hides, and the app still shows **OTA 1.0.1**.
   - [ ] `grep -c 'GET /ota/electron/files/' ~/ota-test/feed.log` prints about 7,
     the K in `grep '\[OTA\] Staged 1.0.2' ~/.config/Orbital/logs/main.log`
     (everything else reused from bundle 1.0.1).
3. Relaunch:
   ```bash
   pkill -f 'Orbital-.*\.AppImage'; ~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
   ```
   - [ ] The banner shows **OTA 1.0.2** without any prompt.
   - [ ] `ls ~/.config/Orbital/ota/bundles/` shows only `1.0.2` (after the boot is confirmed).

### A4. Never during a call

1. Create v1.0.3 and launch:
   ```bash
   pkill -f 'Orbital-.*\.AppImage'
   ~/ota-test/make-bundle.sh ~/github/orbital/electron/dist electron 1.0.3 https://orb.encamy.com "OTA 1.0.3"
   ~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
   ```
2. **Join a voice room right away**, before the toast appears (the check runs at
   startup).
   - [ ] No toast while in the call.
   - [ ] `grep '\[OTA\] Staged 1.0.3' ~/.config/Orbital/logs/main.log` shows the
     line, and the call was not interrupted.
3. Leave the call.
   - [ ] The toast appears, and **Reload** switches to **OTA 1.0.3**.

Optional, slow: leave the app untouched for 30 minutes (or hidden in the tray for
10). It applies by itself, but never while you're in a call.

### A5. A newer shell needs the native update

```bash
pkill -f 'Orbital-.*\.AppImage'
~/ota-test/make-bundle.sh ~/github/orbital/electron/dist electron 1.0.4 https://orb.encamy.com "OTA 1.0.4"
sed -i 's/"shell_api": [0-9]*/"shell_api": 99/' ~/ota-test/feed/ota-electron.json
jq '{version, shell_api}' ~/ota-test/feed/ota-electron.json   # must show 1.0.4 / 99
: > ~/ota-test/feed.log; : > ~/.config/Orbital/logs/main.log
~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
```

- [ ] `grep '\[OTA\]' ~/.config/Orbital/logs/main.log` shows
  `Latest 1.0.4 needs shell API 99 (have 1)`.
- [ ] `grep -c 'GET /ota/electron/files/' ~/ota-test/feed.log` prints `0`.
- [ ] `grep 'Checking for update' ~/.config/Orbital/logs/main.log` shows the
  line, and the overlay runs (ending in an error: no `latest-linux.yml`).
- [ ] The app keeps showing **OTA 1.0.3**.

### A6. Mismatches are ignored

Run each case on its own. Each one starts from a quit app and ends with a relaunch:

```bash
pkill -f 'Orbital-.*\.AppImage'; : > ~/.config/Orbital/logs/main.log
# ... the case's commands ...
~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
```

1. **Older shell:**
   ```bash
   ~/ota-test/make-bundle.sh ~/github/orbital/electron/dist electron 1.0.5 https://orb.encamy.com "OTA 1.0.5"
   sed -i 's/"shell_api": [0-9]*/"shell_api": 0/' ~/ota-test/feed/ota-electron.json
   ```
   - [ ] `grep '\[OTA\] Latest' ~/.config/Orbital/logs/main.log` shows
     `nothing to do (shell is newer than the bundle)`. No overlay.
2. **Other backend:**
   ```bash
   ~/ota-test/make-bundle.sh ~/github/orbital/electron/dist electron 1.0.6 https://other.example.com "OTA 1.0.6"
   ```
   - [ ] `grep '\[OTA\] Latest' ~/.config/Orbital/logs/main.log` shows
     `nothing to do (bundle is built for another backend)`.
3. **Corrupt blob:**
   ```bash
   ~/ota-test/make-bundle.sh ~/github/orbital/electron/dist electron 1.0.7 https://orb.encamy.com "OTA 1.0.7"
   H=$(jq -r '.files[] | select(.path=="index.html") | .sha256' ~/ota-test/feed/ota-electron.json)
   echo tampered > ~/ota-test/feed/ota/electron/files/$H
   ```
   - [ ] `grep '\[OTA\] Staging' ~/.config/Orbital/logs/main.log` shows
     `Staging 1.0.7 failed: ... checksum mismatch for index.html`.
   - [ ] No toast, and `cat ~/.config/Orbital/ota/state.json` has no `"pending": "1.0.7"`.
   - [ ] After another relaunch, `ls ~/.config/Orbital/ota/bundles/` shows no `*.tmp` folder.
4. **Invalid manifest:**
   ```bash
   ~/ota-test/make-bundle.sh ~/github/orbital/electron/dist electron 1.0.8 https://orb.encamy.com "OTA 1.0.8"
   sed -i 's|"path": "index.html"|"path": "../index.html"|' ~/ota-test/feed/ota-electron.json
   ```
   - [ ] `grep -E '\[OTA\] Invalid manifest|Checking for update' ~/.config/Orbital/logs/main.log`
     shows `[OTA] Invalid manifest`, then `Checking for update` (fallback as in A1).

### A7. A broken bundle rolls back

1. Create a broken v1.1.0 and launch:
   ```bash
   pkill -f 'Orbital-.*\.AppImage'
   ~/ota-test/make-bundle.sh ~/github/orbital/electron/dist electron 1.1.0 https://orb.encamy.com x broken
   : > ~/.config/Orbital/logs/main.log
   ~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
   ```
2. Click **Reload** on the toast.
   - [ ] The window shows "broken 1.1.0".
   - [ ] Within **30 s** it goes back by itself to the **built-in** bundle (no banner).
   - [ ] `grep 'failed to boot' ~/.config/Orbital/logs/main.log` shows
     `Bundle 1.1.0 failed to boot (no boot confirmation)`.
   - [ ] `cat ~/.config/Orbital/ota/state.json` shows `"active": null` and `"bad": ["1.1.0"]`.
3. Relaunch:
   ```bash
   pkill -f 'Orbital-.*\.AppImage'; : > ~/.config/Orbital/logs/main.log
   ~/github/orbital/electron/release/Orbital-1.0.0.AppImage &
   ```
   - [ ] `grep '\[OTA\] Latest' ~/.config/Orbital/logs/main.log` shows
     `nothing to do (bundle failed to boot before)`.

### A8. A native update replaces OTA bundles

1. Make an OTA bundle active again (repeat A2 with version `1.0.9`), then build a
   1.2.0 app:
   ```bash
   pkill -f 'Orbital-.*\.AppImage'
   cd ~/github/orbital
   sed -i 's/"version": "1.0.0"/"version": "1.2.0"/' electron/package.json
   make build-electron UPDATE_URL=http://127.0.0.1:8765/
   git checkout electron/package.json      # revert the version right away
   : > ~/.config/Orbital/logs/main.log
   ~/github/orbital/electron/release/Orbital-1.2.0.AppImage &
   ```
   - [ ] It runs the built-in 1.2.0 (no banner).
   - [ ] `grep '\[OTA\] Built-in' ~/.config/Orbital/logs/main.log` shows
     `Built-in 1.2.0, active built-in`.
   - [ ] `ls ~/.config/Orbital/ota/bundles/` is empty.
   - [ ] `git diff --stat electron/package.json` prints nothing.

### A9. Dev mode is untouched

```bash
cd ~/github/orbital && make dev-electron 2>&1 | tee ~/ota-test/dev-electron.log
```

- [ ] `grep -c '\[OTA\]' ~/ota-test/dev-electron.log` prints `0`, and no update overlay shows.

---

## Part B: Android

### B0. Build a test APK with a release-like version

`make build-android-dev` sets versionName `1.0`, which counts as a dev build, so
OTA would be skipped. Build with an explicit version instead:

```bash
cd ~/github/orbital
make build-android-web ANDROID_BACKEND_URL=https://orb-dev.encamy.com VERSION=1.0.0
rm -rf ~/ota-test/android-dist && cp -r mobile/dist ~/ota-test/android-dist   # later builds overwrite mobile/dist
cd mobile/android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk \
  ./gradlew assembleDebug -PorbitalDev -PversionName=1.0.0 -PversionCode=1000000
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Commands used throughout Part B:

```bash
# Clear logcat before a step
adb logcat -c
# Native OTA log lines (plugin tag OtaBundle)
adb logcat -d -s OtaBundle
# JS [OTA] lines (turn on Settings → Debug → "Enable Debug Logs" in the app first)
adb logcat -d | grep '\[OTA\]'
# Open / force-stop the app
adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
adb shell am force-stop app.orbital.dev
# Send to background / bring back
adb shell input keyevent KEYCODE_HOME
# Start over from a clean state (also signs you out)
adb shell pm clear app.orbital.dev
```

### B1. Point the backend at the local feed

The app gets the manifest URL from `GET /api/releases/latest`, which the backend
derives from `RELEASES_URL` and the `latest.yml` found there.

1. Write `latest.yml` and restart the dev backend with `RELEASES_URL` (stop the
   running `make dev` with Ctrl+C first). The variable works as long as `.env`
   doesn't set `RELEASES_URL` itself: `grep -c '^RELEASES_URL=' .env` must print `0`.
   ```bash
   echo 'version: 1.0.1' > ~/ota-test/feed/latest.yml
   cd ~/github/orbital && RELEASES_URL=http://100.111.0.8:8765 make dev
   ```
   Every later "restart the backend" means: Ctrl+C, then the same `make dev`
   command. Restarting also clears the backend's 5-minute release cache.
2. Check:
   - [ ] `curl -s https://orb-dev.encamy.com/api/releases/latest | jq -r .android_ota_manifest_url`
     prints `http://100.111.0.8:8765/ota-android.json`.
   - [ ] `adb shell curl -sI http://100.111.0.8:8765/latest.yml | head -1` prints
     `HTTP/1.0 200 OK` (or open the URL in the phone's browser).

### B2. Stage and apply with the toast instead of the APK prompt

1. Create v1.0.1, then open the app:
   ```bash
   ~/ota-test/make-bundle.sh ~/ota-test/android-dist android 1.0.1 https://orb-dev.encamy.com "OTA 1.0.1"
   : > ~/ota-test/feed.log; adb logcat -c
   adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
2. Sign in.
   - [ ] **No** "Update available / Download" APK prompt appears.
   - [ ] The "Orbital 1.0.1 is ready" toast appears instead.
   - [ ] `adb logcat -d -s OtaBundle` shows `Staged 1.0.1: K of N files downloaded`,
     with K about 7 and N about 220.
   - [ ] `grep -c 'GET /ota/android/files/' ~/ota-test/feed.log` prints the same K.
3. `adb logcat -c`, then tap **Reload**.
   - [ ] The red **OTA 1.0.1** banner shows.
   - [ ] **No** "Update available" APK prompt appears after the reload. If it says
     "You have 1.0.0", the bundle was made with an old helper: see 0.2.
   - [ ] `adb logcat -d -s OtaBundle` shows `Applying 1.0.1`, then `Bundle 1.0.1 booted`.
   - [ ] You are still signed in, and cached channels and unread badges are kept
     (same `https://localhost` origin).
4. Restart the app:
   ```bash
   adb logcat -c; adb shell am force-stop app.orbital.dev
   adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
   - [ ] The banner is still there.
   - [ ] `adb logcat -d -s OtaBundle` shows `Using bundle 1.0.1 (APK 1.0.0)`.
   - [ ] Push notifications, the media cache (open a channel with images) and the
     ongoing-call notification (start a call) still work.

### B3. Background apply and resume

1. Create v1.0.2 and point `latest.yml` at it, then restart the backend:
   ```bash
   ~/ota-test/make-bundle.sh ~/ota-test/android-dist android 1.0.2 https://orb-dev.encamy.com "OTA 1.0.2"
   echo 'version: 1.0.2' > ~/ota-test/feed/latest.yml
   ```
2. Background the app and bring it back (resume triggers a check):
   ```bash
   adb logcat -c; adb shell input keyevent KEYCODE_HOME
   adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
   - [ ] The toast appears.
   - [ ] `adb logcat -d -s OtaBundle` shows `Staged 1.0.2`.
3. Tap **Later**, then restart the app:
   ```bash
   adb shell am force-stop app.orbital.dev
   adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
   - [ ] The app shows **OTA 1.0.2**.

### B4. A newer shell gets the APK prompt

1. Create v1.0.3, raise its shell API above the APK's, point `latest.yml` at it,
   then restart the backend:
   ```bash
   ~/ota-test/make-bundle.sh ~/ota-test/android-dist android 1.0.3 https://orb-dev.encamy.com "OTA 1.0.3"
   sed -i 's/"shell_api": [0-9]*/"shell_api": 99/' ~/ota-test/feed/ota-android.json
   jq '{version, shell_api}' ~/ota-test/feed/ota-android.json   # must show 1.0.3 / 99
   echo 'version: 1.0.3' > ~/ota-test/feed/latest.yml
   ```
2. Restart the app:
   ```bash
   : > ~/ota-test/feed.log; adb logcat -c; adb shell am force-stop app.orbital.dev
   adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
   - [ ] No "is ready" toast.
   - [ ] The usual **APK prompt** ("Update available", "Orbital 1.0.3 is out")
     appears, saying "You have 1.0.2".
   - [ ] `adb logcat -d -s OtaBundle | grep Staged` shows nothing.
   - [ ] `grep -c 'GET /ota/android/files/' ~/ota-test/feed.log` prints `0`.
   - [ ] With debug logs on, `adb logcat -d | grep '\[OTA\]'` shows `stage 1.0.3: native`.

### B5. A broken bundle rolls back

1. Create a broken v1.1.0 and point `latest.yml` at it, then restart the backend:
   ```bash
   ~/ota-test/make-bundle.sh ~/ota-test/android-dist android 1.1.0 https://orb-dev.encamy.com x broken
   echo 'version: 1.1.0' > ~/ota-test/feed/latest.yml
   ```
2. Restart the app, then tap **Reload** on the toast:
   ```bash
   adb logcat -c; adb shell am force-stop app.orbital.dev
   adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
   - [ ] "broken 1.1.0" shows.
   - [ ] Within **30 s** the app goes back to the built-in bundle by itself.
   - [ ] `adb logcat -d -s OtaBundle` shows `Bundle 1.1.0 didn't confirm its boot, falling back`.
3. Variant, killed before it confirms: create another broken version, restart the
   backend, restart the app, tap **Reload**, and force-stop within 30 s:
   ```bash
   ~/ota-test/make-bundle.sh ~/ota-test/android-dist android 1.1.1 https://orb-dev.encamy.com x broken
   echo 'version: 1.1.1' > ~/ota-test/feed/latest.yml
   # restart the backend, restart the app, tap Reload, then right away:
   adb shell am force-stop app.orbital.dev
   adb logcat -c; adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
   - [ ] The app starts on the built-in bundle.
   - [ ] `adb logcat -d -s OtaBundle` shows `Bundle 1.1.1 never confirmed its boot, falling back`.
4. Restart the app once more:
   ```bash
   : > ~/ota-test/feed.log; adb logcat -c; adb shell am force-stop app.orbital.dev
   adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
   - [ ] No toast, and `grep -c 'GET /ota/android/files/' ~/ota-test/feed.log` prints `0`.
   - [ ] With debug logs on, `adb logcat -d | grep '\[OTA\]'` shows
     `stage 1.1.1: none (bundle failed to boot before)`.

### B6. A new APK resets to its own bundle

1. Make an OTA bundle active (repeat B2 with version `1.0.9`, tap Reload). Then
   build and install a 1.2.0 APK:
   ```bash
   cd ~/github/orbital
   make build-android-web ANDROID_BACKEND_URL=https://orb-dev.encamy.com VERSION=1.2.0
   cd mobile/android && JAVA_HOME=/usr/lib/jvm/java-21-openjdk \
     ./gradlew assembleDebug -PorbitalDev -PversionName=1.2.0 -PversionCode=1002000
   adb logcat -c; adb install -r app/build/outputs/apk/debug/app-debug.apk
   adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
   - [ ] The app starts on the APK's own bundle (no banner).
   - [ ] `adb logcat -d -s OtaBundle` shows `Using the built-in bundle 1.2.0`.
   - [ ] `adb shell run-as app.orbital.dev ls files/ota/bundles` prints nothing.
2. Reinstall the 1.0.0 test APK for the remaining steps (B0, with
   `adb uninstall app.orbital.dev` first, since Android refuses a lower versionCode).

### B7. Minimum version and OTA together

1. Stage v1.3.0, but don't reload:
   ```bash
   ~/ota-test/make-bundle.sh ~/ota-test/android-dist android 1.3.0 https://orb-dev.encamy.com "OTA 1.3.0"
   echo 'version: 1.3.0' > ~/ota-test/feed/latest.yml
   # restart the backend, then:
   adb logcat -c; adb shell am force-stop app.orbital.dev
   adb shell monkey -p app.orbital.dev -c android.intent.category.LAUNCHER 1
   ```
   - [ ] The "Orbital 1.3.0 is ready" toast shows. Leave it.
2. In Admin → App versions, set the Android minimum to `1.3.0`.
   - [ ] The app shows the blocking "Update required" screen.
   - [ ] Tapping **Check again** switches to the staged bundle: the **OTA 1.3.0**
     banner shows and `adb logcat -d -s OtaBundle` shows `Applying 1.3.0`.
   - [ ] The app then opens normally. That means the backend accepted its
     `X-Orbital-Client: android/1.3.0` header; a lower version gets 426 and the
     blocking screen again.
3. Clear the minimum in Admin → App versions afterwards.

### B8. APK without OTA (backward compatibility)

1. Install the previous release APK (no `OtaBundle` plugin) against the same backend:
   ```bash
   adb uninstall app.orbital.dev
   adb install ~/Downloads/Orbital-<previous>.apk
   adb logcat -c
   ```
   - [ ] The usual APK prompt appears.
   - [ ] `adb logcat -d | grep -iE 'OtaBundle|FATAL'` shows no crash. With debug
     logs on, there is no `[OTA] stage failed` line (the JS side treats the
     missing plugin as "unsupported").

---

## Part C: Release pipeline (dry run, optional)

Without publishing anything:

1. Build the release images as CI does (`docker build -f docker/Dockerfile.electron …`
   and `docker/Dockerfile.android`).
   - [ ] Both images contain `release/ota/ota-<platform>.json` and
     `release/ota/ota/<platform>/files/*`.
   - [ ] The manifests carry the tag version, the right `shell_api` from
     `shell-api.json`, and `backend_url` = `VITE_BACKEND_URL`.
2. After a real release is **published**:
   - [ ] `curl -s https://orbital-updates.encamy.com/ota-electron.json | jq '{version, shell_api}'`
     and the same for `ota-android.json` show the new version.
   - [ ] They were promoted together with `latest.yml`, never before it.

## Cleanup

```bash
# Stop the feed server (Ctrl+C in its terminal), then restart the backend without the override:
cd ~/github/orbital && make dev
# Desktop
pkill -f 'Orbital-.*\.AppImage'; rm -rf ~/.config/Orbital/ota
git -C ~/github/orbital diff --stat electron/package.json   # must print nothing
# Android
adb shell pm clear app.orbital.dev        # or: adb uninstall app.orbital.dev
# Test files
rm -rf ~/ota-test
```

Also clear the Android minimum version in Admin → App versions if you set one.
