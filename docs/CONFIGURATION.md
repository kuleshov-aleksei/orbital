# Orbital Backend Configuration System

## Overview

The Orbital backend uses a comprehensive configuration system that supports:

1. **YAML Configuration File** - Structured configuration with comments
2. **Environment Variable Overrides** - For Docker/deployment flexibility
3. **Sensible Defaults** - Works out of the box for development

## Configuration File

The main configuration file is located at:
```
backend/configs/config.yaml
```

### Example Configuration

```yaml
# Server configuration
server:
  port: "8080"
  mode: "development"
  external_url: "http://localhost:5173"
  electron_redirect_url: "orbital://auth/callback"
  cors_origins:
    - "*"

# Room configuration
room:
  min_users: 2
  max_users: 6
  default_max_users: 6

# Security configuration
# For local automated tests
security:
  e2e_mode: false

# Database configuration
database:
  path: "./data/orbital.db"

# Authentication & OAuth configuration
auth:
  jwt_secret: "change-this-in-production"
  discord:
    client_id: ""
    client_secret: ""
    redirect_url: "http://localhost:3000/api/auth/discord/callback"
  google:
    client_id: ""
    client_secret: ""
    redirect_url: "http://localhost:3000/api/auth/google/callback"

# Logging configuration
logging:
  level: "info"
  request_logging: true

# WebSocket configuration
websocket:
  ping_timeout: 30s
  ping_check_interval: 10s
```

## Environment Variable Overrides

All configuration values can be overridden via environment variables:

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `PORT` | Server port | 8080 |
| `GIN_MODE` | Server mode (debug, release, test) | debug |
| `EXTERNAL_URL` | Frontend URL for OAuth redirects | http://localhost:5173 |
| `ELECTRON_REDIRECT_URL` | Deep link URL for Electron OAuth callback | orbital://auth/callback |
| `CORS_ORIGINS` | CORS origins (comma-separated) | * |
| `LIVEKIT_URL` | LiveKit WebSocket URL | ws://localhost:7880 |
| `LIVEKIT_API_KEY` | LiveKit API key | dev_key |
| `LIVEKIT_API_SECRET` | LiveKit API secret | this_is_a_development_secret_key_32chars |
| `ROOM_MIN_USERS` | Minimum users per room | 2 |
| `ROOM_MAX_USERS` | Maximum users per room | 6 |
| `ROOM_DEFAULT_MAX_USERS` | Default max users | 6 |
| `JWT_SECRET` | JWT secret for token signing | change-this-in-production |
| `ORBITAL_E2E` | Enable E2E testing mode (set to "1" or "true") | false |
| `LOG_LEVEL` | Log level (debug, info, warn, error) | info |
| `LOG_REQUESTS` | Enable request logging | true |
| `DATABASE_PATH` | SQLite database path | ./data/orbital.db |
| `WS_PING_TIMEOUT` | WebSocket ping timeout | 30s |
| `WS_PING_CHECK_INTERVAL` | WebSocket ping check interval | 10s |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID | (empty) |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret | (empty) |
| `DISCORD_REDIRECT_URL` | Discord OAuth redirect URL | http://localhost:3000/api/auth/discord/callback |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | (empty) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | (empty) |
| `GOOGLE_REDIRECT_URL` | Google OAuth redirect URL | http://localhost:3000/api/auth/google/callback |

## LiveKit Configuration

The Orbital uses LiveKit SFU for real-time voice/video communication. LiveKit is configured separately via `livekit/livekit.yaml`.

### Environment Variables for LiveKit

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `LIVEKIT_URL` | WebSocket URL to LiveKit server | ws://localhost:7880 |
| `LIVEKIT_API_KEY` | API key for token generation | dev_key |
| `LIVEKIT_API_SECRET` | Secret for signing tokens | this_is_a_development_secret_key_32chars |

### Production LiveKit URL

When deploying behind Traefik with SSL termination and path-based routing:
```bash
LIVEKIT_URL=wss://your-domain.com/livekit
```

For Docker Compose (internal communication):
```bash
LIVEKIT_URL=ws://livekit:7880
```

## Usage

### Running with Default Config

```bash
cd backend
go run ./cmd/server
# Uses configs/config.yaml
```

### Running with Custom Config File

```bash
cd backend
go run ./cmd/server -config=/path/to/custom.yaml
```

### Running with Environment Variables

```bash
# Override specific values
cd backend
PORT=9090 LIVEKIT_URL=ws://localhost:7880 go run ./cmd/server
```

### Docker Usage

```bash
# With environment variables
docker run -e PORT=8080 -e LIVEKIT_URL=ws://livekit:7880 orbital-backend

# With custom config file (mounted)
docker run -v /path/to/config.yaml:/app/configs/config.yaml orbital-backend
```

## Configuration Priority

The system loads configuration in this priority order (highest to lowest):

1. **Environment Variables** - Override everything
2. **YAML Config File** - Custom config file path
3. **Default Config** - Hardcoded defaults

## Development vs Production

### Development (Default)

```yaml
server:
  port: "8080"
  mode: "development"
  cors_origins:
    - "*"

logging:
  level: "debug"
  request_logging: true
```

### Production

```yaml
server:
  port: "8080"
  mode: "production"
  external_url: "https://yourdomain.com"
  cors_origins:
    - "https://yourdomain.com"
    - "https://app.yourdomain.com"

logging:
  level: "warn"
  request_logging: false

security:
  e2e_mode: false
```

Or via environment variables:

```bash
export GIN_MODE=release
export CORS_ORIGINS=https://yourdomain.com
export LOG_LEVEL=warn
export LOG_REQUESTS=false
export LIVEKIT_URL=wss://your-domain.com/livekit
```

## Security Notes

1. **JWT_SECRET**: Change this to a secure random string in production!
   ```bash
   openssl rand -base64 32
   ```

2. **LIVEKIT_API_SECRET**: Change this to a secure random string in production!
   ```bash
   openssl rand -base64 32
   ```

3. **E2E Mode**: Never enable `ORBITAL_E2E` in production. It exposes dangerous test endpoints.

4. **CORS Origins**: In production, specify exact domains instead of using `*`.

5. **OAuth Secrets**: Never commit `DISCORD_CLIENT_SECRET` or `GOOGLE_CLIENT_SECRET` to version control.

## Deployment

Check `.github/workflows/deploy.yml` to see how it is deployed in the real world

### Docker Compose

The production deployment uses host networking for LiveKit:

```bash
# Copy the deployment compose file
cp docker/docker-compose.deploy.yml /opt/orbital/docker-compose.yml

# Start services
cd /opt/orbital && docker compose up -d
```

### Required Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 7880 | TCP | API/WebSocket signaling |
| 7881 | TCP | ICE/TCP fallback |
| 3478 | UDP | TURN/UDP relay |
| 62000-65535 | UDP | WebRTC media |
| 5349 | TCP | TURN/TLS |

## Files

### Configuration Files

- `.env.example` - Example environment variables
- `backend/configs/config.yaml` - Main YAML configuration

### Source Files

- `backend/internal/config/config.go` - Config loader with YAML + env var support
- `backend/internal/config/livekit.go` - LiveKit configuration
- `backend/cmd/server/main.go` - Application entry point