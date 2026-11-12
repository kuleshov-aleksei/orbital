# Backups and restore runbook

Every production deploy (`.github/workflows/deploy.yml`, step "Backup data") runs
`scripts/backup-release.sh <version>` **before** any container is replaced. A
failed backup aborts the deploy. After a successful deploy,
`scripts/prune-s3-backups.sh` trims old database backups (non-fatal).

Spec: `docs/specs/MEILI_RELEASE_BACKUP.md`.

## What is stored (bucket `orbital-backups`)

```
db/<version>/<UTC yyyymmddTHHMMSSZ>/orbital.db.gz   SQLite online backup (integrity-checked)
db/<version>/<ts>/manifest.txt                       size, sha256, git sha
meili/meili.snapshot                                 latest snapshot (same Meili version only)
meili/meili.dump                                     latest dump (portable across versions)
meili/manifest.txt                                   release, Meili version, sizes, sha256
media/{audio,soundboard,emojis,avatars}/             mirror of /opt/orbital/data/backend/<dir>
```

- **db/** is versioned. The newest 3 versions are kept (ranked by backup time),
  and only the newest backup of each version.
- **meili/** is a single copy, overwritten on every deploy, only after both the
  snapshot and the dump tasks succeeded. `manifest.txt` is written last, so a
  stale manifest means the last run died mid-upload. The daily
  `MEILI_SCHEDULE_SNAPSHOT` on the host (`data/meilisearch/snapshots/`) is the
  second safety net.
- **media/** is a pure mirror (`aws s3 sync --delete`): only new/changed files
  are uploaded, files deleted on the host are deleted remotely. A missing or
  empty local dir is skipped instead of wiping the remote mirror. Restoring an
  older DB can reference media that has since been deleted.
- Parts whose data/service is not deployed yet are skipped with a warning (first
  deploy, or a compose file without `meilisearch`).
- **Not backed up:** `/opt/orbital/.env`, `configs/`, `livekit/`. Keep `.env` in
  a password manager. A different `MEILI_MASTER_KEY` changes the derived
  Meilisearch API keys, so `MEILI_API_KEY` must be re-created after a restore.

## One-time setup

On the Garage host:

```bash
garage bucket create orbital-backups
garage key create orbital-backups-ci
garage bucket allow --read --write orbital-backups --key orbital-backups-ci
```

In GitHub (repository settings):

- secrets `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` (the key above);
- variable `BACKUP_S3_BUCKET=orbital-backups`;
- reused: secrets `S3_ENDPOINT`, `S3_REGION`; variable `AWS_CLI_VERSION`.

## Restore

All commands run on the host from `/opt/orbital`. `aws` stands for the
dockerized CLI used by the scripts:

```bash
aws() {
  docker run --rm \
    -v /path/to/orbital/scripts/aws-cli-config:/aws/config:ro -e AWS_CONFIG_FILE=/aws/config \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION -e AWS_ENDPOINT_URL \
    -v "$PWD/restore:/restore" "amazon/aws-cli:${AWS_CLI_VERSION}" "$@"
}
mkdir -p restore
```

### Database

```bash
aws s3 ls --recursive s3://orbital-backups/db/          # pick <version>/<ts>
aws s3 cp s3://orbital-backups/db/<version>/<ts>/orbital.db.gz /restore/
docker compose stop backend
cp data/backend/orbital.db data/backend/orbital.db.before-restore
gunzip -c restore/orbital.db.gz > data/backend/orbital.db
docker compose start backend
```

### Media

```bash
# Add -v "$PWD/data/backend:/data" to the aws() docker args first.
aws s3 sync s3://orbital-backups/media/audio/ /data/audio/
# repeat for soundboard, emojis, avatars
```

### Meilisearch, same version (snapshot, fast)

Meilisearch refuses to import over an existing database, so start from an empty
data dir:

```bash
aws s3 cp s3://orbital-backups/meili/ /restore/ --recursive
docker compose stop meilisearch
mv data/meilisearch data/meilisearch.before-restore
mkdir -p data/meilisearch/tmp
cp restore/meili.snapshot data/meilisearch/
docker compose run --rm meilisearch \
  meilisearch --import-snapshot /meili_data/meili.snapshot   # Ctrl-C once it listens
docker compose up -d meilisearch
```

Check `restore/manifest.txt`: the snapshot only loads into the same
Meilisearch version (`meilisearch=` line).

### Meilisearch, other version (dump, re-indexes everything)

Same as above, but import the dump:

```bash
cp restore/meili.dump data/meilisearch/
docker compose run --rm meilisearch \
  meilisearch --import-dump /meili_data/meili.dump
```

API keys are recreated from the current `MEILI_MASTER_KEY` (dumps never contain
key values).

## Rehearsal log

- 2026-11-12: local rehearsal against the dev Garage with a fixture deploy dir.
  Backup, incremental media sync (no re-upload, remote delete), retention, and
  restore via `--import-snapshot` and `--import-dump` (Meilisearch 1.56.2) all
  verified. Still to do: one rehearsal on the production host.
