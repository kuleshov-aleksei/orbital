.PHONY: help install build dev dev-public dev-electron lint lint-full check prettier test test-unit test-backend test-integration e2e-textchat meili-up meili-down ml-up ml-down garage-up garage-down test-e2e-docker docker-build-test clean docker-build docker-up certs run-built licenses build-electron build-electron-win build-electron-linux build-win-audiocap build-electron-all build-android-web build-android build-android-dev check-android-jdk dev-android balance-drift balance-check

# Default target
help:
	@echo "Available commands:"
	@echo "  install           - Install dependencies for frontend and backend"
	@echo "  build             - Build frontend and backend"
	@echo "  dev               - Run development servers"
	@echo "  dev-public        - Run development servers on all interfaces (0.0.0.0)"
	@echo "  dev-electron      - Run Electron in development mode (starts backend + LiveKit)"
	@echo "  lint              - Run linters for frontend and backend"
	@echo "  check             - Release quality gate: frontend typecheck + full backend lint"
	@echo "  test              - Run tests (Playwright e2e in Docker)"
	@echo "  test-unit         - Run frontend unit tests (Vitest)"
	@echo "  test-backend      - Run backend Go unit tests (hermetic, what PR CI runs)"
	@echo "  test-integration  - Run backend integration tests against Meilisearch + Garage (starts them)"
	@echo "  e2e-textchat      - Live text channel check on a throwaway backend + index (starts Meilisearch + Garage)"
	@echo "  meili-up          - Start the dev Meilisearch container (text channels)"
	@echo "  meili-down        - Stop the dev Meilisearch container"
	@echo "  ml-up             - Start the dev Immich ML container (search by image contents)"
	@echo "  ml-down           - Stop the dev Immich ML container"
	@echo "  garage-up         - Start the dev Garage S3 container (chat attachments)"
	@echo "  garage-down       - Stop the dev Garage S3 container"
	@echo "  test-e2e-docker   - Run Playwright e2e tests in Docker"
	@echo "  test-headed       - Run tests in headed mode (local browser required)"
	@echo "  docker-build-test - Build the Playwright test Docker image"
	@echo "  clean             - Clean build artifacts"
	@echo "  docker-build      - Build Docker images"
	@echo "  docker-up         - Run with Docker Compose"
	@echo "  run-built         - Run production build locally (nginx + binary, no Docker)"
	@echo "  licenses          - Generate frontend licenses JSON"
	@echo "  build-electron       - Build Electron desktop app"
	@echo "  build-electron-win   - Build Electron for Windows"
	@echo "  build-electron-linux - Build Electron for Linux"
	@echo "  build-win-audiocap   - Cross-compile the Windows audio helper (needs mingw-w64)"
	@echo "  build-android        - Build the Android app (debug APK; needs JDK + Android SDK)"
	@echo "  build-android-dev    - Build \"Orbital Dev\" against this machine's backend (ANDROID_DEV_HOST)"
	@echo "  dev-android          - Run the Android app against a live dev server (CAP_SERVER_URL=http://<lan-ip>:3000)"

# Install dependencies
install:
	@echo "Installing frontend dependencies..."
	cd frontend && pnpm install
	@echo "Installing electron dependencies..."
	cd electron && pnpm install
	@echo "Installing backend dependencies..."
	cd backend && go mod download

# Get version from git tag + commit
VERSION := $(shell ./scripts/version.sh 2>/dev/null || echo "dev-unknown")

# Public update feed baked into the desktop app (override with UPDATE_URL env).
UPDATE_URL ?= https://orbital-updates.encamy.com/

# Dockerized Playwright E2E test runner
PLAYWRIGHT_TEST_IMAGE ?= orbital-playwright-tests
PLAYWRIGHT_TEST_ARGS ?=

# Build everything
build:
	@echo "Building version: $(VERSION)"
	@echo "Building frontend..."
	cd frontend && VITE_APP_VERSION=$(VERSION) pnpm build
	@echo "Building backend..."
	cd backend && go build -ldflags "-X github.com/kuleshov-aleksei/orbital/internal/version.Version=$(VERSION)" -o ../bin/orbital ./cmd/server

