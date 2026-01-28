# Backend Implementation Issues

This document tracks backend features and API endpoints that need to be implemented for The Orbital voice chat application.

## Core Features

### Room Management
- [x] POST /api/rooms - Create new voice room
- [x] GET /api/rooms - List available rooms
- [x] GET /api/rooms/{id} - Get room details
- [ ] DELETE /api/rooms/{id} - Delete room (owner only)
- [ ] PUT /api/rooms/{id} - Update room settings

### User Management
- [x] POST /api/users - Create/generate user identity (via join room)
- [ ] GET /api/users/{id} - Get user profile
- [ ] PUT /api/users/{id} - Update user status/nickname
- [x] GET /api/rooms/{id}/users - List users in room

### WebSocket Signaling
- [x] WebSocket /ws/{roomId} - Real-time signaling for WebRTC
- [x] Handle room join/leave events
- [x] Relay ICE candidates between peers
- [x] Relay SDP offers/answers
- [x] Handle user speaking status updates
- [ ] Handle screen sharing start/stop

### WebRTC Support
- [ ] STUN/TURN server configuration
- [ ] NAT traversal support
- [ ] Connection quality monitoring
- [ ] Fallback connection handling

## Future Features (Phase 2)

### Authentication
- [ ] OAuth integration (Discord, Google)
- [ ] User session management
- [ ] Persistent user profiles
- [ ] Room ownership and permissions

### Persistent Storage
- [ ] Room persistence across restarts
- [ ] User preferences storage
- [ ] Room history/statistics
- [ ] Banned user management

### Advanced Features
- [ ] Screen sharing signaling
- [ ] Text messaging in rooms
- [ ] File attachment support
- [ ] Voice activity detection
- [ ] Noise suppression settings
- [ ] Recording capabilities

### Admin/Management
- [ ] Admin dashboard endpoints
- [ ] Server statistics API
- [ ] Room moderation tools
- [ ] User management interface

## Technical Requirements

### Performance
- [x] Handle 5-10 users per room efficiently
- [x] Low latency signaling (<100ms)
- [x] Concurrent room support
- [ ] Memory usage optimization

### Security
- [x] Input validation for all endpoints
- [ ] Rate limiting on API calls
- [ ] WebSocket authentication
- [x] CORS configuration
- [x] Room access control

### Monitoring
- [x] Health check endpoint
- [ ] Metrics collection
- [x] Error logging
- [ ] Performance monitoring
- [x] Connection status tracking

## Database Schema (Future)

### Rooms Table
- id (UUID)
- name (string)
- owner_id (UUID)
- max_users (int, default 10)
- created_at (timestamp)
- settings (JSON)

### Users Table
- id (UUID)
- nickname (string)
- status (enum: online, away, dnd)
- created_at (timestamp)
- last_seen (timestamp)

### Room_Members Table
- room_id (UUID)
- user_id (UUID)
- joined_at (timestamp)
- role (enum: member, admin, owner)
- is_speaking (boolean)
- is_muted (boolean)

## API Response Formats

### Room Response
```json
{
  "id": "uuid",
  "name": "Room Name",
  "user_count": 3,
  "max_users": 10,
  "created_at": "2024-01-01T00:00:00Z"
}
```

### User Response
```json
{
  "id": "uuid",
  "nickname": "Username",
  "status": "online",
  "is_speaking": false,
  "is_muted": false
}
```

### WebSocket Message Types
- `join_room` - User joins room
- `leave_room` - User leaves room
- `ice_candidate` - WebRTC ICE candidate
- `sdp_offer` - WebRTC SDP offer
- `sdp_answer` - WebRTC SDP answer
- `speaking_status` - User speaking status
- `screen_share_start` - Screen sharing begins
- `screen_share_stop` - Screen sharing ends