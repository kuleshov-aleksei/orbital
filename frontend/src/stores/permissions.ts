import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { apiService } from "@/services/api"
import { useUserStore } from "./user"
import { useUsersStore } from "./users"
import { Permission, hasPermission, type MyPermissions, type Role } from "@/types/permissions"

/**
 * Client-side mirror of the backend RBAC state. Used ONLY to hide/disable UI;
 * every action is re-authorized by the backend (REST, WebSocket and LiveKit grants).
 */
export const usePermissionsStore = defineStore("permissions", () => {
  const userStore = useUserStore()
  const usersStore = useUsersStore()

  const me = ref<MyPermissions | null>(null)
  const roles = ref<Role[]>([])
  const userRoles = ref<Record<string, string[]>>({})
  /** user_id -> role picked to color their nickname (absent = automatic). */
  const colorRoles = ref<Record<string, string>>({})
  const loaded = ref(false)

  const isOwner = computed(() => me.value?.is_owner ?? userStore.isSuperAdmin)
  const serverPerms = computed(() => me.value?.server ?? 0)

  const rolesById = computed(() => {
    const map = new Map<string, Role>()
    for (const role of roles.value) map.set(role.id, role)
    return map
  })

  /** Custom roles sorted highest first (excludes @everyone / Guest). */
  const customRoles = computed(() =>
    roles.value.filter((r) => !r.system_key).sort((a, b) => b.position - a.position),
  )

  const everyoneRole = computed(() => roles.value.find((r) => r.system_key === "everyone"))
  const guestRole = computed(() => roles.value.find((r) => r.system_key === "guest"))
  /** Held implicitly by the super admin; only its name and colour matter. */
  const ownerRole = computed(() => roles.value.find((r) => r.system_key === "owner"))

  /**
   * Check a permission. Without a scope it checks server-level permissions;
   * with roomId/categoryId it checks the effective permissions there.
   */
  function can(
    perm: number,
    scope?: { roomId?: string | null; categoryId?: string | null },
  ): boolean {
    if (isOwner.value) return true
    if (!me.value) return false
    let perms = me.value.server
    if (scope?.roomId) {
      perms = me.value.rooms[scope.roomId] ?? 0
    } else if (scope?.categoryId) {
      perms = me.value.categories[scope.categoryId] ?? 0
    }
    return hasPermission(perms, perm)
  }

  /** True if the user can manage rooms anywhere (server-wide or in some room/category). */
  const canManageAnyRooms = computed(() => {
    if (isOwner.value) return true
    if (!me.value) return false
    if (hasPermission(me.value.server, Permission.ManageRooms)) return true
    return (
      Object.values(me.value.categories).some((p) => hasPermission(p, Permission.ManageRooms)) ||
      Object.values(me.value.rooms).some((p) => hasPermission(p, Permission.ManageRooms))
    )
  })

  const canManageRoles = computed(() => can(Permission.ManageRoles))

  const privateRooms = computed(() => new Set(me.value?.private_rooms ?? []))
  /** The room's permissions are customized (its own or its category's overwrites). */
  function isPrivateRoom(roomId: string): boolean {
    return privateRooms.value.has(roomId)
  }

  function roleIdsOf(userId: string): string[] {
    return userRoles.value[userId] ?? []
  }

  function rolesOf(userId: string): Role[] {
    return roleIdsOf(userId)
      .map((id) => rolesById.value.get(id))
      .filter((r): r is Role => !!r)
      .sort((a, b) => b.position - a.position)
  }

  function accountRoleOf(userId: string) {
    if (userId === userStore.userId) return userStore.role
    return usersStore.allUsers.find((u) => u.id === userId)?.role
  }

  /**
   * Roles to display for a user, highest first: the implicit Owner role for the
   * super admin, assigned custom roles, then the implicit Guest role for guests.
   */
  function displayRolesOf(userId: string): Role[] {
    const list = rolesOf(userId)
    const accountRole = accountRoleOf(userId)
    if (accountRole === "super_admin" && ownerRole.value) list.unshift(ownerRole.value)
    if (accountRole === "guest" && guestRole.value) list.push(guestRole.value)
    return list
  }

  function topPositionOf(userId: string): number {
    return rolesOf(userId).reduce((max, r) => Math.max(max, r.position), 0)
  }

  /** Roles that can color a user's name: their coloured display roles, minus Guest. */
  function colorableRolesOf(userId: string): Role[] {
    return displayRolesOf(userId).filter((r) => r.color && r.system_key !== "guest")
  }

  /** The role a user picked for their name colour, or "" for automatic. */
  function colorRoleOf(userId: string): string {
    return colorRoles.value[userId] ?? ""
  }

  /**
   * Name colour: the role the user picked if they still hold it, otherwise
   * the highest coloured role (empty when none).
   */
  function colorOf(userId: string): string {
    const roles = displayRolesOf(userId)
    const picked = colorRoles.value[userId]
    if (picked) {
      const role = roles.find((r) => r.id === picked && r.color)
      if (role) return role.color
    }
    return roles.find((r) => r.color)?.color ?? ""
  }

  /** Applies a name colour pick (ours or another user's, from WebSocket). */
  function applyColorRole(userId: string, roleId: string | null) {
    const next = { ...colorRoles.value }
    if (roleId) next[userId] = roleId
    else delete next[userId]
    colorRoles.value = next
  }

  /** Picks which of my roles colors my name; null = automatic. Optimistic. */
  async function setMyColorRole(roleId: string | null) {
    const userId = userStore.userId
    if (!userId) return
    const previous = colorRoles.value[userId] ?? null
    applyColorRole(userId, roleId)
    try {
      await apiService.setMyColorRole(roleId)
    } catch (error) {
      applyColorRole(userId, previous)
      throw error
    }
  }

  /** Inline style for a nickname: the highest coloured role, or none (theme default). */
  function nameStyleOf(userId: string | null | undefined): { color: string } | undefined {
    const color = userId ? colorOf(userId) : ""
    return color ? { color } : undefined
  }

  const myTopPosition = computed(() =>
    isOwner.value ? Number.MAX_SAFE_INTEGER : (me.value?.top_position ?? 0),
  )

  /** Mirrors backend CanTarget: you can act on users strictly below you; never on the owner. */
  function canTarget(targetUserId: string, targetIsOwner: boolean): boolean {
    if (targetUserId === userStore.userId || targetIsOwner) return false
    if (isOwner.value) return true
    return myTopPosition.value > topPositionOf(targetUserId)
  }

  /** Whether the current user may edit/assign a role (it must be below their top role). */
  function canManageRole(role: Role): boolean {
    if (!canManageRoles.value) return false
    if (role.system_key === "owner") return isOwner.value
    if (role.system_key) return true
    return role.position < myTopPosition.value
  }

  /** Permission bits the current user may toggle in editors. */
  function grantable(scope?: { roomId?: string | null; categoryId?: string | null }): number {
    if (isOwner.value || can(Permission.Administrator)) return 0x7fffffff
    if (!me.value) return 0
    if (scope?.roomId) return me.value.rooms[scope.roomId] ?? 0
    if (scope?.categoryId) return me.value.categories[scope.categoryId] ?? 0
    return me.value.server
  }

  async function loadMine() {
    try {
      me.value = await apiService.getMyPermissions()
      loaded.value = true
    } catch (error) {
      console.error("Failed to load permissions:", error)
    }
  }

  async function loadRoles() {
    try {
      const res = await apiService.getRoles()
      roles.value = res.roles
      userRoles.value = res.user_roles ?? {}
      colorRoles.value = res.color_roles ?? {}
    } catch (error) {
      console.error("Failed to load roles:", error)
    }
  }

  async function refresh() {
    await Promise.all([loadMine(), loadRoles()])
  }

  /**
   * Whether the current user can edit a user's role assignments at all. The
   * owner's roles are only editable by the owner (e.g. for a name colour).
   */
  function canEditRolesOf(targetIsOwner: boolean): boolean {
    return canManageRoles.value && (!targetIsOwner || isOwner.value)
  }

  /** Adds or removes one role for a user. The backend enforces the hierarchy. */
  async function toggleUserRole(userId: string, roleId: string) {
    const current = roleIdsOf(userId)
    const next = current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId]
    const res = await apiService.setUserRoles(userId, next)
    userRoles.value = { ...userRoles.value, [userId]: res.role_ids ?? next }
    // permissions_updated over WebSocket refreshes everyone else (and our own perms).
  }

  function reset() {
    me.value = null
    roles.value = []
    userRoles.value = {}
    colorRoles.value = {}
    loaded.value = false
  }

  return {
    me,
    roles,
    userRoles,
    colorRoles,
    loaded,
    isOwner,
    serverPerms,
    customRoles,
    everyoneRole,
    guestRole,
    ownerRole,
    canManageAnyRooms,
    canManageRoles,
    myTopPosition,
    can,
    roleIdsOf,
    rolesOf,
    displayRolesOf,
    topPositionOf,
    colorOf,
    colorRoleOf,
    colorableRolesOf,
    applyColorRole,
    setMyColorRole,
    nameStyleOf,
    canTarget,
    canManageRole,
    canEditRolesOf,
    toggleUserRole,
    grantable,
    isPrivateRoom,
    loadMine,
    loadRoles,
    refresh,
    reset,
  }
})
