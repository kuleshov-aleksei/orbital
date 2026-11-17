---
name: orbital-log-triage
description: Use when the user attaches or pastes Orbital logs (browser, Electron, backend, venmic, CI) or reports an intermittent runtime bug that needs diagnosis. Guides locating the right log source, isolating the first failure, correlating services, and reporting evidence without guessing.
---

# Orbital Log Triage

## When to use

- The user provides a log file or pasted stack/error block.
- A bug is intermittent, environment-specific, or only reproduces in Electron/release builds.

## Orient

- Identify the source: renderer debug buffer, uploaded debug log, Electron main log, CI job log, or backend log.
- Read the system-info header first: app version, platform, Electron-vs-web, OS.
- Confirm the log matches the current build and that the issue was reproduced during capture.

## Workflow

1. Build a timeline; note timezone and whether all sources share a clock.
2. Find the first meaningful error/warning; treat later failures as symptoms until proven otherwise.
3. Correlate renderer, backend, and LiveKit/WebSocket events around that timestamp.
4. Check environment-specific causes: origin/CORS, service reachability, stale build, missing asset, update feed.
5. State the root cause with evidence and list remaining unknowns.
6. Reproduce only when asked; use the repo blackout script for connectivity tests.

## Guardrails

- Do not guess from one line; look for the earliest divergence.
- Do not paste raw logs or secrets into issues, docs, skills, or commits.
- Do not run destructive tests or restart user services without permission.

## References

- `frontend/src/utils/debug.ts`, `frontend/src/services/systemInfo.ts`
- Settings → Debug and admin debug-log UI
- `electron/main/index.ts`, `electron/main/features/logRelay.ts`
- `scripts/simulate-blackout.sh`
