# Android app: OAuth via deep link

Status: **implemented** (custom URL scheme). QR device linking (`handlers/qrloginhandler.go`)
still works as an alternative.

## Why the Electron flow doesn't carry over

Electron signs in through a loopback server: the backend's Electron callback
(`authhandler.go`, `handleElectronCallback`) redirects to
`http://127.0.0.1:27271/callback?token=…&expires=…&state=…`, served by
`electron/main/features/oauth.ts`. A phone has no such listener.

## How it works

1. **Client kind in the OAuth state.** `AuthService.GenerateState(provider, client, appChallenge)`
   takes an `OAuthClient` (`web` / `electron` / `android` / `android-dev`, `service/oauthapp.go`).
   `/api/auth/{provider}/url?client=android&code_challenge=…` uses the app callback route
   (`…/electron/callback`, shared with Electron); only the final hop differs. The
   provider redirect URI is `DISCORD_ANDROID_REDIRECT_URL` / `GOOGLE_ANDROID_REDIRECT_URL`,
   falling back to `*_ELECTRON_REDIRECT_URL` (`AuthService.clientOAuthConfig`). The
   fallback is fine in production (public host) but not in development, where the
   Electron URI is `http://localhost:3000/…` and the phone's Custom Tab can't reach it.
   The legacy `?electron=true` still selects the desktop flow.
2. **One-time code, not the JWT, in the deep link.** Another app can register the
   scheme and receive the redirect, so the app callback redirects to
   `orbital://auth/callback?code=…&state=…`. The code is single-use (burned on the
   first attempt, even a failed one), lives 60 s, and is bound to the state and to
   the app's S256 challenge. The app redeems it with
   `POST /api/auth/exchange {code, state, code_verifier}` → `AuthResponse`.
3. **Two schemes.** The "Orbital Dev" build (`app.orbital.dev`) installs next to the
   production app, so it uses `orbital-dev://` (Gradle `manifestPlaceholders.oauthScheme`
   in `mobile/android/app/build.gradle`). The backend picks the URL from a fixed list
   (`OAuthClient.AppCallbackURL`); the app chooses `android-dev` when its app id ends
   in `.dev`. Keep the three places in step.
4. **Android side** (`frontend/src/services/oauthApp.ts`):
   - `AndroidManifest.xml`: VIEW/DEFAULT/BROWSABLE `intent-filter` with
     `android:scheme="${oauthScheme}"`, `android:host="auth"` on `MainActivity` (`singleTask`).
   - `startAppOAuth` makes the verifier, stores `{state, verifier}` in localStorage
     (Android may kill the app while the Custom Tab is open) and opens the provider URL
     with `@capacitor/browser`.
   - `setupAppOAuth` (called from `useNativeShell`) listens to `appUrlOpen` and checks
     `App.getLaunchUrl()` for cold starts, checks the state, calls `/auth/exchange`,
     closes the Custom Tab and calls `userStore.handleOAuthCallback`. Errors show in
     `AuthView` via `appOAuthError`.
5. **Tests.** `service/oauthapp_test.go` (single use, expiry, wrong state/verifier) and
   `handlers/authhandler_test.go` (client parsing, app redirect URI, cross-flow state
   rejection, `/auth/exchange`).

Optional later: verified App Links (`https://<domain>/.well-known/assetlinks.json`)
instead of a custom scheme. This removes the interception risk, but needs the release
signing key's fingerprint.
