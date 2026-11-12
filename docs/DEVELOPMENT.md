# Development

## Tech stack

| Part | Stack |
|---|---|
| Frontend | Vue 3 + TypeScript + Tailwind CSS, Pinia, LiveKit Client SDK, PixiJS (spatial world) |
| Backend | Go, gorilla/mux + gorilla/websocket, LiveKit Server SDK, SQLite |
| Media | LiveKit SFU |
| Text channels | Meilisearch (message store and search) |
| Attachments | S3 via Garage, libvips for thumbnails |
| Image search | Immich machine-learning service (OCR + CLIP) |
| Desktop | Electron + Vite (`electron/`) |

Agent and contributor guidelines, including common traps, are in [AGENTS.md](../AGENTS.md).

## Prerequisites

- Node.js 26 and pnpm (the Docker images build with `node:26`)
- Go 1.27 (see `backend/go.mod`)
- libvips (the backend uses it through bimg)
- Docker & Docker Compose (LiveKit and the optional services run in containers)

## Running locally

```bash
make install   # frontend + backend dependencies
make dev       # LiveKit + frontend + backend
```

The development defaults point at the containers below, so each feature works once its container is up:

| Command | Starts | Needed for |
|---|---|---|
| `make meili-up` | Meilisearch | Text channels |
| `make garage-up` | Garage S3 (single node; creates the dev key and bucket) | Attachments. The backend reads the key from `GARAGE_DEFAULT_*` in `.env` |
| `make ml-up` | Immich ML | Search by image contents; also set `CHAT_ML_URL=http://localhost:3003` |

Each one has a matching `*-down` command. Without a service, its feature turns itself off.

## Commands

| Command | Description |
|---|---|
| `make help` | List all commands |
| `make install` | Install all dependencies |
| `make dev` | Run development servers |
| `make dev-public` | Run development servers on 0.0.0.0 with HTTPS |
| `make dev-electron` | Run the Electron app in dev mode |
| `make build` | Build frontend and backend |
| `make run-built` | Run the production build locally (nginx + binary) |
| `make lint` | Lint changed and untracked files (ESLint runs with `--fix`) |
| `make lint-full` | Lint all frontend sources |
| `make check` | Frontend type check |
| `make test` | Full test suite (Playwright e2e in Docker) |
| `make test-headed` | Playwright tests in headed mode |
| `make test-unit` | Frontend unit tests |
| `make test-backend` | Backend Go unit tests (what PR CI runs) |
| `make test-integration` | Backend integration tests (starts Meilisearch and Garage) |
| `make e2e-textchat` | Live text channel check on a throwaway backend and index |
| `make docker-build` | Build Docker images |
| `make docker-up` / `make docker-down` | Run / stop with Docker Compose |
| `make build-electron` | Build the Electron app |
| `make build-electron-linux` | Linux build (.AppImage, .deb, .tar.gz) |
| `make build-electron-win` | Windows build |
| `make build-electron-all` | All platforms |
| `make licenses` | Generate license information for dependencies |
| `make clean` | Remove build artifacts |

Use `make build` rather than running `go build` / `pnpm build` by hand.

## Related docs

- [CONFIGURATION.md](CONFIGURATION.md): settings and environment variables
- [specs/CHAT_SYSTEM.md](specs/CHAT_SYSTEM.md): text channel design
- [notes/MIGRATION_TO_S3.md](notes/MIGRATION_TO_S3.md): release and update storage
- [SPATIAL_WORLDS.md](SPATIAL_WORLDS.md), [SOUND_PACKS.md](SOUND_PACKS.md): content pipelines

## Building on Windows

Don't... Simply don't. If you value your time, avoid building this project on Windows at any cost.

- Make scripts won't work out of the box.
- The backend fails with odd libvips errors (`h2non\bimg@v1.1.9\image.go:93:49: undefined: Gravity`), so you will have to run it in Docker.
