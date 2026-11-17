---
name: orbital-livekit-connection
description: Use when changing or debugging LiveKit join/reconnect, mute/deafen, audio processors, screen share, camera, or presence in Orbital. Points to the composable boundaries and the established reconnect/audio recovery design.
---

# Orbital LiveKit Connection

## When to use

- Connection drops, reconnect loops, stale room state, or mute/deafen defects.
- Audio processor, track lifecycle, screen share, camera, or presence issues.
- Any change to `useLiveKit*` behavior.

## Orient

- Read the composables before editing: `useLiveKit.ts` is the composition root; connection, events, state, audio, screen share, camera, and supervisor are split out.
- Read the LiveKit SDK docs via Context7 before inspecting `node_modules`.
- Determine whether the issue is signaling, media, backend presence, or UI state.

## Workflow

1. Identify the owning composable and the event/state transition involved.
2. Extend the existing reconnect policy/supervisor design; do not add ad-hoc retry timers.
3. Preserve the audio recovery path: ended tracks must be recreated before rejoining.
4. Keep cleanup symmetrical on leave/unmount (room, tracks, screen share, supervisor).
5. Verify with the blackout script and user-driven browser/Electron testing.

## Presence (sidebar mute/deafen/screen share/camera)

- The backend room member is the single source of truth. The sidebar (`RoomCard.vue`) renders only `room.users[]`, which is fed by backend `user_media_state` / `media_states` broadcasts and room-list fetches.
- `usePresenceBroadcast.ts` (wired once in `useLiveKit()`) sends the full snapshot via `wsService.sendMediaState` on any change. Screen share/camera come from `useLiveKitState` (`state.isScreenSharing` / `state.isCameraEnabled`, set by `LocalTrackPublished`/`LocalTrackUnpublished`), NOT `callStore` button intent.
- Snapshots go over the room WebSocket (ordered after `join_room`); while it is not open the latest snapshot is stored and replayed inside `join_room.media_state` on reconnect.
- `presence.ts` forwards only `is_speaking` to the room store. Do not add another writer of media flags to `roomStore.updateUserStatus`.

## Guardrails

- Do not rely on internal SDK fields without guarding them.
- Do not reset supervisor/reconnect state during forced recovery.
- Do not create temporary test infrastructure; pause and ask the user to verify when needed.
- Do not treat web and Electron screenshare/audio behavior as identical.

## References

- `frontend/src/composables/useLiveKit*.ts`
- `frontend/src/services/livekit-audio-processors.ts`, `frontend/src/services/audio/`
- `frontend/src/stores/call.ts`, `frontend/src/stores/presence.ts`
- `frontend/src/composables/usePresenceBroadcast.ts`, `backend/internal/websocket/hub.go` (`applyMediaState`)
- `scripts/simulate-blackout.sh`
