# Migrating Electron auto-updates to self-hosted Garage S3

This document tracks the move of the desktop app's update feed from GitHub
Releases to our self-hosted Garage S3 (served publicly over Traefik). It is
written so we can pick the work back up later.

## Why this works the way it does

The update feed URL is **baked into every build** as `resources/app-update.yml`
by electron-builder (from the `publish` block in `electron/electron-builder.json`).
A running client only ever reads the feed from the URL baked into *its own*
binary:

- Every client built before this migration has
  `provider: github, owner: kuleshov-aleksei, repo: orbital` baked in. It will
  only ever ask GitHub.
- Every client built after the switch has
  `provider: generic, url: <UPDATE_URL>, useMultipleRangeRequest: false` baked
  in. It will only ever ask S3.

So the migration is: deliver **one** build through the old channel (GitHub)
whose binary now points at S3. After it installs, that client reads S3 forever.
This is the "bridge" release.

Two important provider facts (verified in `electron-updater@6.8.9`):

- **Generic (S3) provider** fetches `<UPDATE_URL>/latest.yml` and resolves every
  file relative to that root. A missing `latest.yml` throws
  `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`. **All artifacts must live at the bucket
  root.**
- **GitHub provider** (non-prerelease) calls `GET /releases/latest`, which
  returns the newest **non-draft, non-prerelease** release, then fetches
  `latest.yml` from *that* release only. It does **not** fall back to an older
  release that happens to contain `latest.yml`. This is why an asset-less GitHub
  release would strand old clients (see Phase 2).

Garage's website endpoint supports single-range requests (`206`) but ignores
multi-range, hence `useMultipleRangeRequest: false`.

## Current state (Phase 1 — dual publish) — DONE

Every release is published to **both** GitHub (for old clients) and S3 (for
migrated/new clients), and the update checker points at S3.

### Bucket layout (`<S3_BUCKET>`, served at `https://orbital-updates.encamy.com/`)

```
Orbital-Setup-<version>.exe
Orbital-Setup-<version>.exe.blockmap
Orbital-<version>.AppImage
latest.yml
latest-linux.yml
_staging/<version>/latest.yml
_staging/<version>/latest-linux.yml
```

`latest.yml` / `latest-linux.yml` use **relative filenames**, so the same
manifest works against both GitHub and S3 as long as each host holds the
binaries. No URL rewriting is needed.

### Two distinct URLs (do not mix them)

| Secret | Value | Used by | TLS |
|---|---|---|---|
| `UPDATE_URL` | `https://orbital-updates.encamy.com/` | the app (baked into `app-update.yml`) | yes (public) |
| `S3_ENDPOINT` | `http://nas:30188` | CI only (upload/promote/retention) | no (internal LAN) |

`UPDATE_URL` is baked at build time — changing it later requires a rebuild (or a
runtime `autoUpdater.setFeedURL` override).

### Secrets (GitHub repo secrets)

`UPDATE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION` (Garage region, `garage`),
`S3_ACCESS_KEY` (Garage access key id), `S3_SECRET_KEY` (Garage secret), plus the
existing `VT_API_KEY`, `VITE_BACKEND_URL`, `UAT_TOKEN`.

CI maps the S3 secrets to the AWS CLI environment
(`S3_ACCESS_KEY → AWS_ACCESS_KEY_ID`, `S3_SECRET_KEY → AWS_SECRET_ACCESS_KEY`,
`S3_REGION → AWS_DEFAULT_REGION`, `S3_ENDPOINT → AWS_ENDPOINT_URL`) and runs the
AWS CLI via the `amazon/aws-cli` image. Addressing style is pinned to **path**
via `scripts/aws-cli-config` (mounted as `AWS_CONFIG_FILE`), because the `auto`
default would try virtual-host style (`bucket.nas`) for the DNS-compatible bucket
against the hostname endpoint.

### Phase 1 flow

```
manual workflow_dispatch (on tag) — .github/workflows/build-electron.yml
  ├─ docker build --build-arg UPDATE_URL=...        # bakes app-update.yml → S3
  ├─ aws s3 cp binaries → S3 root                    # inert (no latest.yml yet)
  ├─ aws s3 cp manifests → S3 _staging/<version>/    # staged
  ├─ scripts/prune-s3-releases.sh <bucket> 3         # keep newest 3 + live
  └─ ncipollo draft GitHub release with ALL assets   # old clients' channel

release: published — .github/workflows/publish-electron.yml
  ├─ VirusTotal scan of the release .exe (informational, appends link)
  └─ aws s3 cp _staging/<version>/{latest.yml,latest-linux.yml} → S3 root   # GO LIVE
```

The gate is the GitHub draft release: S3 binaries exist at build time but the
update only goes live when the manifests are promoted to the S3 root on publish.
The GitHub release assets (including the binaries) are what old clients download.

## Phase 2 — drop GitHub artifacts (TO DO LATER)

Goal: stop shipping binaries on GitHub. GitHub releases become manifest-less
triggers; binaries live only on S3.

### Precondition

Confirm clients have migrated to an S3-pointing build. Only start Phase 2 once stragglers on pre-bridge versions
are negligible.

### Tasks

1. **`build-electron.yml`** — remove the `ncipollo` artifact upload (or attach
   only the manifests). Keep the draft-release gate and the S3 upload/staging
   steps. The release draft still triggers `publish-electron.yml` on publish.
2. **Straggler handling.** A normal asset-less GitHub release becomes
   `/releases/latest`, and any still-GitHub client then 404s on `latest.yml`
   (`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`) and is stuck. Pick one:
   - **Mark Phase 2 releases as pre-release** → `/releases/latest` keeps
     returning the Phase 1 bridge, so old clients always migrate. Zero assets.
     Cost: real releases show as "Pre-release" on GitHub.
   - **Attach only the manifests** (`latest.yml` + `latest-linux.yml`) with
     **absolute S3 URLs** → normal releases; old clients read the manifest from
     GitHub and download from S3. Requires a small rewrite of the manifest URLs
     before attaching (electron-builder always writes relative filenames).
   - **Stop creating GitHub releases** and trigger promotion by tag/dispatch.
     Loses the GitHub notes/VT gate UI.
3. **VirusTotal step.** Once the release has no `.exe` asset, the
   `ghaction-virustotal` step has nothing to scan. Download the installer from S3
   first (`aws s3 cp s3://<bucket>/Orbital-Setup-<version>.exe` into the
   workspace) and point `files:` at it.
4. **Optional:** once GitHub releases carry no artifacts, consider whether to
   keep creating them at all. Keeping the bridge (Phase 1) release available
   forever is required for any client still on a pre-bridge build.

## Troubleshooting

- **AWS CLI addressing/region against Garage.** We pin `addressing_style = path`
  in `scripts/aws-cli-config` (there is no `AWS_S3_ADDRESSING_STYLE` env var; the
  setting is config-file only). If Garage still rejects requests, check that
  `AWS_DEFAULT_REGION` (`S3_REGION`) matches Garage's configured region.
- **`_staging/<version>/` accumulates.** Harmless; add an
  `aws s3 rm --recursive s3://<bucket>/_staging/<version>/` for the promoted
  version in `publish-electron.yml` if we want to keep the bucket tidy.
- **Empty `UPDATE_URL`.** If the secret is missing, CI passes
  `--build-arg UPDATE_URL=` (empty), overriding the Dockerfile default and
  producing a broken feed. Ensure the secret exists.
