# Android app updates

The Android app never downloads or installs anything itself. It finds out about
new releases and sends the user to the APK in the system browser; Android's
package installer does the rest. Updates install over the old app only because
every release is signed with the same key (see `ANDROID_SIGNING.md`).

## Update prompt

- `GET /api/releases/latest` (public, `backend/internal/handlers/releasehandler.go`)
  returns `android_url` (`<RELEASES_URL>/Orbital-<version>.apk`, the APK CI
  uploads next to the desktop installers) and `android_min_version`.
- The app checks on launch, on resume and every 6 hours in the foreground
  (`frontend/src/stores/appUpdate.ts`, wired in `App.vue`).
- A newer version shows `AppUpdatePrompt` (not during a call). "Later" hides it
  until an even newer version is out (`orbital_update_dismissed_version` in localStorage).
- The release only appears once the GitHub draft is **published**: that promotes
  `latest.yml`, which the backend reads to find the version.

## Minimum version (hard block)

The superadmin sets it in **Admin → App versions** (`PUT /api/admin/client-versions`).
It is stored in SQLite `app_settings` (`android_min_version`) and kept in memory
by `ClientVersionService`.

- The app identifies itself with `X-Orbital-Client: android/<version>` on API
  requests and `?client=android/<version>` on WebSockets.
- Below the minimum: API requests get `426 {"error":"client_outdated"}`
  (`ClientVersionGate`, except `/api/releases/latest`, `/api/version`,
  `/api/health`), and WebSockets are closed with code **4426**, both on
  connect and immediately when the minimum is raised.
- The app then shows `AppOutdatedScreen` (it can't be dismissed, and it leaves
  any active call) with a download button and "Check again".
- Web, Electron, dev builds (`dev-unknown`) and requests without the header are
  never blocked. This is a compatibility gate, not a security control.
- The backend refuses a minimum newer than the latest published release, so
  you can't lock out every app with no update available.

## Shipping a breaking backend change

1. Tag and release as usual, then **publish** the draft (the APK becomes the latest).
2. Admin → App versions → set the minimum to the new version.
3. To roll back, clear the minimum. Blocked users tap "Check again".
