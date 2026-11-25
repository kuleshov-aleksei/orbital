# Build cache prewarm (release builds)

The desktop release build spends most of its time downloading, not compiling.
From the 3.8.1 run on node-04 (2026-11-25, 43 m 54 s for the Electron image):

| Step | Time | What it was doing |
|---|---|---|
| `audiocap` stage base image | 26 m 33 s | pulling `rust:1.100-trixie` (~600 MB) |
| `rustup target add` + mingw | 13 m 46 s | 116 MB of `gcc-mingw-w64` at ~207 kB/s |
| `generate-licenses.js` | 45 s | one registry lookup per dependency |
| actual work (typechecks, vite, both installers, OTA) | ~2 m 50 s | |

The registries were not to blame: measured on the same host the next day,
Docker Hub and the configured mirror both delivered ~7.5 MB/s on a cold 237 MB
blob. The 18:00 window was simply slow. So the fix is not a faster mirror — it
is to take the network out of release night.

`docker/Dockerfile.electron` is split at a `deps` stage for exactly this:

```dockerfile
# Source-independent: base images, OS packages, pnpm installs, license list
FROM node:26.13.0-trixie AS deps
# Source-dependent: typechecks, assets, packaging
FROM deps AS release-build
```

CI's prewarm builds only `--target audiocap` and `--target deps`; the release
build then finds those layers in the local BuildKit cache and re-runs only the
source-dependent tail (~2–3 min instead of ~44).

## The contract

**Nothing above the `deps` boundary may read commit-specific files.** That is
the whole trick: a layer whose inputs are only the lockfiles, the base image
digest, the OS packages and the (rarely edited) license generator stays valid
across commits, so a nightly prewarm does not grow the cache by a new copy of
the tree every day.

`electron/scripts/` is the one deliberate exception: `generate-licenses.js` and
its `licenses-config.json` are copied above the boundary because the license
lookups are slow (one registry query per dependency) and neither file changes
per commit. Editing them invalidates the license layer, which is correct.

When changing the Dockerfile:

- Adding a `COPY .` / `COPY frontend/` / `COPY electron/` above `FROM deps AS release-build`
  silently makes the prewarm source-dependent again (the release still works,
  it just stops benefiting). Keep source copies below the boundary.
- Renaming or removing the boundary breaks `--target deps`; update this doc and
  `scripts/prewarm-build-cache.sh` together.
- Adding a slow network step (new `apt-get`, a tool download) above the
  boundary is fine and desirable — that is what gets prewarmed.

## Install on the build machine

Prewarm must run on the same host and Docker daemon as the runner: the cache
lives in that daemon's store, not in the repository.

```bash
sudo git clone https://github.com/kuleshov-aleksei/orbital /opt/orbital-prewarm
sudo chown -R root:root /opt/orbital-prewarm
sudo /opt/orbital-prewarm/scripts/prewarm-build-cache.sh origin/main   # first run, slow
```

`/etc/systemd/system/orbital-prewarm.service`:

```ini
[Unit]
Description=Orbital: prewarm the Docker build cache for release builds
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/orbital-prewarm/scripts/prewarm-build-cache.sh origin/main
Nice=10
```

`/etc/systemd/system/orbital-prewarm.timer`:

```ini
[Unit]
Description=Daily Orbital build-cache prewarm

[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
RandomizedDelaySec=30m

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now orbital-prewarm.timer
systemctl list-timers orbital-prewarm.timer
journalctl -u orbital-prewarm.service -n 50 --no-pager
```

Timing matters: the timer must fire **after** a base-image or lockfile bump
lands and **before** the release. Daily is enough; a Renovate bump costs one
slow prewarm instead of one slow release.

Run it manually right after bumping `rust:`/`node:`/lockfiles, or before cutting
a release:

```bash
sudo systemctl start orbital-prewarm.service
```

### Optional: warm the exact commit being released

`PREWARM_MODE=full` also builds this ref's source layers and the packaging tail
(needs `--build-arg VERSION` only, which cannot leak above the boundary):

```bash
sudo PREWARM_MODE=full /opt/orbital-prewarm/scripts/prewarm-build-cache.sh <tag>
```

Best parity when the tag is already pushed, at the cost of ~1–2 GB of cache per
new commit. The default (`deps`) stays bounded and is what the timer runs.

## Verify it worked

On the next release, keep the build log and look for `CACHED` on the heavy
steps:

```bash
docker build --progress=plain -f docker/Dockerfile.electron . 2>&1 | tee /tmp/build.log
grep -E '\[audiocap |\[deps ' /tmp/build.log | grep -E 'apt-get|pnpm install|generate-licenses|rustup'
```

Every line above should read `CACHED`. A step that says `RUN` where you expected
`CACHED` means the prewarm used different inputs (moved tag, changed lockfile,
edited that step) — expected after a bump, worth investigating otherwise.

## Cache hygiene

- **Never run `docker builder prune -a` / `docker system prune -a` on the
  runner.** That is what makes the 44-minute build come back. The workflow's
  final `docker image rm orbital-…` is safe — it removes tagged images, not the
  build cache.
- If space is needed, prune by size/age, never wholesale:

  ```bash
  docker system df
  docker buildx du --verbose | tail -5      # what the cache is made of
  docker buildx prune --keep-storage 20GB --filter until=336h
  ```

- Re-run the prewarm afterwards; a size-based prune may drop layers it kept.
- `--filter until=` is the only safe way to drop old source-layer chains
  accumulated by `PREWARM_MODE=full`.

## Parity between prewarm and release

BuildKit cache keys are `base image digest + instruction + input file contents`.
A layer is reused only when all three match, otherwise the step runs normally —
there is no "similar layer" state, and a prewarm cannot silently poison a
release build.

What content-addressing does **not** pin is what `apt-get`, `cargo` and
`pnpm info` resolved at the moment the layer was built. Prewarming therefore
freezes the toolchain and the licence list as of prewarm time, which is the
intent: the release ships what was rehearsed. To force a refresh:

```bash
docker build --no-cache-filter=deps -f docker/Dockerfile.electron .
```

Two optional hardening steps:

- Pin base images by digest (`FROM rust:1.100-trixie@sha256:…`,
  `FROM node:26.13.0-trixie@sha256:…`) so a moving tag cannot change what the
  build pulls between prewarm and release.
- Re-run the prewarm immediately after any `renovate` bump of `rust`, `node`,
  `alpine` or a `pnpm-lock.yaml`, so the slow download happens on the timer and
  not in the release.

## Failure modes

- **Prewarm fails** (network down, registry rate limit): the release is
  unaffected, it is just slow again. Check `journalctl -u orbital-prewarm`.
- **Prewarm never runs**: same — slow release, no other effect.
- **The runner and the prewarm are different hosts**: nothing is shared. The
  timer must be on the machine that executes the workflow.
