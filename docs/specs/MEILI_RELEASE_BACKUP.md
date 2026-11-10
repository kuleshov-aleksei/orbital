# Spec: Meilisearch Backup as a Release/Deploy Step

Status: **Planned, out of scope for the chat work.** Written down so it isn't forgotten.
Date: 2026-11-10
Related: `docs/specs/CHAT_SYSTEM.md` §9, `docs/notes/MIGRATION_TO_S3.md`, skill `orbital-release-ops`

## Why
Text channel messages live **only** in Meilisearch (see the chat spec). Its data volume is primary data, so every deploy has to leave a restorable backup behind, especially because Meilisearch upgrades (dumpless, `MEILI_UPGRADE_DB`) are not atomic.

## Requirements
1. **Before** each release deploy replaces any container:
   - create a **snapshot** (fast restore, same Meilisearch version only);
   - create a **dump** (portable across versions, needed whenever the release bumps the Meilisearch image).
2. Both must succeed. Check the task status through `GET /tasks/{uid}`, since a failure only shows up as a failed task, not an HTTP error. **Abort the deploy if they fail.**
3. Upload the artifacts off the host to a dedicated S3/Garage bucket, e.g. `orbital-backups`. It must be separate from the release and chat-media buckets, with object keys like `meili/<release-version>/<timestamp>.{snapshot,dump}`.
4. Retention: keep the last N releases (e.g. 10), plus anything newer than 30 days. Reuse the pruning approach from `scripts/prune-s3-releases.sh`.
5. Keep the daily scheduled snapshot (`MEILI_SCHEDULE_SNAPSHOT=86400`) as a second safety net between releases. Copying it off the host is optional.
6. Document and rehearse a restore runbook in `docs/notes/` at least once:
   - same-version restore with `--import-snapshot`;
   - cross-version restore with `--import-dump`.

## Sketch
- `scripts/backup-meili.sh` (run by the deploy pipeline or runner):
  1. `POST /snapshots` and wait for the task;
  2. `POST /dumps` and wait for the task;
  3. copy the files from the Meilisearch volume (`snapshots/`, `dumps/`);
  4. upload them with the existing `aws` CLI config (`scripts/aws-cli-config`);
  5. verify the upload (size / checksum);
  6. delete the local copies.
- Credentials: a backup-only key, using the Meilisearch master key or a key with `snapshots.create` and `dumps.create`. The S3 key needs write access to the backups bucket only.
- Hook it into the release flow described in the `orbital-release-ops` skill and `docs/notes/runner-deploy.md`.

## Open
- The size budget for a backups bucket on Garage.
- Whether a dump is needed on every release, or only when the Meilisearch image version changes. Dumps take longer, since restoring one re-indexes everything.
