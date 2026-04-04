.PHONY: help install build dev dev-public dev-electron lint lint-full prettier test clean docker-build docker-up certs run-built licenses build-electron build-electron-win build-electron-linux build-electron-all

# Default target
help:
	@echo "Available commands:"
	@echo "  install           - Install dependencies for frontend and backend"
	@echo "  build             - Build frontend and backend"
	@echo "  dev               - Run development servers"
	@echo "  dev-public        - Run development servers on all interfaces (0.0.0.0)"
	@echo "  dev-electron      - Run Electron in development mode (starts backend + LiveKit)"
	@echo "  lint              - Run linters for frontend and backend"
	@echo "  test              - Run tests"
	@echo "  test-headed       - Run tests in headed mode"
	@echo "  clean             - Clean build artifacts"
	@echo "  docker-build      - Build Docker images"
	@echo "  docker-up         - Run with Docker Compose"
	@echo "  run-built         - Run production build locally (nginx + binary, no Docker)"
	@echo "  licenses          - Generate frontend licenses JSON"
	@echo "  build-electron       - Build Electron desktop app"
	@echo "  build-electron-win   - Build Electron for Windows"
	@echo "  build-electron-linux - Build Electron for Linux"

# Install dependencies
install:
	@echo "Installing frontend dependencies..."
	cd frontend && npm install
	@echo "Installing backend dependencies..."
	cd backend && go mod download

# Get version from git tag + commit
VERSION := $(shell ./scripts/version.sh 2>/dev/null || echo "dev-unknown")

# Build everything
build:
	@echo "Building version: $(VERSION)"
	@echo "Building frontend..."
	cd frontend && VITE_APP_VERSION=$(VERSION) npm run build
	@echo "Building backend..."
	cd backend && go build -ldflags "-X github.com/kuleshov-aleksei/orbital/internal/version.Version=$(VERSION)" -o ../bin/orbital ./cmd/server

# Run development servers
# turn is disabled while migrating to livekit
# (cd docker && turnserver -c turnserver-dev.conf --use-auth-secret --static-auth-secret=pink-goose)
dev:
	@echo "Starting development servers..."
	@echo "Frontend: http://localhost:3000"
	@echo "Backend: http://localhost:8080"
	@echo "LiveKit: http://localhost:7880"
	@echo "Press Ctrl+C to stop all servers"
	@bash -c ' \
		set -a; source "$(PWD)/.env" 2>/dev/null || true; set +a; \
		cd "$(PWD)" && livekit-server --config livekit/livekit-dev.yaml & \
		LIVEKIT_PID=$$!; \
		cd "$(PWD)/frontend" && npm run dev & \
		FRONTEND_PID=$$!; \
		cd "$(PWD)/backend" && go run ./cmd/server & \
		BACKEND_PID=$$!; \
		cleanup() { \
			echo ""; \
			echo "Shutting down..."; \
			kill $$LIVEKIT_PID $$FRONTEND_PID $$BACKEND_PID 2>/dev/null; \
			wait $$LIVEKIT_PID $$FRONTEND_PID $$BACKEND_PID 2>/dev/null; \
			exit 0; \
		}; \
		trap cleanup INT TERM EXIT; \
		wait $$LIVEKIT_PID $$FRONTEND_PID $$BACKEND_PID \
	'

# Generate SSL certificates for HTTPS development
certs:
	@if [ ! -f certs/key.pem ] || [ ! -f certs/cert.pem ]; then \
		echo "Generating SSL certificates..."; \
		mkdir -p certs; \
		openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Orbital/CN=localhost" 2>/dev/null; \
		echo "Certificates generated in certs/"; \
	fi

