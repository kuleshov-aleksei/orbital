# The Orbital

This is the Orbital - simple yet powerfull voice communication platform. It is very similar to discord: Users can create, join to rooms, use webrtc to communicate with each other, share screen

Project designed to be dead simple - no microservices, no clouds. Single binary all what is needed for deploy. Front can be served using additional nginx container

**Mission**: Build a simple, blazingly fast voice call application for 5-10 people using WebRTC and Go.

# Core Principles

1. **Simplicity First** - This is NOT a large-scale application
2. **No Over-Engineering** - Avoid microservices, complex architectures
3. **Browser Native** - Use WebRTC, avoid plugins and complex setups
4. **Single Binary** - The Go backend should compile to one executable
5. **Discord-like UX** - Familiar, clean interface

# Functional requirements

- Users can create voice room
- Users can join/leave voice rooms
- Users can speak and hear other users
- NAT traversal can be done using some 3rd party STUN/TURN services like coturn/coturn
- Deployment should be done using docker (docker-compose)
- Collection of Makefile scripts that:
  - install dependencies for front + backend
  - build front + backend
  - build docker for front + back
  - launch front + backend
  - launches linter for front + backend

# Future requirements

- Persistent rooms
- OAuth using 3rd party services like discord or google
- Users can share their screen
- Users can send messages
- Users can upload attachments (storage in external s3)

# Stack

## Front
- Vue + tailwind + ts
- WebRTC for communication

## Backend
- Go

## Communication front <-> back

- Simple websockets for bidirectional streams
- REST for simple calls
- Signal.io usage is PROHIBITED
