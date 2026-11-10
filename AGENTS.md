# Development Agents

This document outlines the development guidelines and agent configurations for The Orbital project.

The role of this file is to describe common mistakes and confusion points that agents might encounter while working on this project. If you encounter something in the project that surprises you, please alert the developer you're working with and suggest updating AGENTS.md to help prevent future agents from having the same issue.

## Subagents

Follow sub-agents instructions. If sub-agent instruction says save patch notes to file, that means SAVE PATCH NOTES TO THE FILE

## Skills

Project skills live in `.opencode/skills/`. Load the matching skill before starting work in its area:

| Skill | Use when |
|---|---|
| `orbital-log-triage` | Diagnosing attached/pasted logs and runtime bugs |
| `orbital-dependency-audit` | Reviewing Renovate/Dependabot PRs and package/lockfile/runtime-image updates |
| `orbital-livekit-connection` | Join/reconnect, audio, mute/deafen, screen share, presence |
| `orbital-release-ops` | Electron build/publish, updater, S3/Garage, release/download endpoints |
| `orbital-verify` | Choosing and running lint/test/build checks |
| `orbital-retro` | Reviewing the session after verification passes |

### Retro

For implementation tasks, after verification passes and before the final response, load and run `orbital-retro`. It should suggest documentation, skill, or infrastructure improvements; it must not edit files unless the user asks.

## Project Overview

The Orbital is a voice chat web application for 5-10 people using LiveKit SFU technology.

**Mission**: Build a simple, blazingly fast voice call application for 5-10 people using WebRTC and Go.

## Design Context

For design decisions and visual guidelines, see [`.impeccable.md`](./.impeccable.md). This file contains the brand personality, target users, aesthetic direction, and design principles that should guide all UI/UX work.

## Tech Stack

- **Frontend**: Vue 3 + TypeScript + Tailwind CSS
- **Backend**: Go 1.21+
- **Communication**: LiveKit SFU + WebSockets + REST API
- **Note**: Signal.io usage is PROHIBITED
- **Deployment**: Docker + Docker Compose

## Project Structure

```
orbital/
├── frontend/          # Vue.js frontend
│   ├── src/
│   │   ├── components/    # Vue components
│   │   ├── composables/   # Vue composables (useLiveKit, etc.)
│   │   ├── services/      # Audio processing, WebSocket, LiveKit, Electron
│   │   └── stores/        # Pinia stores
├── backend/           # Go backend
│   ├── cmd/           # Application entry points
│   ├── internal/      # Internal packages
│   └── pkg/          # Public packages
├── electron/         # Electron desktop app
│   ├── main/         # Electron main process
│   ├── preload/      # Preload scripts
│   └── release/     # Built releases
├── docker/           # Docker configurations
├── livekit/          # LiveKit server configs
├── scripts/          # Build and utility scripts
├── Makefile          # Build commands
```

## Development Guidelines

### External dependencies

Utilize context7 mcp to read documentation of 3rd party libraries, tools, etc.
Do not try to explore source code or write scripts to test them. Documentation first. If fails, then explore

### Frontend Development
- Use Vue 3 Composition API
- Follow TypeScript best practices
- Use Tailwind CSS for styling
- Use LiveKit Client SDK for real-time communication
- Use Pinia for state management

### Backend Development
- Use Go 1.21+ features
- Follow standard Go project layout
- Use gorilla/mux for HTTP routing
- Use gorilla/websocket for WebSocket connections
- Implement proper error handling and logging

### Code Quality
- Run `make lint` before committing
- `make lint` covers changed and untracked files; use `make lint-full` to lint all frontend sources
- `make lint` runs ESLint with `--fix`, so it can rewrite (reformat) the files it checks. Re-read a file after linting before editing it again, or the next edit may not match.
- Use meaningful variable and function names
- Add comments for complex logic
- Follow language-specific conventions

### ⚠️ CRITICAL: Permissions (RBAC) must be enforced on the backend

Every new feature that can be locked behind a role permission MUST be validated on the backend, not only hidden in the UI. Frontend checks (`usePermissionsStore().can(...)`) are UX hints only.

- Permission bits live in `backend/internal/permissions/permissions.go` (mirror them in `frontend/src/types/permissions.ts`); add a new bit when a feature needs its own gate.
- **REST**: check with `requireRoomPerm` / `requireCategoryPerm` / `RequirePermission` (`backend/internal/handlers/permissions.go`).
- **WebSocket**: check with `canInRoom` in `backend/internal/websocket/hub.go` and reply with `sendPermissionDenied`; use `BroadcastRoomScoped` for room events.
- **LiveKit media**: any new published track needs a source mapped to a permission in `PublishSourcesFor` (`backend/internal/service/livekitservice.go`), otherwise the SFU rejects it with "insufficient permissions" (e.g. the boombox uses source `UNKNOWN` ↔ `use_boombox`).
- Changes must apply live: hook into `PermissionService` change notifications (see `Hub.OnPermissionsChanged`).
- Add backend tests for the denied path (403/404, rejected WS message, missing LiveKit source).