# Run development servers
# turn is disabled while migrating to livekit
# (cd docker && turnserver -c turnserver-dev.conf --use-auth-secret --static-auth-secret=pink-goose)
dev:
	@echo "Starting development servers..."
	@echo "Frontend: http://localhost:3000"
	@echo "Backend: http://localhost:8080"
	@echo "Press Ctrl+C to stop all servers"
	@bash -c ' \
		set -a; source "$(PWD)/.env" 2>/dev/null || true; set +a; \
		cd "$(PWD)/frontend" && pnpm dev & \
		FRONTEND_PID=$$!; \
		cd "$(PWD)/backend" && go run ./cmd/server & \
		BACKEND_PID=$$!; \
		cleanup() { \
			echo ""; \
			echo "Shutting down..."; \
			kill $$FRONTEND_PID $$BACKEND_PID 2>/dev/null; \
			wait $$FRONTEND_PID $$BACKEND_PID 2>/dev/null; \
			exit 0; \
		}; \
		trap cleanup INT TERM EXIT; \
		wait $$FRONTEND_PID $$BACKEND_PID \
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
		cd "$(PWD)/frontend" && VITE_HTTPS=true pnpm dev & \
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
	cd frontend && pnpm run lint
	@echo "Running backend linter..."
	cd backend && golangci-lint run

# Release quality gate (same checks the release Dockerfiles run)
check:
	@echo "Running frontend typecheck..."
	cd frontend && pnpm run typecheck
	@echo "Running backend linter..."
	cd backend && golangci-lint run

# Run linters on changed files only (faster for pre-commit)
lint-full:
	@echo "Running frontend linter on changed files..."
	cd frontend && pnpm run lint:full

prettier:
	@echo "Running prettier"
	cd frontend && pnpm run prettier

# Build the Playwright test image
docker-build-test:
	@echo "Building Playwright test image..."
	@docker build --network host --quiet -t $(PLAYWRIGHT_TEST_IMAGE) -f docker/Dockerfile.playwright . >/dev/null

# Run frontend e2e tests inside Docker (starts backend + LiveKit in the container)
test-e2e-docker: docker-build-test
	@PLAYWRIGHT_TEST_IMAGE=$(PLAYWRIGHT_TEST_IMAGE) PLAYWRIGHT_TEST_ARGS="$(PLAYWRIGHT_TEST_ARGS)" bash scripts/run-tests.sh frontend

# Run tests
test: docker-build-test
	@PLAYWRIGHT_TEST_IMAGE=$(PLAYWRIGHT_TEST_IMAGE) PLAYWRIGHT_TEST_ARGS="$(PLAYWRIGHT_TEST_ARGS)" bash scripts/run-tests.sh all

# Run backend unit tests (no external services; integration tests are excluded
# by build tag, see test-integration)
test-backend:
	@echo "Running backend tests..."
	cd backend && go test ./...

# Dev Meilisearch (text channel store, docs/specs/CHAT_SYSTEM.md). The backend's
# development defaults point at it, so `make meili-up && make dev` just works.
MEILI_TEST_URL ?= http://127.0.0.1:7700
MEILI_TEST_KEY ?= $(or $(MEILI_MASTER_KEY),orbital-dev-meili-key)

meili-up:
	docker-compose -f docker-compose.dev.yml up -d meilisearch
	@for i in $$(seq 1 60); do \
		curl -fsS $(MEILI_TEST_URL)/health >/dev/null 2>&1 && echo "Meilisearch is up at $(MEILI_TEST_URL)" && exit 0; \
		sleep 0.5; \
	done; echo "Meilisearch did not become healthy" >&2; exit 1

meili-down:
	docker-compose -f docker-compose.dev.yml stop meilisearch

# Dev Garage S3 (text channel attachments, docs/specs/CHAT_SYSTEM.md §7.12).
# Single-node mode creates the layout, dev key and bucket on first start.
GARAGE_TEST_BUCKET ?= orbital-chat-media

# Dev Immich ML (OCR + CLIP for search by image contents). The first start
# downloads the models (a few GB), so the health wait is long.
ml-up:
	docker-compose -f docker-compose.dev.yml up -d immich-ml
	@for i in $$(seq 1 120); do \
		curl -fsS http://127.0.0.1:3003/ping >/dev/null 2>&1 && echo "Immich ML is up at http://127.0.0.1:3003 (set CHAT_ML_URL to use it)" && exit 0; \
		sleep 1; \
	done; echo "Immich ML did not answer /ping" >&2; exit 1

ml-down:
	docker-compose -f docker-compose.dev.yml stop immich-ml

garage-up:
	docker-compose -f docker-compose.dev.yml up -d garage
	@for i in $$(seq 1 60); do \
		docker exec orbital-garage /garage bucket info $(GARAGE_TEST_BUCKET) >/dev/null 2>&1 && \
			echo "Garage is up at http://127.0.0.1:3900 (bucket $(GARAGE_TEST_BUCKET))" && exit 0; \
		sleep 0.5; \
	done; echo "Garage did not become ready" >&2; exit 1

