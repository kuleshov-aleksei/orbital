# Development Agents

This document outlines the development guidelines and agent configurations for The Orbital project.

The role of this file is to describe common mistakes and confusion points that agents might encounter while working on this project. If you encounter something in the project that surprises you, please alert the developer you're working with and suggest updating AGENTS.md to help prevent future agents from having the same issue.

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
- Use meaningful variable and function names
- Add comments for complex logic
- Follow language-specific conventions

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
- Test LiveKit functionality in browsers
- Test WebSocket connections
- Use integration tests for API endpoints

### Electron Development
- Electron desktop app is in the `electron/` directory
- Uses Vite for bundling with `vite-plugin-electron`
- Features include: system tray, window controls, auto-updates, deep linking (`orbital://`), desktop capture for screen sharing
- Frontend interacts with Electron via `window.electronAPI` (see `frontend/src/services/electron.ts`)
- The desktop app shares the same frontend code as the web version

## Build Commands

The project uses a Makefile for common operations:

- `make install` - Install dependencies (frontend + backend)
- `make build` - Build frontend and backend
- `make dev` - Start development servers (LiveKit + frontend + backend)
- `make dev-public` - Start development servers on 0.0.0.0 with HTTPS
- `make dev-electron` - Run Electron in development mode
- `make lint` - Run code quality checks
- `make test` - Run tests
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
