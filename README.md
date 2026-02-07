# The Orbital

A simple yet powerful voice communication platform for 5-10 people. Similar to Discord but built for simplicity.

## AI Disclaimer

This project is built by AI (like 99.99%). AI is not perfect, but this application was built in 2 weeks and it does its job. I just do not want to waste 6 months handcrafting artisinal code

## Features

- **Voice Rooms** - Create and join voice rooms with up to 10 participants
- **WebRTC Communication** - Direct low-latency peer-to-peer voice communication
- **TURN server support (required)** - Allows user to connect to calls behind NAT
- **Screen Sharing** - Share your screen with quality options (720p, 1080p, source)
- **Advanced Audio Processing**
  - Multiple noise suppression algorithms (Browser Native, RNNoise, Speex)
  - Echo cancellation
  - Automatic gain control
- **Real-time Debug Dashboard** - Monitor connection quality, audio settings, and network stats
- **OAuth authentication** - Backend does not store authentication data - thats by design. So the only options to auth are using OAuth2 Google and Discord.
- **Simple Deployment** - Single binary backend with Docker support
- **Persistence** - Backend stores data in sqlite database. Easy management, easy deployment, easy life
- **Role-Based Access Control** - Granular permissions for different user types

## Role-Based Access Control

The Orbital implements a hierarchical role system:

| Role | Description |
|------|-------------|
| **Guest** | Unauthenticated users who can only join rooms |
| **User** | Authenticated users via OAuth (Discord/Google) |
| **Admin** | Can create, edit, and delete rooms and categories |
| **Super Admin** | Can promote/demote users to/from admin role |

### Permission Matrix

| Action | Guest | User | Admin | Super Admin |
|--------|-------|------|-------|-------------|
| Join rooms | ✅ | ✅ | ✅ | ✅ |
| Create rooms | ❌ | ❌ | ✅ | ✅ |
| Update rooms | ❌ | ❌ | ✅ | ✅ |
| Delete rooms | ❌ | ❌ | ✅ | ✅ |
| Create categories | ❌ | ❌ | ✅ | ✅ |
| Delete categories | ❌ | ❌ | ✅ | ✅ |
| Reorder rooms/categories | ❌ | ❌ | ✅ | ✅ |
| Promote users to admin | ❌ | ❌ | ❌ | ✅ |
| Demote admins to user | ❌ | ❌ | ❌ | ✅ |

**Notes:**
- The first user to log in via OAuth automatically becomes Super Admin
- Super Admin cannot demote themselves (prevents accidental lockout)
- Room ownership has been removed - all rooms are managed collectively by admins

## Tech Stack

### Frontend
- Vue 3 + TypeScript + Tailwind CSS
- WebRTC for real-time communication
- WebAssembly for 3rd party noise suppression (RNNoise, Speex)

### Backend
- Go 1.21+
- WebSockets for signaling
- REST API for room management

## Quick Start

```bash
# Install dependencies
make install

# Build everything
make build

# Run development servers
make dev

# Run development servers using build artifacts
make run-built

# Run development server on 0.0.0.0
make dev-public

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
- `make run-build` - Run build artifacts
- `make dev-public` - Run development servers on 0.0.0.0 address
- `make lint` - Run linters for both frontend and backend
- `make test` - Run test suite
- `make docker-build` - Build Docker images
- `make docker-up` - Run with Docker Compose
- `make clean` - Clean build artifacts

## Audio Processing

The Orbital supports multiple noise suppression algorithms:

- **Browser Native** - Uses built-in WebRTC audio processing
- **RNNoise** - High-quality ML-based noise suppression (requires 48kHz microphone)
- **Speex** - Fast CPU-efficient noise suppression

Audio settings can be changed in real-time during calls via the User Settings modal.
