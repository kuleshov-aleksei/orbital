# Deployment

This describes my personal setup. Yours can, and WILL, be different. See [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) for how it is deployed in the real world.

## What runs where

| Service | Required | Notes |
|---|---|---|
| Frontend (nginx) | yes | Static files, image `orbital-frontend` |
| Backend | yes | Single Go binary, SQLite database in `./data/backend/` |
| LiveKit | yes | Media server, host networking |
| Meilisearch | for text channels | Stores every text channel message. **Its volume is primary data** |
| Garage (S3) | for attachments | External instance, not part of the compose file |
| Immich ML | for search by image contents | External instance, not part of the compose file |

Without Meilisearch, the backend hides the text channel type. Without S3, attachments are off; without Immich ML, image contents are not indexed. Settings for all of them are in [CONFIGURATION.md](CONFIGURATION.md).

## Docker Compose

```bash
cp docker/docker-compose.deploy.yml /opt/orbital/docker-compose.yml
cd /opt/orbital && docker compose up -d
```

The compose file starts the frontend, backend, Meilisearch and LiveKit. It reads `.env` and needs at least:

```bash
VERSION=...                     # image tag
JWT_SECRET=...
LIVEKIT_URL=wss://your-domain.com/livekit
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
MEILI_MASTER_KEY=...            # at least 16 bytes
# Web frontend and the Electron app both call the API, so allow both origins
SERVER_CORS_ORIGINS=https://your-domain.com,orbital://app
```

Optional: `CHAT_MEDIA_S3_*` for attachments, `CHAT_ML_URL` for image search, and OAuth client IDs.

## Reverse proxy (Traefik)

Traffic is split:

- **Traefik** terminates SSL for the app, the API/WebSocket and LiveKit signaling (path `/livekit`).
- **LiveKit** uses host networking, so media goes straight to it with no proxy overhead.

```yaml
routers:
  livekit:
    entryPoints:
      - "https"
    rule: "Host(`your-domain.com`) && PathPrefix(`/livekit`)"
    middlewares:
      - strip-livekit-prefix
      - default-headers
    tls: {}
    service: livekit

middlewares:
  strip-livekit-prefix:
    stripPrefix:
      prefixes:
        - "/livekit"

services:
  livekit:
    loadBalancer:
      servers:
        - url: "http://your-livekit-host:7880"
      passHostHeader: true
```

Then set `LIVEKIT_URL=wss://your-domain.com/livekit`.

The backend takes client IPs for rate limiting from the first `X-Forwarded-For` entry, so keep it behind a proxy that sets that header.

## Ports

LiveKit (`livekit/livekit.yaml`):

| Port | Protocol | Purpose | Route |
|---|---|---|---|
| 7880 | TCP | API/WebSocket | Via Traefik (SSL, path `/livekit`) |
| 7881 | TCP | ICE/TCP fallback | Direct |
| 3478 | UDP | TURN/UDP relay | Direct |
| 62000-65535 | UDP | WebRTC media | Direct |
| 5349 | TCP | TURN/TLS (disabled by default) | Direct, or 443 without a load balancer |

Meilisearch and Immich ML must not be reachable from the internet. The S3 endpoint signed into attachment URLs (`CHAT_MEDIA_S3_PUBLIC_ENDPOINT`) must be reachable by browsers over HTTPS.

## Optional services

- **Garage**: create the `orbital-chat-media` bucket and a read/write key, then set `CHAT_MEDIA_S3_*`. No bucket CORS or website access is needed.
- **Immich ML**: it usually listens only on Immich's internal network. Attach the backend to that network, or publish port 3003 on a private interface, and set `CHAT_ML_URL`. Asking it for a CLIP model other than Immich's own loads a second model into RAM.

## Backups and upgrades

- Meilisearch is backed up before every release by `scripts/backup-release.sh` in the deploy workflow ([spec](specs/MEILI_RELEASE_BACKUP.md)). The compose file also takes a daily snapshot.
- Restore: [notes/BACKUP_RESTORE.md](notes/BACKUP_RESTORE.md).
- Meilisearch upgrades: take a snapshot and a dump first, then start once with `MEILI_UPGRADE_DB=true`.
- Desktop app releases and updates: [notes/MIGRATION_TO_S3.md](notes/MIGRATION_TO_S3.md).
