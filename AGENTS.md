# Development Agents

This document outlines the development guidelines and agent configurations for The Orbital project.

## Project Overview

The Orbital is a voice chat web application for 5-10 people using WebRTC technology.

## Tech Stack

- **Frontend**: Vue 3 + TypeScript + Tailwind CSS
- **Backend**: Go 1.21+
- **Communication**: WebSockets + REST API
- **Deployment**: Docker + Docker Compose

## Project Structure

```
orbital/
├── frontend/          # Vue.js frontend
│   ├── src/
│   │   ├── components/    # Vue components
│   │   ├── composables/   # Vue composables (useWebRTC, etc.)
│   │   ├── services/      # Audio processing, WebSocket, WebRTC
│   │   └── stores/        # Pinia stores
├── backend/           # Go backend
│   ├── cmd/           # Application entry points
│   ├── internal/      # Internal packages
│   └── pkg/           # Public packages
├── docker/           # Docker configurations
├── scripts/          # Build and utility scripts
├── Makefile          # Build commands
└── AGENTS.md         # Development guidelines
```


## Development Guidelines

### Frontend Development
- Use Vue 3 Composition API
- Follow TypeScript best practices
- Use Tailwind CSS for styling
- Implement WebRTC using native browser APIs
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
- Test WebRTC functionality in browsers
- Test WebSocket connections
- Use integration tests for API endpoints

## Build Commands

The project uses a Makefile for common operations:

- `make install` - Install dependencies
- `make build` - Build frontend and backend
- `make dev` - Start development servers
- `make dev-public` - Start development servers on 0.0.0.0
- `make lint` - Run code quality checks
- `make test` - Run tests
- `make docker-build` - Build Docker images
- `make docker-up` - Run with Docker Compose

## CRITICAL

There are proper build command: `make build`. **DO NOT TRY TO BUILD FRONTEND AND BACKEND MANUALLY** USING go build and npm build

## Deployment

- Single binary backend deployment
- Frontend served via nginx
- Docker Compose for local development
- Environment-based configuration

## Architecture Principles

1. **Simplicity First** - Avoid over-engineering
2. **Single Binary** - Backend compiles to one executable
3. **Browser Native** - Use WebRTC without plugins
4. **Clean Code** - Maintainable and readable codebase

## Restrictions

THIS PART IS VERY IMPORTANT! NEVER SKIP IT

- Agents are not allowed to make git commits