#### Adding a server-wide (role-only) permission — checklist

Besides the bit itself, a new server permission touches several easy-to-miss places:

1. `backend/internal/permissions/permissions.go`: the bit, `All`, `RoleOnly`, `Names`, and the right `Default*` seed set.
2. `backend/internal/storage/migrations.go`: a new migration that ORs the bit into existing roles (`UPDATE roles SET permissions = permissions | X WHERE id = '...'`). Changing `Default*` only affects fresh databases — see the soundboard/emoji grant migrations.
3. `frontend/src/types/permissions.ts`: the bit, `ROLE_ONLY_PERMISSIONS`, and a `PERMISSION_INFO` entry (otherwise it never shows in the roles editor).
4. If it unlocks an admin panel tab: the tab + default tab in `frontend/src/views/AdminPanel.vue`, the route guard in `frontend/src/router/index.ts` (`requiresAdminPanel`), and `canOpenAdminPanel` in `frontend/src/components/settings/AccountSettings.vue`.

### ⚠️ CRITICAL: API Naming Convention
**Backend (Go)** uses **snake_case** for JSON field names (`max_users`)
**Frontend (TypeScript)** uses **camelCase** for property names (`maxUsers`)
Types coming FROM backend to frontend should have **snake_case**. Do not follow regular frontend convention for this case

**When sending data from Frontend to Backend:**
- Always convert camelCase to snake_case in the API layer
- See `frontend/src/services/api.ts` for examples (e.g., `updateRoom` function)
- Example: `maxUsers` → `max_users`, `targetCategoryId` → `target_category_id`

**Failure to follow this convention will result in:**
- Request body fields being ignored (zero values)
- Bad Request errors from validation
- Silent failures where data doesn't persist

### Testing
- Write unit tests for business logic
- **Use realistic IDs in tests.** User IDs are padded URL-safe base64 (`qkUrdzLDoqslx8EEy2cM7Q==`, from `generateUserID` in `backend/internal/service/authservice.go`); room IDs look like `20261110145113MiTbtB`. Fixtures such as `"alice"` hide parsing bugs: a mention token pattern of `[A-Za-z0-9_-]` passed every unit test and dropped every real mention. Any pattern or validator that accepts IDs must allow `=` (and `+`/`/` for standard base64).
- Test LiveKit functionality in browsers
- Test WebSocket connections
- Use integration tests for API endpoints
- Never commit raw debug logs, credentials, or secrets from user reports

### Modals opened from popovers

Popovers such as `UserProfilePopover` close on any `pointerdown` outside themselves. A modal teleported to `<body>` counts as "outside", so a modal mounted inside a popover (or inside an `EmojiPicker` shown in one) is torn down on the first click. Mount such modals at the app root (`frontend/src/App.vue`) and open them through store state — see `customEmojisStore.isUploadOpen` / `CustomEmojiUploadModal`.

### Emoji in plain-text fields

`EmojiRef` values can be `custom:<id>`, which only renders through `EmojiGlyph`. Plain-text fields (room names) embed custom emojis as `<:shortcode:id>` tokens (`frontend/src/services/emoji/inlineText.ts`):

- Edit with `components/common/EmojiTextInput.vue` (`allow-custom`): the input shows `:shortcode:` and the model holds tokens. Without `allow-custom` the picker is unicode-only.
- Render with `components/common/EmojiText.vue` — never `{{ room.name }}` — or the raw token shows. Use `emojiTextToPlain` for non-HTML sinks (titles, logs).
- Length: a token counts as one character. Frontend `emojiTextLength`; backend `validRoomNameLength` (`backend/internal/handlers/roomhandler.go`). Otherwise count characters (`Array.from(s).length` / `utf8.RuneCountInString`), never bytes or UTF-16 units.

### Text channels (persistent chat)

Spec and decisions: [`docs/specs/CHAT_SYSTEM.md`](./docs/specs/CHAT_SYSTEM.md). Text channels are rooms with `type: "text"`; their messages live **only in Meilisearch** (`backend/internal/service/chatstore/`), never in SQLite. The in-call chat (`ChatService`, `send_message`) is a separate, ephemeral feature.

