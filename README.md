# The Orbital

A simple yet powerful voice communication platform for 5-10 people. Similar to Discord but built for simplicity.

## Features

- **Voice Rooms** - Create and join voice rooms with up to 10 participants
- **WebRTC Communication** - Direct low-latency peer-to-peer voice communication
- **Screen Sharing** - Share your screen with quality options (720p, 1080p, source)
- **Advanced Audio Processing**
  - Multiple noise suppression algorithms (Browser Native, RNNoise, Speex)
  - Echo cancellation
  - Automatic gain control
- **Real-time Debug Dashboard** - Monitor connection quality, audio settings, and network stats
- **Simple Deployment** - Single binary backend with Docker support

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
- `make test` - Run test suite
- `make docker-build` - Build Docker images
- `make docker-up` - Run with Docker Compose
- `make clean` - Clean build artifacts

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

## Audio Processing

The Orbital supports multiple noise suppression algorithms:

- **Browser Native** - Uses built-in WebRTC audio processing
- **RNNoise** - High-quality ML-based noise suppression (requires 48kHz microphone)
- **Speex** - Fast CPU-efficient noise suppression

Audio settings can be changed in real-time during calls via the User Settings modal.

## License

MIT
