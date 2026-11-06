import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { User } from "@/types"
import { useCallStore } from "@/stores/call"
import { useRoomStore } from "@/stores/room"
import { useMuteDeafenToggle } from "./useMuteDeafenToggle"

const sounds = vi.hoisted(() => ({
  playMute: vi.fn(),
  playUnmute: vi.fn(),
  playDeafen: vi.fn(),
  playUndeafen: vi.fn(),
}))

vi.mock("@/services/sounds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/sounds")>()
  return { ...actual, useSounds: () => sounds }
})

// The real call/room stores are under test; only the barrel is narrowed so the
// composable does not drag in LiveKit/presence just to read a user id.
vi.mock("@/stores", async () => {
  const { useCallStore: useCall } =
    await vi.importActual<typeof import("@/stores/call")>("@/stores/call")
  const { useRoomStore: useRoom } =
    await vi.importActual<typeof import("@/stores/room")>("@/stores/room")
  return {
    useCallStore: useCall,
    useRoomStore: useRoom,
    useUserStore: () => ({ userId: "u1" }),
  }
})

function makeUser(id: string): User {
  return {
    id,
    nickname: `User ${id}`,
    status: "online",
    auth_provider: "guest",
    is_guest: true,
    role: "guest",
    is_muted: false,
    is_deafened: false,
    is_speaking: false,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  const room = useRoomStore()
  room.setActiveRoom("room-1")
  room.setCurrentRoomUsers([makeUser("u1")])
})

describe("toggleMute", () => {
  it("mutes locally, plays the mute sound, and updates the local room entry", () => {
    const call = useCallStore()
    const room = useRoomStore()
    const { toggleMute } = useMuteDeafenToggle()

    toggleMute()

    expect(call.isMuted).toBe(true)
    expect(sounds.playMute).toHaveBeenCalledTimes(1)
    expect(room.currentRoomUsers[0]).toMatchObject({ is_muted: true, is_deafened: false })
  })

  it("unmuting while deafened undeafens with a single undeafen sound", () => {
    const call = useCallStore()
    const { toggleMute } = useMuteDeafenToggle()
    call.setDeafened(true)
    sounds.playMute.mockClear()
    sounds.playUndeafen.mockClear()

    toggleMute()

    expect(call.isMuted).toBe(false)
    expect(call.isDeafened).toBe(false)
    expect(sounds.playUndeafen).toHaveBeenCalledTimes(1)
    expect(sounds.playUnmute).not.toHaveBeenCalled()
  })
})

describe("toggleDeafen", () => {
  it("auto-mutes, plays the deafen sound, and syncs both stores", () => {
    const call = useCallStore()
    const room = useRoomStore()
    const { toggleDeafen } = useMuteDeafenToggle()

    toggleDeafen()

    expect(call.isDeafened).toBe(true)
    expect(call.isMuted).toBe(true)
    expect(sounds.playDeafen).toHaveBeenCalledTimes(1)
    expect(room.currentRoomUsers[0]).toMatchObject({ is_deafened: true, is_muted: true })
  })
})
