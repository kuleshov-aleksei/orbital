# The Orbital

A simple yet powerful voice communication platform for 5-10 people. Similar to Discord but built for simplicity.

## Features

- Create and join voice rooms
- WebRTC-based voice communication
- Screen sharing
- Simple deployment with Docker
- Single binary backend

## Tech Stack

### Frontend
- Vue 3 + TypeScript + Tailwind CSS
- WebRTC for real-time communication

### Backend
- Go
- WebSockets for signaling
- REST API for simple operations

## Quick Start

```bash
# Install dependencies
make install

# Build everything
make build

# Run development servers
make dev

# Build and run with Docker
make docker-up
```

## Development

### Prerequisites
- Node.js 18+
- Go 1.21+
- Docker & Docker Compose

### Available Commands
- `make install` - Install all dependencies
- `make build` - Build frontend and backend
- `make dev` - Run development servers
- `make lint` - Run linters for both frontend and backend
- `make docker-build` - Build Docker images
- `make docker-up` - Run with Docker Compose
- `make clean` - Clean build artifacts

## Project Structure

```
orbital/
├── frontend/          # Vue.js frontend
├── backend/           # Go backend
├── docker/           # Docker configurations
├── scripts/          # Build and utility scripts
├── Makefile          # Build commands
└── AGENTS.md         # Development guidelines
```

## License

MIT