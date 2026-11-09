import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { User } from "@/types"
import { apiService, clearAuthToken } from "@/services/api"
import { useUserStore, type UserSession } from "./user"

// Only the network-facing method is faked; token storage stays real so the
// tests cover the same localStorage keys the app relies on.
vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>()
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      getCurrentUser: vi.fn(),
    },
  }
})

function session(overrides: Partial<UserSession> = {}): UserSession {
  return {
    id: "u1",
    nickname: "Nova",
    authProvider: "password",
    isGuest: false,
    role: "user",
    ...overrides,
  }
}

function storedSession(): void {
  localStorage.setItem("orbital_auth_token", "stored-token")
  localStorage.setItem("orbital_user_id", "u1")
  localStorage.setItem("orbital_user_nickname", "Stored")
  localStorage.setItem("orbital_user_auth_provider", "password")
  localStorage.setItem("orbital_user_is_guest", "false")
  localStorage.setItem("orbital_user_role", "user")
}

beforeEach(() => {
  setActivePinia(createPinia())
  clearAuthToken()
  vi.mocked(apiService.getCurrentUser).mockReset()
})

describe("setUser", () => {
  it("rejects incomplete sessions and persists valid ones", () => {
    const user = useUserStore()

    expect(() => user.setUser(session({ id: "" }))).toThrow(/missing required fields/)

    user.setUser(session(), "token-1", "2030-01-01T00:00:00.000Z")

    expect(user.currentUser?.nickname).toBe("Nova")
    expect(user.isAuthenticated).toBe(true)
    expect(localStorage.getItem("orbital_user_id")).toBe("u1")
    expect(localStorage.getItem("orbital_user_nickname")).toBe("Nova")
    expect(localStorage.getItem("orbital_auth_token")).toBe("token-1")
    expect(localStorage.getItem("orbital_token_expires_at")).toBe("2030-01-01T00:00:00.000Z")
  })
})

describe("role derivation", () => {
  it("maps backend roles to owner / guest flags", () => {
    const user = useUserStore()

    user.setUser(session({ role: "super_admin" }))
    expect(user.isSuperAdmin).toBe(true)
    expect(user.isGuest).toBe(false)
    expect(user.isLoggedIn).toBe(true)

    user.setUser(session({ authProvider: "guest", isGuest: true, role: "guest" }))
    expect(user.isGuest).toBe(true)
    expect(user.isLoggedIn).toBe(false)
    expect(user.isSuperAdmin).toBe(false)
  })
})

describe("loadUserFromStorage", () => {
  it("returns null when there is no stored session", async () => {
    const user = useUserStore()

    await expect(user.loadUserFromStorage()).resolves.toBeNull()
    expect(apiService.getCurrentUser).not.toHaveBeenCalled()
  })

  it("refreshes the stored session from the server", async () => {
    storedSession()
    vi.mocked(apiService.getCurrentUser).mockResolvedValue({
      id: "u1",
      nickname: "Fresh Name",
      email: "fresh@example.com",
      avatar_url: "https://cdn.example.com/avatar.png",
      role: "super_admin",
      sound_pack: "minecraft",
    } as unknown as User)

    const user = useUserStore()
    const loaded = await user.loadUserFromStorage()

    expect(loaded?.nickname).toBe("Fresh Name")
    expect(user.currentUser?.nickname).toBe("Fresh Name")
    expect(user.isSuperAdmin).toBe(true)
    expect(localStorage.getItem("orbital_user_role")).toBe("super_admin")
  })

  it("drops an expired session but keeps it through a transient failure", async () => {
    storedSession()
    vi.mocked(apiService.getCurrentUser).mockRejectedValueOnce(
      Object.assign(new Error("expired"), { status: 401 }),
    )
    const expired = useUserStore()
    await expect(expired.loadUserFromStorage()).resolves.toBeNull()

    setActivePinia(createPinia())
    vi.mocked(apiService.getCurrentUser).mockRejectedValueOnce(
      Object.assign(new Error("backend down"), { status: 503 }),
    )
    const offline = useUserStore()
    const kept = await offline.loadUserFromStorage()

    expect(kept?.id).toBe("u1")
    expect(offline.currentUser?.nickname).toBe("Stored")
  })
})

describe("handleSessionExpired", () => {
  it("clears local auth state and flags the expiry for the auth view", () => {
    const user = useUserStore()
    user.setUser(session(), "token-1")

    user.handleSessionExpired()

    expect(user.sessionExpired).toBe(true)
    expect(user.currentUser).toBeNull()
    expect(localStorage.getItem("orbital_auth_token")).toBeNull()
    expect(localStorage.getItem("orbital_user_id")).toBeNull()
  })
})
