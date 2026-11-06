import { beforeEach, describe, expect, it } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { nextTick } from "vue"
import { useCallStore } from "./call"

beforeEach(() => {
  setActivePinia(createPinia())
})

describe("deafen / mute invariants", () => {
  it("auto-mutes on deafen and restores the previous unmuted state on undeafen", () => {
    const call = useCallStore()

    call.setDeafened(true)
    expect(call.isDeafened).toBe(true)
    expect(call.isMuted).toBe(true)

    call.setDeafened(false)
    expect(call.isDeafened).toBe(false)
    expect(call.isMuted).toBe(false)
  })

  it("keeps a manual mute across deafen → undeafen", () => {
    const call = useCallStore()

    call.setMuted(true)
    call.setDeafened(true)
    call.setDeafened(false)

    expect(call.isDeafened).toBe(false)
    expect(call.isMuted).toBe(true)
  })

  it("unmuting while deafened also undeafens", () => {
    const call = useCallStore()

    call.setDeafened(true)
    call.setMuted(false)

    expect(call.isMuted).toBe(false)
    expect(call.isDeafened).toBe(false)
  })
})

describe("preferences", () => {
  it("persists mute and deafen state and reloads it", async () => {
    const call = useCallStore()
    call.setMuted(true)
    call.setDeafened(true)
    await nextTick()

    expect(localStorage.getItem("orbital_mic_muted")).toBe("true")
    expect(localStorage.getItem("orbital_deafened")).toBe("true")

    setActivePinia(createPinia())
    const reloaded = useCallStore()
    expect(reloaded.isMuted).toBe(true)
    expect(reloaded.isDeafened).toBe(true)
  })

  it("resetCallState clears live state and persisted preferences", async () => {
    const call = useCallStore()
    call.setMuted(true)
    call.setDeafened(true)
    call.setCameraEnabled(true)
    call.setScreenSharing(true)
    call.setWatchingUsers(new Set(["u2"]))
    await nextTick()

    call.resetCallState()
    await nextTick()

    expect(call.isMuted).toBe(false)
    expect(call.isDeafened).toBe(false)
    expect(call.isCameraEnabled).toBe(false)
    expect(call.isScreenSharing).toBe(false)
    expect(call.watchingUserIds.size).toBe(0)
    expect(localStorage.getItem("orbital_mic_muted")).toBe("false")
    expect(localStorage.getItem("orbital_deafened")).toBe("false")
  })
})
