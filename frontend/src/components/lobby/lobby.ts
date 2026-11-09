import type { PublicUser, Room } from "@/types"

export interface LobbyRooms {
  /** Rooms with at least one participant, busiest first. */
  active: Room[]
  /** Empty rooms, in their original order. */
  idle: Room[]
}

function occupancy(room: Room): number {
  return room.users?.length ?? room.user_count ?? 0
}

export function partitionRooms(rooms: readonly Room[]): LobbyRooms {
  const active: Room[] = []
  const idle: Room[] = []
  for (const room of rooms) {
    if (occupancy(room) > 0) active.push(room)
    else idle.push(room)
  }
  active.sort((a, b) => occupancy(b) - occupancy(a) || a.name.localeCompare(b.name))
  return { active, idle }
}

/** IDs of everyone currently connected to any room. */
export function inVoiceUserIds(rooms: readonly Room[]): Set<string> {
  const ids = new Set<string>()
  for (const room of rooms) {
    for (const user of room.users ?? []) ids.add(user.id)
  }
  return ids
}

/** Online users that are not in any room, excluding the current user. */
export function onlineIdleUsers(
  users: readonly PublicUser[],
  inVoice: ReadonlySet<string>,
  selfId: string,
): PublicUser[] {
  return users.filter((u) => u.is_online && u.id !== selfId && !inVoice.has(u.id))
}
