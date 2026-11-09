import { defineStore } from "pinia"
import { ref, computed } from "vue"
import { apiService } from "@/services/api"
import { useUserStore } from "./user"
import { Permission, hasPermission, type MyPermissions, type Role } from "@/types/permissions"

/**
 * Client-side mirror of the backend RBAC state. Used ONLY to hide/disable UI;
 * every action is re-authorized by the backend (REST, WebSocket and LiveKit grants).
 */
export const usePermissionsStore = defineStore("permissions", () => {
  const userStore = useUserStore()

  const me = ref<MyPermissions | null>(null)
  const roles = ref<Role[]>([])
  const userRoles = ref<Record<string, string[]>>({})
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

  function roleIdsOf(userId: string): string[] {
    return userRoles.value[userId] ?? []
  }

  function rolesOf(userId: string): Role[] {
    return roleIdsOf(userId)
      .map((id) => rolesById.value.get(id))
      .filter((r): r is Role => !!r)
      .sort((a, b) => b.position - a.position)
  }

  function topPositionOf(userId: string): number {
    return rolesOf(userId).reduce((max, r) => Math.max(max, r.position), 0)
  }

  /** Highest role colour for name display (empty when none). */
  function colorOf(userId: string): string {
    return rolesOf(userId).find((r) => r.color)?.color ?? ""
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
    } catch (error) {
      console.error("Failed to load roles:", error)
    }
  }

  async function refresh() {
    await Promise.all([loadMine(), loadRoles()])
  }

  /** Whether the current user can edit another user's role assignments at all. */
  function canEditRolesOf(targetIsOwner: boolean): boolean {
    return canManageRoles.value && !targetIsOwner
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
    loaded.value = false
  }

  return {
    me,
    roles,
    userRoles,
    loaded,
    isOwner,
    serverPerms,
    customRoles,
    everyoneRole,
    guestRole,
    canManageAnyRooms,
    canManageRoles,
    myTopPosition,
    can,
    roleIdsOf,
    rolesOf,
    topPositionOf,
    colorOf,
    canTarget,
    canManageRole,
    canEditRolesOf,
    toggleUserRole,
    grantable,
    loadMine,
    loadRoles,
    refresh,
    reset,
  }
})
