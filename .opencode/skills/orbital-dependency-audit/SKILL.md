---
name: orbital-dependency-audit
description: Use when reviewing a Renovate/Dependabot PR or any package, lockfile, Go module, or runtime-image update in Orbital. Verifies bot legitimacy, checks release-note breaking changes against actual project usage, and runs install/lint/test/build verification without touching unrelated code.
---

# Orbital Dependency Audit

## When to use

- A Renovate/Dependabot PR needs review or a dependency branch must be validated.
- `package.json`, `pnpm-lock.yaml`, `go.mod`/`go.sum`, or a pinned runtime image changes.
- Someone asks whether an update is safe, legitimate, or breaking.

## Orient

- Read `renovate.json` first; know the grouping, release-age, range, and automerge policy.
- Get the exact diff and the base branch:
  `git log --oneline -5`, `git branch --show-current`, `git merge-base origin/main HEAD`.
- Prefer `git show <commit>` / `git diff <base>..<head>` over re-reading whole lockfiles.
- `gh` may not be installed; fall back to fetching the PR page or relying on the local branch.

## Step 1 — Legitimacy

Confirm this is the real bot and only expected files changed:

- Author is `renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>` (or Dependabot's official identity).
- Branch name and commit message match the bot; one commit on top of the base is normal.
- Diff touches only dependency/build files: `package.json`, lockfiles, `go.mod`/`go.sum`, Dockerfiles, compose files, CI dependency pins.
- No source, workflow, `renovate.json`, or script changes.
- No **new** direct packages, lifecycle scripts (`preinstall`/`postinstall`/`prepare`), or non-registry sources (`tarball:`, `git:`, `file:`, `link:`, custom registries).
- New npm entries have normal registry integrity hashes; `go.sum` has both `h1` and `/go.mod` hashes.
- Pinned images are updated consistently everywhere they appear.
- Local `git log -1 --format='%G?'` returning `E` only means the signing key is absent locally, not a bad signature. Cross-check author/committer.
- HARD stop if legitimacy check fails

## Step 2 — Release notes and project impact

Enumerate **every** bump (including transitive duplicates) and classify patch/minor/major.

- Patch releases: normally safe; still read the notes for behavioural changes.
- Minor/major: find breaking changes, deprecations, engine/runtime floor changes, and new lint rules.
- Detect no-op range bumps: if the lockfile already resolved the target version, there is no runtime change.
- Map each package to real usage, e.g. `rg -n 'from "<pkg>"' frontend/src electron`.
- For lint plugins, compare new rules against the enabled presets (`flat/recommended`, `essential`, `strongly-recommended`) and note false-negative fixes that can surface old issues.
- For icon sets, verify the icons actually used still exist.
- For runtime images (LiveKit, Playwright, Go), check config-schema or platform-behaviour changes, not just the version.
- State explicitly whether any application code change is required. Usually it is **not**.

## Step 3 — Verification

1. **Install:** `make install`.
   - Then check `git status --short` / `git diff --stat`; there must be no lockfile or `go.sum` drift.
   - If pnpm rewrites the lockfile due to a local/Docker version mismatch, treat it as an environment artifact and verify with `--frozen-lockfile` instead.
2. **Lint:** `make lint` (frontend changed files + backend).
   - If `golangci-lint` is missing, run `go vet ./...` and report the substitution.
   - Run `make lint-full` to exercise all frontend sources, since plugin updates can surface latent issues.
   - `lint-full` uses `--fix`: inspect `git status`, and revert unrelated auto-fixes with `git checkout -- <file>`.
3. **Lint baseline (when `lint-full` fails):** determine whether failures are new.
   - Old plugin versions often remain in `frontend/node_modules/.pnpm/`.
   - Create a temporary config copy in `frontend/` that imports the old plugin, run `eslint --no-fix`, diff normalized output, then **delete the temp config**.
   - Identical findings mean the failures are pre-existing, not caused by the PR.
4. **Typecheck / unit tests:** `cd frontend && pnpm run typecheck` and `pnpm exec vitest run src`.
   - The repo has a known red typecheck baseline; do not "fix" unrelated errors.
   - Do not run bare `pnpm test`; it also picks up Playwright specs.
5. **Build:** `make build`.
6. **Tests:** `make test` (Playwright in Docker + backend `go test ./...`).
   - If Docker fails with `failed to add the host ... pair interfaces` or similar bridge/veth errors, rerun the built image with host networking:
     ```bash
     docker run --rm --network host --shm-size=1g --ipc=host \
       -e PLAYWRIGHT_SUMMARY_ONLY=1 \
       -v "$PWD/frontend/playwright-report:/app/frontend/playwright-report" \
       -v "$PWD/frontend/test-results:/app/frontend/test-results" \
       orbital-playwright-tests
     ```
7. Optional heavy checks: screenshot Playwright suite and `make build-electron-linux` when Electron/venmic/dbus changed.

## Guardrails

- Never commit, amend, push, or install new packages.
- Do not fix unrelated pre-existing lint/typecheck/test failures.
- Do not leave temporary configs, scripts, or downloaded artifacts behind.
- Do not report a red baseline as a regression; separate PR-specific results from known baseline.
- Do not run e2e or destructive tests against real user data or production services.

## Reporting

- Lead with a legitimacy verdict and the evidence.
- Give a per-package table: update, type, breaking?, project impact.
- Give a verification table: command, result, and whether the failure is PR-specific or pre-existing.
- State directly whether code changes are required (usually no).
- Mention environment substitutions (missing `golangci-lint`, host-network fallback).
- Stop before committing; the user decides whether to merge.

## References

- `renovate.json`
- `Makefile`, `scripts/run-tests.sh`
- `frontend/package.json`, `frontend/pnpm-lock.yaml`, `frontend/eslint.config.js`
- `electron/package.json`, `electron/pnpm-lock.yaml`
- `backend/go.mod`, `backend/go.sum`
- `docker-compose.dev.yml`, `docker/docker-compose.deploy.yml`, `docker/Dockerfile.playwright`
- `.opencode/skills/orbital-verify/SKILL.md`
- `docs/notes/MIGRATION_TO_S3.md`
