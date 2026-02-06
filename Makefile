.PHONY: help install build dev dev-public lint test clean docker-build docker-up certs

# Default target
help:
	@echo "Available commands:"
	@echo "  install      - Install dependencies for frontend and backend"
	@echo "  build        - Build frontend and backend"
	@echo "  dev          - Run development servers"
	@echo "  dev-public   - Run development servers on all interfaces (0.0.0.0)"
	@echo "  lint         - Run linters for frontend and backend"
	@echo "  test         - Run tests"
	@echo "  test-headed  - Run tests in headed mode"
	@echo "  clean        - Clean build artifacts"
	@echo "  docker-build - Build Docker images"
	@echo "  docker-up    - Run with Docker Compose"

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
dev:
	@echo "Starting development servers..."
	@echo "Frontend: http://localhost:3000"
	@echo "Backend: http://localhost:8080"
	@echo "Press Ctrl+C to stop both servers"
	(cd frontend && npm run dev) & \
	(cd backend && go run ./cmd/server) & \
	(cd docker && turnserver -c turnserver-dev.conf --use-auth-secret --static-auth-secret=pink-goose)
	wait

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
	@echo "Press Ctrl+C to stop both servers"
	@echo ""
	(cd frontend && VITE_HTTPS=true npm run dev) & \
	(cd backend && go run ./cmd/server) & \
	wait

# Run linters
lint:
	@echo "Running frontend linter..."
	cd frontend && npm run lint
	@echo "Running backend linter..."
	cd backend && golangci-lint run

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