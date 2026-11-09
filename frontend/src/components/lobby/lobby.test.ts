import { describe, expect, it } from "vitest"
import type { PublicUser, Room, RoomPreviewUser } from "@/types"
import { inVoiceUserIds, onlineIdleUsers, partitionRooms } from "./lobby"

function makeRoom(id: string, userIds: string[] = []): Room {
  return {
    id,
    name: `Room ${id}`,
    user_count: userIds.length,
    max_users: 10,
    type: "voice",
    category: "cat-a",
    sort_order: 0,
    world: "",
    users: userIds.map((uid): RoomPreviewUser => ({
      id: uid,
      nickname: uid,
      role: "user",
      is_muted: false,
      is_deafened: false,
      is_speaking: false,
    })),
  }
}

function makeUser(id: string, isOnline: boolean): PublicUser {
  return { id, nickname: id, role: "user", is_online: isOnline }
}

describe("lobby helpers", () => {
  it("splits rooms into active (busiest first) and idle", () => {
    const rooms = [makeRoom("a"), makeRoom("b", ["u1"]), makeRoom("c", ["u2", "u3"])]
    const { active, idle } = partitionRooms(rooms)
    expect(active.map((r) => r.id)).toEqual(["c", "b"])
    expect(idle.map((r) => r.id)).toEqual(["a"])
  })

  it("lists online users that are not in voice, excluding self", () => {
    const rooms = [makeRoom("a", ["u1"])]
    const users = [
      makeUser("u1", true), // in voice
      makeUser("u2", true), // idle online
      makeUser("u3", false), // offline
      makeUser("me", true), // self
    ]
    const result = onlineIdleUsers(users, inVoiceUserIds(rooms), "me")
    expect(result.map((u) => u.id)).toEqual(["u2"])
  })
})
