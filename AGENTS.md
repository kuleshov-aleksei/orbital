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

## 📋 Documentation Updates

### Project Status Tracking

**IMPORTANT**: All agents must update project documentation in `ISSUES.md` after completing any significant feature or milestone. This ensures accurate project tracking and status visibility.
IT IS PROHIBITED TO MODIFY SECTION "Current bugs". Leave it unchanged

#### Update Requirements:
1. **Immediately after completing** any major feature
2. **Mark completed tasks** with `[x]`
3. **Add new sections** for unexpected features or deviations

#### Feature Completion Updates:
- Change `[ ]` to `[x]` for completed tasks
- Add "✅ COMPLETE" to step headers
- Update timeline from "Timeline: X days" to "✅ COMPLETE"
- Add "Implementation Highlights" section with:
  - Key technical achievements
  - Performance improvements
  - Code organization benefits
  - New capabilities enabled

#### Documentation Quality Standards:
- Maintain consistent formatting and emoji usage
- Use present tense for completed features
- Include specific files created/modified
- Reference any new services or components
- Note any architectural decisions made

#### Tasks:
- [x] **Task 1**: Description
- [x] **Task 2**: Description
- [x] **Task 3**: Description

#### ✅ Implementation Highlights:
- **Key achievement**: Technical description
- **Performance benefit**: Measurable improvement
- **Code organization**: Architecture enhancement
```

#### Failure to Update:
- Project status will become inaccurate
- Future agents may work on completed features
- Progress tracking becomes unreliable
- Stakeholders lose visibility into actual progress

**This documentation update process is MANDATORY for all agents working on The Orbital project.**