- Local Meilisearch: `make meili-up` (the backend's development defaults point at it).
- Text channel WS events (`text_*`) go to the global socket only; listen with `wsService.onGlobal`.
- **Never unmount the call view** (`VoiceCallView` / `SpatialWorldView`) to show something else: `useLiveKit` disconnects from LiveKit in `onUnmounted`. `MainContent.vue` keeps it mounted and hides it with `v-show` while a text channel is open.
- Tests that need Meilisearch use the `integration` build tag and run with `make test-integration`; PR CI runs only `go test ./...` (unit tests).
- `make e2e-textchat` runs a live REST/WebSocket check (`scripts/e2e-textchat.mjs`) against a throwaway backend with its own database and index, then cleans up. Run it after changes to `chatstore`, `websocket/textchat.go` or the text chat handlers.

### Electron Development
- Electron desktop app is in the `electron/` directory
- Release/update changes must follow `docs/notes/MIGRATION_TO_S3.md` and the `orbital-release-ops` skill
- Uses Vite for bundling with `vite-plugin-electron`
- Features include: system tray, window controls, auto-updates, deep linking (`orbital://`), desktop capture for screen sharing
- Frontend interacts with Electron via `window.electronAPI` (see `frontend/src/services/electron.ts`)
- The desktop app shares the same frontend code as the web version

### ⚠️ Electron Build Traps (venmic worker / utilityProcess)

1. **Main process builds as ESM, utilityProcess cannot load ESM from asar.** `frontend/package.json` has `"type": "module"` and the vite config `root` points at the frontend dir, so `vite-plugin-electron` detects the root package as ESM and builds the main process output as ESM. The Electron main process can load ESM bundles (even from inside `app.asar`), but **`utilityProcess.fork` CANNOT** — ESM relative imports (`import ... from "./chunk.js"`) fail with `ERR_MODULE_NOT_FOUND` when the module lives in an asar. Anything forked via `utilityProcess` (e.g. `electron/main/venmicWorker.ts`) must be built as a **self-contained CJS bundle with no ESM runtime chunks** — see the separate `coreElectron(...)` plugin instance in `electron/vite.config.ts` (`lib.formats: ["cjs"]` + `rolldownOptions.output.format: "cjs"` + `codeSplitting: false`).
2. **`process.argv` layout inside a utility process** is `[electronBinary, modulePath, ...args]` — NOT Node's `[node, script, ...]`. The first custom arg passed to `utilityProcess.fork(modulePath, args)` lands at `process.argv[2]`, not `argv[1]`.
3. **venmic addon calls block their caller thread.** The `@vencord/venmic` addon's `list()` blocks the calling thread with no timeout until the PipeWire worker replies; a vanished node mid-bind can wedge that worker forever. Never call it on the Electron main thread — all venmic calls go through the utilityProcess bridge in `electron/main/venmic.ts` (timeouts + kill/respawn recovery), and the watchdog debounces re-links (stability window + min gap) to avoid rebuild storms during node churn.

## Build Commands

The project uses a Makefile for common operations:

- `make install` - Install dependencies (frontend + backend)
- `make build` - Build frontend and backend
- `make dev` - Start development servers (LiveKit + frontend + backend)
- `make dev-public` - Start development servers on 0.0.0.0 with HTTPS
- `make dev-electron` - Run Electron in development mode
- `make lint` - Run code quality checks
- `make test` - Run full test suite (Playwright e2e in Docker)
- `make test-backend` - Run backend Go unit tests (what PR CI runs)
- `make test-integration` - Run backend integration tests (starts Meilisearch via `make meili-up`)
- `make e2e-textchat` - Live text channel check on a throwaway backend + Meilisearch index
- `make test-headed` - Run tests in headed mode
- `make docker-build` - Build Docker images
- `make docker-up` - Run with Docker Compose
- `make run-built` - Run production build locally (nginx + binary)
- `make build-electron` - Build Electron desktop app for Linux
- `make build-electron-win` - Build Electron for Windows
- `make build-electron-linux` - Build Electron for Linux
- `make build-electron-all` - Build Electron for all platforms

## CRITICAL

There are proper build command: `make build`. **DO NOT TRY TO BUILD FRONTEND AND BACKEND MANUALLY** USING go build and npm build

## Deployment

- Single binary backend deployment
- Frontend served via nginx
- Docker Compose for local development
- Environment-based configuration

## Architecture Principles

1. **Simplicity First** - This is NOT a large-scale application, avoid over-engineering
2. **No Over-Engineering** - Avoid microservices, complex architectures
3. **Browser Native** - Use WebRTC, avoid plugins and complex setups
4. **Single Binary** - Backend compiles to one executable
5. **Discord-like UX** - Familiar, clean interface
6. **SFU-Based** - Use LiveKit SFU for scalable voice communication
7. **Clean Code** - Maintainable and readable codebase

## Restrictions

THIS PART IS VERY IMPORTANT! NEVER SKIP IT

- Agents are not allowed to make git commits
- Agents are not allowed to install npm/go packages

## Godot

For godot related tasks use godot mcp with project located at ../orbital-spatial-maps/