garage-down:
	docker-compose -f docker-compose.dev.yml stop garage

# Backend integration tests (build tag `integration`), e.g. the Meilisearch
# engine. Not part of PR CI; each test uses its own throwaway index.
test-integration: meili-up garage-up
	@echo "Running backend integration tests..."
	@# The S3 test uses the dev Garage key from .env (skips without it).
	@cd backend && export $$(grep -E '^GARAGE_DEFAULT_(ACCESS_KEY|SECRET_KEY|BUCKET)=' ../.env 2>/dev/null | tr -d '"' | xargs) && \
		MEILI_TEST_URL=$(MEILI_TEST_URL) MEILI_TEST_KEY=$(MEILI_TEST_KEY) \
		go test -count=1 -tags integration -run Integration ./...

# Live text channel check: throwaway backend (own DB + index) driven over
# REST/WS by scripts/e2e-textchat.mjs. Run it after chatstore or text chat
# WebSocket/handler changes; it is not part of PR CI.
e2e-textchat: meili-up garage-up
	@MEILI_URL=$(MEILI_TEST_URL) MEILI_KEY=$(MEILI_TEST_KEY) bash scripts/e2e-textchat.sh

# Run frontend unit tests
test-unit:
	@echo "Running frontend unit tests..."
	cd frontend && pnpm run test:unit

# Run tests
test-headed:
	@echo "Running frontend e2e tests..."
	cd frontend && pnpm run test:e2e:headed

# Generate licenses JSON
licenses:
	@echo "Generating licenses JSON..."
	cd frontend && pnpm run generate:licenses

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
	VERSION=$(VERSION) docker-compose -f docker-compose.dev.yml up -d

docker-down:
	@echo "Stopping Docker Compose..."
	docker-compose -f docker-compose.dev.yml down

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
	cd electron && pnpm dev

# Electron builds
build-electron:
	@echo "Installing electron dependencies..."
	cd electron && pnpm install
	@echo "Building electron for Linux..."
	@if [ -z "$$VITE_BACKEND_URL" ]; then \
		echo "WARNING: VITE_BACKEND_URL not set, using https://orb.encamy.com"; \
		cd electron && VITE_BACKEND_URL=https://orb.encamy.com UPDATE_URL=$(UPDATE_URL) pnpm run build; \
	else \
		cd electron && VITE_BACKEND_URL=$$VITE_BACKEND_URL UPDATE_URL=$(UPDATE_URL) pnpm run build; \
	fi

# Windows per-app audio helper (docs/specs/WINDOWS_APP_AUDIO.md), built with
# mingw-w64 (Debian: g++-mingw-w64-x86-64, Arch: mingw-w64-gcc).
build-win-audiocap:
	$(MAKE) -C native/win-audiocap

build-electron-win: build-win-audiocap
	@echo "Installing electron dependencies..."
	cd electron && pnpm install
	@echo "Building electron for Windows..."
	@if [ -z "$$VITE_BACKEND_URL" ]; then \
		echo "WARNING: VITE_BACKEND_URL not set, using https://orb.encamy.com"; \
		cd electron && VITE_BACKEND_URL=https://orb.encamy.com UPDATE_URL=$(UPDATE_URL) pnpm run build:win; \
	else \
		cd electron && VITE_BACKEND_URL=$$VITE_BACKEND_URL UPDATE_URL=$(UPDATE_URL) pnpm run build:win; \
	fi

build-electron-linux:
	@echo "Installing electron dependencies..."
	cd electron && pnpm install
	@echo "Building electron for Linux..."
	@if [ -z "$$VITE_BACKEND_URL" ]; then \
		echo "WARNING: VITE_BACKEND_URL not set, using https://orb.encamy.com"; \
		cd electron && VITE_BACKEND_URL=https://orb.encamy.com UPDATE_URL=$(UPDATE_URL) pnpm run build:linux; \
	else \
		cd electron && VITE_BACKEND_URL=$$VITE_BACKEND_URL UPDATE_URL=$(UPDATE_URL) pnpm run build:linux; \
	fi

# Halloween balance sims (no new installs — runs through frontend jiti)
balance-drift:
	@echo "Checking balance fixture vs backend Config()..."
	node tools/halloween-balance/check-drift.cjs

balance-check: balance-drift
	@echo "Running heuristic balance gates (200 games)..."
	./frontend/node_modules/.bin/jiti tools/halloween-balance/run.cjs -- --policy heuristic --games 200 --seed 1 --check-gates

