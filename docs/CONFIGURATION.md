# Orbital Backend Configuration System

## Overview

The Orbital backend now uses a comprehensive configuration system that supports:

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
  cors_origins:
    - "*"

# TURN server configuration
turn:
  shared_secret: "pink-goose"
  url: "turn:192.168.1.169:3478"
  tls_url: "turns:192.168.1.169:5349"
  stun_urls:
    - "stun:stun.l.google.com:19302"
    - "stun:stun1.l.google.com:19302"
  realm: "orbital"
  credential_lifetime: 86400

# Room configuration
room:
  min_users: 2
  max_users: 10
  default_max_users: 10

# Security configuration
security:
  e2e_mode: false

# Logging configuration
logging:
  level: "info"
  request_logging: true
```

## Environment Variable Overrides

All configuration values can be overridden via environment variables:

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `SERVER_PORT` | Server port | 8080 |
| `SERVER_MODE` | Server mode (debug/release) | debug |
| `SERVER_CORS_ORIGINS` | CORS origins (comma-separated) | * |
| `TURN_SECRET` | TURN shared secret | pink-goose |
| `TURN_URL` | TURN server URL | turn:192.168.1.169:3478 |
| `TURN_TLS_URL` | TURNS server URL | turns:192.168.1.169:5349 |
| `TURN_STUN_URLS` | STUN URLs (comma-separated) | stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302 |
| `TURN_REALM` | TURN realm | orbital |
| `TURN_CREDENTIAL_TTL` | TURN credential lifetime (seconds) | 86400 |
| `ROOM_MIN_USERS` | Minimum users per room | 2 |
| `ROOM_MAX_USERS` | Maximum users per room | 10 |
| `ROOM_DEFAULT_MAX_USERS` | Default max users | 10 |
| `ORBITAL_E2E` | Enable E2E testing mode | false |
| `LOG_LEVEL` | Log level | info |
| `LOG_REQUESTS` | Enable request logging | true |

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
SERVER_PORT=9090 TURN_SECRET=my-secret go run ./cmd/server
```

### Docker Usage

```bash
# With environment variables
docker run -e TURN_SECRET=my-secret -e SERVER_PORT=8080 orbital-backend

# With custom config file (mounted)
docker run -v /path/to/config.yaml:/app/configs/config.yaml orbital-backend
```

## Configuration Priority

The system loads configuration in this priority order (highest to lowest):

1. **Environment Variables** - Override everything
2. **YAML Config File** - Custom config file path
3. **Default Config** - Hardcoded defaults

## Files Changed

### New Files Created

1. `.env.example` - Example environment variables file
2. `backend/configs/config.yaml` - Main configuration file
3. `backend/configs/turn.yaml` - TURN-specific config (deprecated, merged into main)
4. `backend/internal/config/config.go` - Main config loader with YAML support
5. `backend/internal/config/time.go` - Time utilities for testing
6. `docs/CONFIGURATION.md` - This documentation

### Updated Files

1. `backend/internal/config/turn.go` - Updated to use new TURNConfig struct
2. `backend/internal/config/room.go` - Updated for backward compatibility
3. `backend/cmd/server/main.go` - Updated to load and use config
4. `backend/internal/handlers/turnhandler.go` - Updated to accept Config

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
export SERVER_MODE=production
export SERVER_CORS_ORIGINS=https://yourdomain.com
export LOG_LEVEL=warn
export LOG_REQUESTS=false
```

## Security Notes

1. **TURN_SECRET**: Change this to a secure random string in production!
   ```bash
   openssl rand -base64 32
   ```

2. **E2E Mode**: Never enable `e2e_mode` in production. It exposes dangerous test endpoints.

3. **CORS Origins**: In production, specify exact domains instead of using `*`.

## Troubleshooting

### Config Not Loading

Check the path is correct:
```bash
./server -config=./configs/config.yaml
```

### Environment Variables Not Working

Ensure variable names match exactly (case-sensitive):
```bash
export TURN_SECRET=my-secret  # ✓ Correct
export turn_secret=my-secret  # ✗ Wrong case
```

### Validation Errors

The server validates config on startup. Check logs for specific errors:
```bash
Invalid configuration: TURN shared secret cannot be empty
```

## Migration from Hardcoded Config

If you previously had hardcoded values in the code, they have been moved to:

1. **backend/configs/config.yaml** - Default values
2. **Environment variables** - Override values
3. **Command-line flags** - `-config` flag for custom config file

The old `turn.go` hardcoded defaults are now in the YAML file with environment variable support.
