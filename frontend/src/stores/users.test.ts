import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { PublicUser } from "@/types"
import { apiService } from "@/services/api"
import { useUsersStore } from "./users"

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>()
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      updateCustomStatus: vi.fn(),
    },
  }
})

function publicUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: "u1",
    nickname: "Nova",
    role: "user",
    is_online: true,
    created_at: "2025-03-14T12:00:00Z",
    ...overrides,
  }
}

describe("users store custom status", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(apiService.updateCustomStatus).mockReset()
  })

  it("applies broadcast status changes and clears empty ones", () => {
    const store = useUsersStore()
    store.setUsers([publicUser(), publicUser({ id: "u2", nickname: "Bolt" })])

    store.updateUserCustomStatus("u2", "afk")
    expect(store.allUsers.find((u) => u.id === "u2")?.custom_status).toBe("afk")
    expect(store.allUsers.find((u) => u.id === "u1")?.custom_status).toBeUndefined()

    store.updateUserCustomStatus("u2", "", "")
    expect(store.allUsers.find((u) => u.id === "u2")?.custom_status).toBeUndefined()

    store.updateUserCustomStatus("u2", "", "🔥")
    const u2 = store.allUsers.find((u) => u.id === "u2")
    expect(u2?.custom_status).toBeUndefined()
    expect(u2?.custom_status_emoji).toBe("🔥")
  })

  it("stores the server-normalized status after saving", async () => {
    vi.mocked(apiService.updateCustomStatus).mockResolvedValue({
      custom_status: "ranked",
      custom_status_emoji: "🎮",
    })
    const store = useUsersStore()
    store.setUsers([publicUser()])

    await store.setMyCustomStatus("u1", " ranked ", "🎮")

    expect(apiService.updateCustomStatus).toHaveBeenCalledWith(" ranked ", "🎮")
    expect(store.allUsers[0].custom_status).toBe("ranked")
    expect(store.allUsers[0].custom_status_emoji).toBe("🎮")
    expect(store.allUsers[0].created_at).toBe("2025-03-14T12:00:00Z")
  })

  it("names users missing from the loaded list as deleted", () => {
    const store = useUsersStore()
    const deletedId = "qkUrdzLDoqslx8EEy2cM7Q=="
    // Before the list loads nobody is known, which says nothing about deletion.
    expect(store.displayName(deletedId)).toBe("Unknown user")

    store.setUsers([publicUser({ id: "Zm9vYmFyYmF6cXV4MTIzNA==", nickname: "Nova" })])
    expect(store.displayName("Zm9vYmFyYmF6cXV4MTIzNA==")).toBe("Nova")
    expect(store.displayName(deletedId)).toBe("Deleted user")
  })

  it("keeps the old status when saving fails", async () => {
    vi.mocked(apiService.updateCustomStatus).mockRejectedValue(new Error("boom"))
    const store = useUsersStore()
    store.setUsers([publicUser({ custom_status: "old" })])

    await expect(store.setMyCustomStatus("u1", "new")).rejects.toThrow("boom")
    expect(store.allUsers[0].custom_status).toBe("old")
  })
})

describe("users store away status", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const ID = "qkUrdzLDoqslx8EEy2cM7Q=="
  const statusOf = (store: ReturnType<typeof useUsersStore>) =>
    store.allUsers.find((u) => u.id === ID)?.status

  it("sets and clears away, and coming online or offline resets it", () => {
    const store = useUsersStore()
    store.setUsers([publicUser({ id: ID })])

    store.setUserAway(ID, true)
    expect(statusOf(store)).toBe("away")
    store.setUserAway(ID, false)
    expect(statusOf(store)).toBeUndefined()

    store.setUserAway(ID, true)
    store.updateOnlineStatus(ID, false)
    expect(statusOf(store)).toBeUndefined()
  })

  it("keeps away across a REST refetch of the user list", async () => {
    const store = useUsersStore()
    store.setUsers([publicUser({ id: ID })])
    store.setUserAway(ID, true)
    vi.spyOn(apiService, "getAllUsers").mockResolvedValue([publicUser({ id: ID })])
    await store.fetchAllUsers()
    expect(statusOf(store)).toBe("away")
  })
})
