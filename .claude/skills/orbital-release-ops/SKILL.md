---
name: orbital-release-ops
description: Use when changing Electron builds, auto-update feeds, S3/Garage artifacts, release/download endpoints, or CI publish workflows for Orbital. Enforces the stage-then-promote release model and avoids breaking existing clients.
---

# Orbital Release Ops

## When to use

- Electron build/publish workflow changes, updater source or feed URL changes.
- S3/Garage upload, retention, CORS, or download-page changes.
- Version/tag/release-note changes for the desktop app.

## Orient

- Treat `docs/notes/MIGRATION_TO_S3.md` as canonical; read it before editing workflows.
- Distinguish the public update URL (baked into builds) from the internal storage endpoint (CI only).
- Check which update provider the target clients already have baked in.

## Workflow

1. Keep the existing build → stage manifests → publish/promote split.
2. Preserve the draft-release gate: the draft carries release notes only — every
   binary and manifest lives on S3.
3. Keep credentials in GitHub secrets/variables; never print or commit them.
4. Update workflows, download endpoint, and docs together when the feed changes.
5. Delegate patch notes to `@patch-noter`; do not hand-write release notes here.

## Guardrails

- A feed URL change requires a rebuild; old clients keep their baked URL.
- OTA frontend manifests (`ota-electron.json`, `ota-android.json`) are staged and promoted together with `latest.yml`; never promote one without the other. Shell code changes need a `shell-api.json` bump (AGENTS.md).
- Manifests must be reachable where the provider expects them.
- Never attach installers, APKs or manifests to a GitHub release. Pre-2.55.0
  clients have the GitHub provider baked in and will fail their update check
  (`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`); that is accepted, see
  `docs/notes/MIGRATION_TO_S3.md` "Old GitHub clients".
- Never delete the old GitHub releases that still carry assets (2.55.x and the
  asset-era releases): they are the last migration path for a pre-bridge client.
- Do not pin tool versions in multiple places.

## References

- `docs/notes/MIGRATION_TO_S3.md`, `docs/notes/ANDROID_SIGNING.md`
- `.github/workflows/build-electron.yml` (Electron + Android APK), `.github/workflows/publish-electron.yml`
- `docker/Dockerfile.electron`, `docker/Dockerfile.android`
- `electron/electron-builder.json`, `electron/main/features/update.ts`, `electron/main/features/ota.ts`
- `scripts/ota-manifest.mjs`, `mobile/android/app/src/main/java/app/orbital/OtaBundlePlugin.java`
- `scripts/prune-s3-releases.sh`, `scripts/aws-cli-config`