balance-systemone:
	@echo "Running systemone decider games (10 games, sequential)..."
	./frontend/node_modules/.bin/jiti tools/halloween-balance/run.cjs -- --policy systemone --games 10 --seed 1 --concurrency 1 --model winnow:e4b --submit

build-electron-all:
	@echo "Installing electron dependencies..."
	cd electron && pnpm install
	@echo "Building electron for all platforms..."
	@if [ -z "$$VITE_BACKEND_URL" ]; then \
		echo "WARNING: VITE_BACKEND_URL not set, using https://orb.encamy.com"; \
		cd electron && VITE_BACKEND_URL=https://orb.encamy.com UPDATE_URL=$(UPDATE_URL) pnpm run build:all; \
	else \
		cd electron && VITE_BACKEND_URL=$$VITE_BACKEND_URL UPDATE_URL=$(UPDATE_URL) pnpm run build:all; \
	fi
# Android app (Capacitor). The web bundle is built with frontend/vite.config.mobile.ts
# into mobile/dist and packaged into the native project at mobile/android.
# Requires a JDK and the Android SDK (ANDROID_HOME) for the Gradle step.
ANDROID_BACKEND_URL ?= https://orb.encamy.com
# Gradle 8.x (pinned by the Capacitor template) cannot run on JDK > 24, so the
# Android build uses its own JDK 21 instead of the system default.
ANDROID_JAVA_HOME ?= /usr/lib/jvm/java-21-openjdk

build-android-web:
	@echo "Building Android web bundle against $(ANDROID_BACKEND_URL) (version $(VERSION))..."
	cd frontend && VITE_BACKEND_URL=$(ANDROID_BACKEND_URL) VITE_APP_VERSION=$(VERSION) pnpm exec vite build --config vite.config.mobile.ts
	cd frontend && VITE_BACKEND_URL=$(ANDROID_BACKEND_URL) pnpm exec cap sync android

check-android-jdk:
	@if [ ! -x "$(ANDROID_JAVA_HOME)/bin/java" ]; then \
		echo "JDK 21 not found at $(ANDROID_JAVA_HOME). Install it (Arch: pacman -S jdk21-openjdk) or pass ANDROID_JAVA_HOME=<path>."; \
		exit 1; \
	fi

build-android: check-android-jdk build-android-web
	cd mobile/android && JAVA_HOME=$(ANDROID_JAVA_HOME) ./gradlew assembleDebug
	@echo "APK: mobile/android/app/build/outputs/apk/debug/app-debug.apk"

# "Orbital Dev" (app.orbital.dev, installs next to the production app) talking to the
# backend on this machine over plain HTTP, e.g. via Headscale. The backend must hand
# out URLs the phone can reach; set these in .env (see AGENTS.md "Mobile"):
#   LIVEKIT_URL=ws://$(ANDROID_DEV_HOST):7880
#   CHAT_MEDIA_S3_PUBLIC_ENDPOINT=http://$(ANDROID_DEV_HOST):3900
#ANDROID_DEV_SCHEMA ?= http
#ANDROID_DEV_HOST ?= 100.111.0.8:8000
ANDROID_DEV_SCHEMA ?= https
ANDROID_DEV_HOST ?= orb-dev.encamy.com

build-android-dev: check-android-jdk
	$(MAKE) build-android-web ANDROID_BACKEND_URL=$(ANDROID_DEV_SCHEMA)://$(ANDROID_DEV_HOST)
	cd mobile/android && JAVA_HOME=$(ANDROID_JAVA_HOME) ./gradlew assembleDebug -PorbitalDev
	@echo "APK: mobile/android/app/build/outputs/apk/debug/app-debug.apk (Orbital Dev -> $(ANDROID_DEV_SCHEMA)://$(ANDROID_DEV_HOST))"

# Live reload on a device: run `make dev-public` (or `make dev`) first, then
#   make dev-android CAP_SERVER_URL=http://192.168.1.10:3000
# The WebView loads the Vite dev server, which proxies /api and /ws to the backend.
dev-android:
	@if [ -z "$(CAP_SERVER_URL)" ]; then echo "Set CAP_SERVER_URL=http://<lan-ip>:3000"; exit 1; fi
	cd frontend && CAP_SERVER_URL=$(CAP_SERVER_URL) pnpm exec cap sync android
	cd frontend && JAVA_HOME=$(ANDROID_JAVA_HOME) CAP_SERVER_URL=$(CAP_SERVER_URL) pnpm exec cap run android
