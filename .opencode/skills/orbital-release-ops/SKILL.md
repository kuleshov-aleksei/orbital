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
2. Preserve the draft-release gate and artifact layout expected by the updater.
3. Keep credentials in GitHub secrets/variables; never print or commit them.
4. Update workflows, download endpoint, and docs together when the feed changes.
5. Delegate patch notes to `@patch-noter`; do not hand-write release notes here.

## Guardrails

- A feed URL change requires a rebuild; old clients keep their baked URL.
- Manifests must be reachable where the provider expects them.
- Do not reorder go-live and informational scanning steps.
- Do not pin tool versions in multiple places.

## References

- `docs/notes/MIGRATION_TO_S3.md`
- `.github/workflows/build-electron.yml`, `.github/workflows/publish-electron.yml`
- `electron/electron-builder.json`, `electron/main/features/update.ts`
- `scripts/prune-s3-releases.sh`, `scripts/aws-cli-config`
