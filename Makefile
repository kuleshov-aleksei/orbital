.PHONY: help install build dev dev-public lint test clean docker-build docker-up

# Default target
help:
	@echo "Available commands:"
	@echo "  install      - Install dependencies for frontend and backend"
	@echo "  build        - Build frontend and backend"
	@echo "  dev          - Run development servers"
	@echo "  dev-public   - Run development servers on all interfaces (0.0.0.0)"
	@echo "  lint         - Run linters for frontend and backend"
	@echo "  test         - Run tests"
	@echo "  clean        - Clean build artifacts"
	@echo "  docker-build - Build Docker images"
	@echo "  docker-up    - Run with Docker Compose"

# Install dependencies
install:
	@echo "Installing frontend dependencies..."
	cd frontend && npm install
	@echo "Installing backend dependencies..."
	cd backend && go mod download

# Build everything
build:
	@echo "Building frontend..."
	cd frontend && npm run build
	@echo "Building backend..."
	cd backend && go build -o ../bin/orbital ./cmd/server

# Run development servers
dev:
	@echo "Starting development servers..."
	@echo "Frontend: http://localhost:3000"
	@echo "Backend: http://localhost:8080"
	@echo "Press Ctrl+C to stop both servers"
	(cd frontend && npm run dev) & \
	(cd backend && go run ./cmd/server) & \
	wait

# Run development servers on all interfaces (for testing on multiple devices)
dev-public:
	@echo "Starting development servers on all interfaces..."
	@echo "Frontend: http://0.0.0.0:3000"
	@echo "Backend: http://0.0.0.0:8080"
	@LOCAL_IP=$$(hostname -I | awk '{print $$1}'); \
	if [ -z "$$LOCAL_IP" ]; then \
		LOCAL_IP=$$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+'); \
	fi; \
	if [ -n "$$LOCAL_IP" ]; then \
		echo "Access from other devices at: http://$$LOCAL_IP:3000"; \
	else \
		echo "Access from other devices using your machine's IP address"; \
	fi
	@echo "Press Ctrl+C to stop both servers"
	(cd frontend && npm run dev -- --host 0.0.0.0) & \
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
	@echo "Running frontend tests..."
	cd frontend && npm run test
	@echo "Running backend tests..."
	cd backend && go test ./...

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf frontend/dist
	rm -rf frontend/node_modules
	rm -rf backend/bin
	rm -rf bin

# Docker commands
docker-build:
	@echo "Building Docker images..."
	docker build -t orbital-frontend -f docker/Dockerfile.frontend .
	docker build -t orbital-backend -f docker/Dockerfile.backend .

docker-up:
	@echo "Starting with Docker Compose..."
	docker-compose -f docker/docker-compose.yml up

docker-down:
	@echo "Stopping Docker Compose..."
	docker-compose -f docker/docker-compose.yml down