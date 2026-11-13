# Android release signing

The release APK is built in CI by `docker/Dockerfile.android` (job in
`.github/workflows/build-electron.yml`) and signed with one long-lived key.

> **Never lose or replace this key.** Android only installs an update if it is
> signed with the same key as the installed app. A new key means every user has to
> uninstall (losing app data) and reinstall. Keep the keystore file and its
> password in a password manager or another backed-up, private place, and never
> commit them (`*.jks` / `*.keystore` are in `.dockerignore`; keep them out of the
> repo entirely).

## 1. Create the keystore (once)

Needs a JDK (`keytool`; e.g. `/usr/lib/jvm/java-21-openjdk/bin/keytool`):

```sh
keytool -genkeypair -v \
  -keystore orbital-release.jks \
  -alias orbital \
  -keyalg RSA -keysize 4096 -validity 10000
```

- It asks for **one** password. Modern `keytool` creates PKCS12 keystores, where
  the key uses the keystore password, so there is no separate key password.
  The Gradle config falls back to the keystore password
  (`mobile/android/app/build.gradle`).
- The **alias** is the name of the key inside the keystore file (a keystore can hold
  several keys). It's whatever you passed to `-alias`, here `orbital`. It isn't a
  secret. To check it:

  ```sh
  keytool -list -keystore orbital-release.jks
  # orbital, 13 Nov 2026, PrivateKeyEntry, ...
  ```

- The name/organisation questions only end up in the certificate. Users don't see them.
- `-validity 10000` (~27 years): Google Play requires a key valid past 2033, and an
  expired key can't sign updates.

## 2. Add the GitHub secrets

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The keystore file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | The password you entered in step 1 |
| `ANDROID_KEY_ALIAS` | The alias from step 1 (`orbital`) |

With the `gh` CLI. These commands don't put the values in your shell history or clipboard:

```sh
gh secret set ANDROID_KEYSTORE_BASE64 < <(base64 -w0 orbital-release.jks)
gh secret set ANDROID_KEYSTORE_PASSWORD      # prompts for the value
gh secret set ANDROID_KEY_ALIAS --body orbital
```

To use the web UI instead, go to *Settings → Secrets and variables → Actions*. Paste the
output of `base64 -w0 orbital-release.jks` as `ANDROID_KEYSTORE_BASE64`.

## 3. How CI uses them

1. "Prepare Android keystore" decodes `ANDROID_KEYSTORE_BASE64` to
   `$RUNNER_TEMP/orbital-release.jks`. An `if: always()` step deletes it at the end
   of the job.
2. "Build Android in Docker" passes the file, password and alias as **BuildKit
   secrets** (`--secret id=android_keystore,...`). They are mounted only
   for the Gradle step and never stored in image layers or history. Don't turn them
   into `--build-arg`s: build args are visible in `docker history`.
3. Inside the build they become `ORBITAL_KEYSTORE_FILE`,
   `ORBITAL_KEYSTORE_PASSWORD` and `ORBITAL_KEY_ALIAS`. `app/build.gradle` applies
   the release signing config only when `ORBITAL_KEYSTORE_FILE` is set, so local
   `make build-android` (debug) builds are unaffected.

## Building a signed APK locally

Use the same Dockerfile:

```sh
read -rs KSP    # keystore password
KSP="$KSP" KSA=orbital docker build \
  --secret id=android_keystore,src=/path/to/orbital-release.jks \
  --secret id=android_keystore_password,env=KSP \
  --secret id=android_key_alias,env=KSA \
  --build-arg VERSION=0.0.1 --build-arg VERSION_CODE=1 \
  -t orbital-android-build -f docker/Dockerfile.android .
docker create --name apk orbital-android-build
docker cp apk:/app/release/Orbital-0.0.1.apk . && docker rm apk
```

To test the pipeline, use a throwaway keystore instead of the real one. An APK signed
with a test key won't install over the release app.

Check the result (build-tools from the Android SDK):

```sh
apksigner verify --print-certs Orbital-0.0.1.apk   # certificate must match the release key
aapt dump badging Orbital-0.0.1.apk | head -1      # package, versionCode, versionName
```

## Version code

Android refuses an update whose `versionCode` is lower than the installed one. CI
derives it from the tag: `major*1000000 + minor*1000 + patch` (`1.4.2` → `1004002`).
Runs without a semver tag use `github.run_number`. Prerelease tags (`1.4.2-rc1`)
get the same code as the final release. That's fine, because Android accepts an
update with an equal versionCode.

## If the key is compromised or lost

There's no way to keep existing installs updating with a new key unless the app is
distributed through Google Play with Play App Signing. For direct APK
distribution:

1. Create a new keystore (step 1) and update the secrets (step 2).
2. Announce that users must uninstall the old app and install the new APK.
