import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import { apiService } from "@/services/api"
import { Permission, type MyPermissions, type Role } from "@/types/permissions"
import { usePermissionsStore } from "./permissions"
import { useUserStore } from "./user"

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>()
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      getMyPermissions: vi.fn(),
      getRoles: vi.fn(),
      setUserRoles: vi.fn(),
      setMyColorRole: vi.fn(),
    },
  }
})

const role = (id: string, position: number, overrides: Partial<Role> = {}): Role => ({
  id,
  name: id,
  color: "",
  position,
  permissions: 0,
  deny_permissions: 0,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
})

const mine = (overrides: Partial<MyPermissions> = {}): MyPermissions => ({
  is_owner: false,
  server: Permission.ViewRoom | Permission.Connect,
  rooms: {
    open: Permission.ViewRoom | Permission.Connect | Permission.Screenshare,
    locked: Permission.ViewRoom,
  },
  categories: { general: 0, vip: Permission.ManageRooms },
  role_ids: ["mod"],
  top_position: 2,
  ...overrides,
})

describe("permissions store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(apiService.getMyPermissions).mockReset()
    vi.mocked(apiService.getRoles).mockReset()
  })

  it("checks server, room and category scopes", async () => {
    vi.mocked(apiService.getMyPermissions).mockResolvedValue(mine())
    vi.mocked(apiService.getRoles).mockResolvedValue({ roles: [], user_roles: {} })
    const store = usePermissionsStore()
    await store.refresh()

    expect(store.can(Permission.Connect)).toBe(true)
    expect(store.can(Permission.ManageRooms)).toBe(false)
    expect(store.can(Permission.Screenshare, { roomId: "open" })).toBe(true)
    expect(store.can(Permission.Connect, { roomId: "locked" })).toBe(false)
    expect(store.can(Permission.ViewRoom, { roomId: "unknown" })).toBe(false)
    expect(store.can(Permission.ManageRooms, { categoryId: "vip" })).toBe(true)
    expect(store.canManageAnyRooms).toBe(true)
  })

  it("lets the owner do everything", async () => {
    vi.mocked(apiService.getMyPermissions).mockResolvedValue(
      mine({ is_owner: true, server: 0, rooms: {} }),
    )
    vi.mocked(apiService.getRoles).mockResolvedValue({ roles: [], user_roles: {} })
    const store = usePermissionsStore()
    await store.refresh()

    expect(store.can(Permission.Administrator)).toBe(true)
    expect(store.can(Permission.Screenshare, { roomId: "anything" })).toBe(true)
    expect(store.canTarget("someone", false)).toBe(true)
    expect(store.canTarget("other-owner", true)).toBe(false)
  })

  it("mirrors role hierarchy for targeting and role management", async () => {
    useUserStore().setUser({
      id: "me",
      nickname: "Me",
      authProvider: "password",
      isGuest: false,
      role: "user",
    })
    vi.mocked(apiService.getMyPermissions).mockResolvedValue(
      mine({ server: Permission.ManageRoles, top_position: 2 }),
    )
    vi.mocked(apiService.getRoles).mockResolvedValue({
      roles: [
        role("high", 3),
        role("mod", 2),
        role("low", 1),
        role("everyone", 0, { system_key: "everyone" }),
      ],
      user_roles: { me: ["mod"], peer: ["mod"], junior: ["low"], boss: ["high"] },
    })
    const store = usePermissionsStore()
    await store.refresh()

    expect(store.canTarget("junior", false)).toBe(true)
    expect(store.canTarget("peer", false)).toBe(false)
    expect(store.canTarget("boss", false)).toBe(false)
    expect(store.canTarget("me", false)).toBe(false)

    const byId = (id: string) => store.roles.find((r) => r.id === id)!
    expect(store.canManageRole(byId("low"))).toBe(true)
    expect(store.canManageRole(byId("mod"))).toBe(false)
    expect(store.canManageRole(byId("everyone"))).toBe(true)
    expect(store.customRoles.map((r) => r.id)).toEqual(["high", "mod", "low"])
  })

  it("toggles a user's role and applies the server's answer", async () => {
    vi.mocked(apiService.getMyPermissions).mockResolvedValue(mine({ is_owner: true }))
    vi.mocked(apiService.getRoles).mockResolvedValue({
      roles: [role("mod", 2), role("low", 1)],
      user_roles: { peer: ["low"] },
    })
    const store = usePermissionsStore()
    await store.refresh()

    vi.mocked(apiService.setUserRoles).mockResolvedValue({
      user_id: "peer",
      role_ids: ["low", "mod"],
    })
    await store.toggleUserRole("peer", "mod")
    expect(apiService.setUserRoles).toHaveBeenLastCalledWith("peer", ["low", "mod"])
    expect(store.rolesOf("peer").map((r) => r.id)).toEqual(["mod", "low"])

    vi.mocked(apiService.setUserRoles).mockResolvedValue({ user_id: "peer", role_ids: ["mod"] })
    await store.toggleUserRole("peer", "low")
    expect(apiService.setUserRoles).toHaveBeenLastCalledWith("peer", ["mod"])
    expect(store.roleIdsOf("peer")).toEqual(["mod"])

    // The owner may edit their own roles too.
    expect(store.canEditRolesOf(false)).toBe(true)
    expect(store.canEditRolesOf(true)).toBe(true)
  })

  it("keeps the owner's roles locked for non-owners", async () => {
    vi.mocked(apiService.getMyPermissions).mockResolvedValue(
      mine({ server: Permission.ManageRoles }),
    )
    vi.mocked(apiService.getRoles).mockResolvedValue({ roles: [], user_roles: {} })
    const store = usePermissionsStore()
    await store.refresh()

    expect(store.canEditRolesOf(false)).toBe(true)
    expect(store.canEditRolesOf(true)).toBe(false)
  })

  describe("name colour", () => {
    const meId = "qkUrdzLDoqslx8EEy2cM7Q=="
    const peerId = "Zm9vYmFyYmF6cXV4MTIzNA=="

    async function setup(colorRoles?: Record<string, string>) {
      useUserStore().setUser({
        id: meId,
        nickname: "Me",
        authProvider: "password",
        isGuest: false,
        role: "user",
      })
      vi.mocked(apiService.getMyPermissions).mockResolvedValue(mine())
      vi.mocked(apiService.getRoles).mockResolvedValue({
        roles: [
          role("high", 3, { color: "#ff0000" }),
          role("mid", 2),
          role("low", 1, { color: "#0000ff" }),
        ],
        user_roles: { [meId]: ["high", "mid", "low"], [peerId]: ["high"] },
        color_roles: colorRoles,
      })
      const store = usePermissionsStore()
      await store.refresh()
      return store
    }

    it("defaults to the highest coloured role", async () => {
      const store = await setup()
      expect(store.colorOf(meId)).toBe("#ff0000")
      expect(store.colorRoleOf(meId)).toBe("")
      expect(store.colorableRolesOf(meId).map((r) => r.id)).toEqual(["high", "low"])
    })

    it("uses the picked role", async () => {
      const store = await setup({ [meId]: "low" })
      expect(store.colorOf(meId)).toBe("#0000ff")
      expect(store.nameStyleOf(meId)).toEqual({ color: "#0000ff" })
    })

    it("falls back when the picked role is no longer held", async () => {
      const store = await setup({ [peerId]: "low" })
      expect(store.colorOf(peerId)).toBe("#ff0000")
    })

    it("sets my pick optimistically and reverts on failure", async () => {
      const store = await setup()
      vi.mocked(apiService.setMyColorRole).mockResolvedValue({ role_id: "low" })
      await store.setMyColorRole("low")
      expect(apiService.setMyColorRole).toHaveBeenLastCalledWith("low")
      expect(store.colorOf(meId)).toBe("#0000ff")

      vi.mocked(apiService.setMyColorRole).mockRejectedValue(new Error("403"))
      await expect(store.setMyColorRole(null)).rejects.toThrow()
      expect(store.colorRoleOf(meId)).toBe("low")
    })

    it("applies picks broadcast for other users", async () => {
      const store = await setup()
      store.applyColorRole(peerId, "high")
      expect(store.colorRoleOf(peerId)).toBe("high")
      store.applyColorRole(peerId, null)
      expect(store.colorRoleOf(peerId)).toBe("")
    })
  })

  it("denies everything before permissions load", () => {
    const store = usePermissionsStore()
    expect(store.can(Permission.ViewRoom)).toBe(false)
    expect(store.canManageAnyRooms).toBe(false)
  })
})