# Run development servers on all interfaces (for testing on multiple devices)
dev-public: certs
	@echo "Starting development servers on all interfaces with HTTPS..."
	@LOCAL_IP=$$(hostname -I | awk '{print $$1}'); \
	if [ -z "$$LOCAL_IP" ]; then \
		LOCAL_IP=$$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+'); \
	fi; \
	if [ -n "$$LOCAL_IP" ]; then \
		echo "Frontend: https://$$LOCAL_IP:3000"; \
		echo "Backend: http://$$LOCAL_IP:8080"; \
		echo ""; \
		echo "Access from other devices at: https://$$LOCAL_IP:3000"; \
		echo ""; \
		echo "NOTE: You will see a certificate warning - this is expected for self-signed certs."; \
		echo "      Click 'Advanced' -> 'Proceed anyway' to continue."; \
	else \
		echo "Frontend: https://0.0.0.0:3000"; \
		echo "Backend: http://0.0.0.0:8080"; \
	fi
	@echo "Press Ctrl+C to stop all servers"
	@echo ""
	@bash -c ' \
		set -a; source "$(PWD)/.env" 2>/dev/null || true; set +a; \
		cd "$(PWD)" && livekit-server --config livekit/livekit-dev.yaml & \
		LIVEKIT_PID=$$!; \
		cd "$(PWD)/frontend" && VITE_HTTPS=true npm run dev & \
		FRONTEND_PID=$$!; \
		cd "$(PWD)/backend" && go run ./cmd/server & \
		BACKEND_PID=$$!; \
		cleanup() { \
			echo ""; \
			echo "Shutting down..."; \
			kill $$LIVEKIT_PID $$FRONTEND_PID $$BACKEND_PID 2>/dev/null; \
			wait $$LIVEKIT_PID $$FRONTEND_PID $$BACKEND_PID 2>/dev/null; \
			exit 0; \
		}; \
		trap cleanup INT TERM EXIT; \
		wait $$LIVEKIT_PID $$FRONTEND_PID $$BACKEND_PID \
	'

# Run linters
lint:
	@echo "Running frontend linter..."
	cd frontend && npm run lint
	@echo "Running backend linter..."
	cd backend && golangci-lint run

# Run linters on changed files only (faster for pre-commit)
lint-full:
	@echo "Running frontend linter on changed files..."
	cd frontend && npm run lint:full

prettier:
	@echo "Running prettier"
	cd frontend && npm run prettier

# Run tests
test:
	@echo "Running frontend e2e tests..."
	cd frontend && npm run test:e2e
	@echo "Running backend tests..."
	cd backend && go test ./...

# Run tests
test-headed:
	@echo "Running frontend e2e tests..."
	cd frontend && npm run test:e2e:headed

# Generate licenses JSON
licenses:
	@echo "Generating licenses JSON..."
	cd frontend && npm run generate:licenses

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf frontend/dist
	rm -rf frontend/node_modules
	rm -rf backend/bin
	rm -rf bin
	rm -rf certs

# Docker commands
docker-build:
	@echo "Building Docker images with version: $(VERSION)..."
	docker build --build-arg VERSION=$(VERSION) -t orbital-frontend -f docker/Dockerfile.frontend .
	docker build --build-arg VERSION=$(VERSION) -t orbital-backend -f docker/Dockerfile.backend .

docker-up:
	@echo "Starting with Docker Compose (version: $(VERSION))..."
	VERSION=$(VERSION) docker-compose -f docker/docker-compose.yml up

docker-down:
	@echo "Stopping Docker Compose..."
	docker-compose -f docker/docker-compose.yml down

