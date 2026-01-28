# Development Agents

This document outlines the development guidelines and agent configurations for The Orbital project.

## Project Overview

The Orbital is a voice chat web application for 5-10 people using WebRTC technology.

## Tech Stack

- **Frontend**: Vue 3 + TypeScript + Tailwind CSS
- **Backend**: Go 1.21+
- **Communication**: WebSockets + REST API
- **Deployment**: Docker + Docker Compose

## Development Guidelines

### Frontend Development
- Use Vue 3 Composition API
- Follow TypeScript best practices
- Use Tailwind CSS for styling
- Implement WebRTC using native browser APIs
- Use Pinia for state management

### Backend Development
- Use Go 1.21+ features
- Follow standard Go project layout
- Use gorilla/mux for HTTP routing
- Use gorilla/websocket for WebSocket connections
- Implement proper error handling and logging

### Code Quality
- Run `make lint` before committing
- Use meaningful variable and function names
- Add comments for complex logic
- Follow language-specific conventions

### Testing
- Write unit tests for business logic
- Test WebRTC functionality in browsers
- Test WebSocket connections
- Use integration tests for API endpoints

## Build Commands

The project uses a Makefile for common operations:

- `make install` - Install dependencies
- `make build` - Build frontend and backend
- `make dev` - Start development servers
- `make lint` - Run code quality checks
- `make test` - Run tests
- `make docker-build` - Build Docker images
- `make docker-up` - Run with Docker Compose

## Deployment

- Single binary backend deployment
- Frontend served via nginx
- Docker Compose for local development
- Environment-based configuration

## Architecture Principles

1. **Simplicity First** - Avoid over-engineering
2. **Single Binary** - Backend compiles to one executable
3. **Browser Native** - Use WebRTC without plugins
4. **Clean Code** - Maintainable and readable codebase