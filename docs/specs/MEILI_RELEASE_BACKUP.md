# Spec: Meilisearch Backup as a Release/Deploy Step

Status: **Implemented** (2026-11-12) in `scripts/backup-release.sh`, run by `.github/workflows/deploy.yml`. Runbook: `docs/notes/BACKUP_RESTORE.md`.
Date: 2026-11-10
Related: `docs/specs/CHAT_SYSTEM.md` §9, `docs/notes/MIGRATION_TO_S3.md`, skill `orbital-release-ops`

## Why
Text channel messages live **only** in Meilisearch (see the chat spec). Its data volume is primary data, so every deploy has to leave a restorable backup behind, especially because Meilisearch upgrades (dumpless, `MEILI_UPGRADE_DB`) are not atomic.

## Requirements
1. **Before** each release deploy replaces any container:
   - create a **snapshot** (fast restore, same Meilisearch version only);
   - create a **dump** (portable across versions, needed whenever the release bumps the Meilisearch image).
2. Both must succeed. Check the task status through `GET /tasks/{uid}`, since a failure only shows up as a failed task, not an HTTP error. **Abort the deploy if they fail.**
3. Upload the artifacts off the host to a dedicated S3/Garage bucket, `orbital-backups`, separate from the release and chat-media buckets. **Decision (2026-11-12):** a single copy, `meili/meili.snapshot` + `meili/meili.dump` + `meili/manifest.txt`, overwritten on every deploy, only after both tasks succeeded.
4. Retention: none for Meilisearch, since there is one copy (decision above). The daily host snapshot (req. 5) is the only older restore point. The SQLite DB backup is versioned instead (`db/<version>/<ts>/`, last 3 versions, `scripts/prune-s3-backups.sh`).
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

## Resolved
- Dump on every release (2026-11-12): the data is small, and it always gives a cross-version restore point.
- Skipped, not failed, when Meilisearch is not deployed or running (first deploy, or migrating from a compose file without it).
