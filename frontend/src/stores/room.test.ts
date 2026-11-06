import { beforeEach, describe, expect, it } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { Room, RoomPreviewUser, User } from "@/types"
import { useRoomStore } from "./room"

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: "room-1",
    name: "Room 1",
    user_count: 0,
    max_users: 10,
    type: "voice",
    category: "cat-a",
    sort_order: 0,
    world: "",
    ...overrides,
  }
}

function makeUser(id: string, overrides: Partial<User> = {}): User {
  return {
    id,
    nickname: `User ${id}`,
    status: "online",
    auth_provider: "guest",
    is_guest: true,
    role: "guest",
    ...overrides,
  }
}

function makePreviewUser(id: string, overrides: Partial<RoomPreviewUser> = {}): RoomPreviewUser {
  return {
    id,
    nickname: `User ${id}`,
    role: "guest",
    is_muted: false,
    is_deafened: false,
    is_speaking: false,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe("user volume preferences", () => {
  it("clamps volumes to 0–200 and reloads them from storage", () => {
    const room = useRoomStore()

    room.setUserVolume("loud", 500)
    room.setUserVolume("quiet", -20)
    room.setUserVolume("normal", 55)

    expect(room.getUserVolume("loud")).toBe(200)
    expect(room.getUserVolume("quiet")).toBe(0)
    expect(JSON.parse(localStorage.getItem("orbital_user_volumes")!)).toEqual({
      loud: 200,
      quiet: 0,
      normal: 55,
    })

    setActivePinia(createPinia())
    const reloaded = useRoomStore()
    reloaded.loadUserVolumes()

    expect(reloaded.getUserVolume("normal")).toBe(55)
    expect(reloaded.getUserVolume("unknown")).toBe(80)
  })
})

describe("user status syncing", () => {
  it("merges only the provided flags and mirrors them into currentRoomUsers", () => {
    const room = useRoomStore()
    room.setRooms([makeRoom({ users: [makePreviewUser("u1")], user_count: 1 })])
    room.setActiveRoom("room-1")
    room.setCurrentRoomUsers([makeUser("u1")])

    room.updateUserStatus("u1", { is_speaking: true, is_muted: true })

    expect(room.rooms[0].users?.[0]).toMatchObject({
      is_speaking: true,
      is_muted: true,
      is_deafened: false,
    })
    expect(room.currentRoomUsers[0]).toMatchObject({ is_speaking: true, is_muted: true })
  })

  it("tracks screen share and camera flags", () => {
    const room = useRoomStore()
    room.setRooms([makeRoom({ users: [makePreviewUser("u1")], user_count: 1 })])

    room.updateUserStatus("u1", { is_screen_sharing: true, is_camera_enabled: true })
    expect(room.rooms[0].users?.[0]).toMatchObject({
      is_screen_sharing: true,
      is_camera_enabled: true,
    })

    room.updateUserStatus("u1", { is_camera_enabled: false })
    expect(room.rooms[0].users?.[0]).toMatchObject({
      is_screen_sharing: true,
      is_camera_enabled: false,
    })
  })

  it("only patches the given room when roomId is passed", () => {
    const room = useRoomStore()
    room.setRooms([
      makeRoom({ id: "r1", users: [makePreviewUser("u1")], user_count: 1 }),
      makeRoom({ id: "r2", users: [makePreviewUser("u1")], user_count: 1 }),
    ])

    room.updateUserStatus("u1", { is_muted: true }, "r2")

    expect(room.rooms[0].users?.[0].is_muted).toBe(false)
    expect(room.rooms[1].users?.[0].is_muted).toBe(true)
  })

  it("keeps user_count in sync when users are added and removed", () => {
    const room = useRoomStore()
    room.addRoom(makeRoom({ users: [], user_count: 0 }))

    room.addUserToRoom("room-1", makeUser("u1"))
    expect(room.rooms[0].user_count).toBe(1)
    expect(room.rooms[0].users?.[0]).toMatchObject({
      is_muted: false,
      is_deafened: false,
      is_speaking: false,
    })

    // Duplicate joins must not inflate the count.
    room.addUserToRoom("room-1", makeUser("u1"))
    expect(room.rooms[0].user_count).toBe(1)

    room.removeUserFromRoom("room-1", "u1")
    expect(room.rooms[0].user_count).toBe(0)
    expect(room.rooms[0].users).toHaveLength(0)
  })
})

describe("moving rooms between categories", () => {
  it("places the room after the target category's last room and reports the old category", () => {
    const room = useRoomStore()
    room.setRooms([
      makeRoom({ id: "r1", category: "cat-a", sort_order: 1 }),
      makeRoom({ id: "r2", category: "cat-b", sort_order: 5 }),
      makeRoom({ id: "r3", category: "cat-b", sort_order: 2 }),
    ])

    const result = room.moveRoomToCategory("r1", "cat-b")

    expect(result?.oldCategory).toBe("cat-a")
    expect(result?.room.id).toBe("r1")
    const moved = room.rooms.find((candidate) => candidate.id === "r1")!
    expect(moved.category).toBe("cat-b")
    expect(moved.sort_order).toBe(6)

    expect(room.moveRoomToCategory("missing", "cat-b")).toBeNull()
  })
})
