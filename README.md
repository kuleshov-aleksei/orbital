# The Orbital

A simple yet powerful voice communication platform for small amount of people. Similar to Discord but built for simplicity.

## AI Disclaimer

This project is built by AI (like 99.99%). AI is not perfect, but this application was built in 2 weeks and it does its job. I just do not want to waste 6 months handcrafting artisanal code

## Features

- **Voice Rooms** - Create and join voice rooms with up to 10 participants
- **LiveKit SFU** - Scalable Selective Forwarding Unit for reliable voice communication
- **Screen Sharing** - Share your screen with quality options (720p, 1080p, source)
- **Advanced Audio Processing**
  - Multiple noise suppression algorithms (LiveKit Native, Browser Native)
  - Echo cancellation
  - Automatic gain control
- **OAuth authentication** - Supports OAuth2 providers Google and Discord.
- **Password authentication** - Basic email + nickname + password schema. WITHOUT sending emails, password recovery, etc. Just simple storage
- **Simple Deployment** - Frontent + Backend + LiveKit is all what you need. No complex modules like MAS, no custom path rewriting
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
| Share screen | ❌ | ✅ | ✅ | ✅ |
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

## Tech Stack

### Frontend
- Vue 3 + TypeScript + Tailwind CSS
- LiveKit Client SDK for real-time communication

### Backend
- Go 1.25+
- LiveKit Server SDK for room management
- WebSockets for signaling
- REST API for room and user management

## Quick Start

```bash
# Install dependencies
make install

# Generate license file for serving in about section
make licenses

# Run development servers
make dev

# Build everything
make build

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
- `make licenses` - Generates license information for deps

## Audio Processing

The Orbital supports multiple noise suppression algorithms:

- **LiveKit Native** - Built-in LiveKit noise suppression (SFU-optimized, low latency)
- **Browser Native** - Uses built-in browser audio processing

**Obsolete** but may come back:

- **RNNoise** - High-quality ML-based noise suppression (requires 48kHz microphone)
- **Speex** - Fast CPU-efficient noise suppression

Audio settings can be changed in real-time during calls via the User Settings modal.

## Deployment

Note that this section describes my personal setup and it can and it WILL be different for your usecase

### Production Architecture

My setup of the Orbital uses a split-traffic architecture for optimal performance:

- **Traefik (Load Balancer)**: Handles SSL termination for API/WebSocket traffic via path-based routing (`/livekit`)
- **LiveKit (Host Network)**: Media traffic goes directly to LiveKit using host networking for zero-overhead performance

#### Traefik Configuration

Use path-based routing to proxy LiveKit WebSocket connections through your main entrypoint:

```yaml
# Traefik routers configuration
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

Then set your `LIVEKIT_URL` in `.env`:
```bash
LIVEKIT_URL=wss://your-domain.com/livekit
```

#### Required Ports

| Port | Protocol | Purpose | Route |
|------|----------|---------|-------|
| 7880 | TCP | API/WebSocket | Via Traefik (SSL, path `/livekit`) |
| 7881 | TCP | ICE/TCP fallback | Direct to LiveKit |
| 3478 | UDP | TURN/UDP relay | Direct to LiveKit |
| 62000-65535 | UDP | WebRTC media | Direct to LiveKit |
| 5349 | TCP | TURN/TLS | Direct to LiveKit (or 443 if no LB) |

### Docker Compose Deployment

The production deployment uses host networking for LiveKit:

```bash
# Copy the deployment compose file
cp docker/docker-compose.deploy.yml /opt/orbital/docker-compose.yml

# Start services
cd /opt/orbital && docker compose up -d
```

LiveKit will bind directly to host network interfaces. Ensure the required ports are open on your firewall.

Checkout [deploy.yml](.github/workflows/deploy.yml) to see how it is deployed in the real world

## Audio sprites

UI SFX supports custom audio sprites. To create a new pack:

### 1. Gather audio samples

Name your audio files according to the supported events:

| Event | Description |
|-------|-------------|
| `join_room` | Played when user joins a voice room |
| `leave_room` | Played when user leaves a voice room |
| `mute` | Played when user mutes themselves |
| `unmute` | Played when user unmutes themselves |
| `deafen` | Played when user deafens themselves |
| `undeafen` | Played when user undeafens themselves |
| `camera_start` | Played when user starts their camera |
| `camera_stop` | Played when user stops their camera |
| `screenshare_start` | Played when user starts screen sharing |
| `screenshare_stop` | Played when user stops screen sharing |

### 2. Generate sprite with audiosprite

```bash
# Install audiosprite globally if needed
npm install -g audiosprite

# Generate sprite files
audiosprite --output pack_name *.mp3
```

This produces multiple audio files and a sprite definition (`pack_name.json`).

### 3. Provide assets

Place audio files inside `public/assets/`

### 3. Convert to TypeScript

Place `pack_name.json` into the project root directory, then run:

```bash
npm run convert:soundsprite -- pack_name.json
```

This generates a TypeScript sprite definition in `services/sprites/packName.ts`.

### 4. Register the sound pack

Include the generated sprites in `sounds.ts` to make the pack available in the app.