# Run production build locally with nginx (no Docker)
# Requires: build target to be run first, nginx installed
run-built:
	@if [ ! -f bin/orbital ]; then \
		echo "Error: Backend binary not found. Run 'make build' first."; \
		exit 1; \
	fi
	@if [ ! -d frontend/dist ]; then \
		echo "Error: Frontend dist not found. Run 'make build' first."; \
		exit 1; \
	fi
	@echo "Starting production build locally..."
	@echo "App will be available at: http://localhost:3000"
	@echo "Press Ctrl+C to stop"
	@echo ""
	# Generate temporary nginx config with correct paths
	@sed "s|ROOT_PLACEHOLDER|$(PWD)/frontend/dist|g" docker/nginx-local.conf > /tmp/orbital-nginx.conf
	# Ensure nginx can write its logs and PID file
	@mkdir -p /tmp/orbital-logs
	@bash -c ' \
		set -a; source "$(PWD)/.env" 2>/dev/null || true; set +a; \
		cd bin && ./orbital & \
		BACKEND_PID=$$!; \
		sleep 2; \
		nginx -c /tmp/orbital-nginx.conf -g "daemon off;" & \
		NGINX_PID=$$!; \
		cleanup() { \
			echo ""; \
			echo "Shutting down..."; \
			kill $$BACKEND_PID $$NGINX_PID 2>/dev/null; \
			rm -rf /tmp/orbital-nginx.conf /tmp/orbital-nginx.pid /tmp/orbital-logs; \
			wait $$BACKEND_PID $$NGINX_PID 2>/dev/null; \
			exit 0; \
		}; \
		trap cleanup INT TERM EXIT; \
		wait $$BACKEND_PID $$NGINX_PID \
	'

# Electron dev mode (starts backend + LiveKit + Electron)
dev-electron:
	@echo "Starting electron in dev mode..."
	@echo "NOTE: make user backend is running using make dev"
	cd electron && npm run dev

# Electron builds
build-electron:
	@echo "Installing electron dependencies..."
	cd electron && npm install
	@echo "Building electron for Linux..."
	@if [ -z "$$VITE_BACKEND_URL" ]; then \
		echo "WARNING: VITE_BACKEND_URL not set, using https://orb.encamy.com"; \
		cd electron && VITE_BACKEND_URL=https://orb.encamy.com npm run build; \
	else \
		cd electron && VITE_BACKEND_URL=$$VITE_BACKEND_URL npm run build; \
	fi

build-electron-win:
	@echo "Installing electron dependencies..."
	cd electron && npm install
	@echo "Building electron for Windows..."
	@if [ -z "$$VITE_BACKEND_URL" ]; then \
		echo "WARNING: VITE_BACKEND_URL not set, using https://orb.encamy.com"; \
		cd electron && VITE_BACKEND_URL=https://orb.encamy.com npm run build:win; \
	else \
		cd electron && VITE_BACKEND_URL=$$VITE_BACKEND_URL npm run build:win; \
	fi
	@echo "Generating SHA256 hashes for Windows builds..."
	@for f in electron/release/Orbital-Setup-*.exe; do \
		if [ -f "$$f" ]; then \
			echo "Calculating SHA256 for $$f..."; \
			openssl dgst -sha256 -binary "$$f" | openssl base64 -A > "$$f.sha256"; \
			echo "Hash saved to $$f.sha256"; \
		fi; \
	done
	@for f in electron/release/Orbital-*-Portable-*.exe; do \
		if [ -f "$$f" ]; then \
			echo "Calculating SHA256 for $$f..."; \
			openssl dgst -sha256 -binary "$$f" | openssl base64 -A > "$$f.sha256"; \
			echo "Hash saved to $$f.sha256"; \
		fi; \
	done

build-electron-linux:
	@echo "Installing electron dependencies..."
	cd electron && npm install
	@echo "Building electron for Linux..."
	@if [ -z "$$VITE_BACKEND_URL" ]; then \
		echo "WARNING: VITE_BACKEND_URL not set, using https://orb.encamy.com"; \
		cd electron && VITE_BACKEND_URL=https://orb.encamy.com npm run build:linux; \
	else \
		cd electron && VITE_BACKEND_URL=$$VITE_BACKEND_URL npm run build:linux; \
	fi

build-electron-all:
	@echo "Installing electron dependencies..."
	cd electron && npm install
	@echo "Building electron for all platforms..."
	@if [ -z "$$VITE_BACKEND_URL" ]; then \
		echo "WARNING: VITE_BACKEND_URL not set, using https://orb.encamy.com"; \
		cd electron && VITE_BACKEND_URL=https://orb.encamy.com npm run build:all; \
	else \
		cd electron && VITE_BACKEND_URL=$$VITE_BACKEND_URL npm run build:all; \
	fi