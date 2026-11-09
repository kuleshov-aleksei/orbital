<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700" data-testid="roles-admin">
    <div class="p-4 border-b border-gray-700 flex items-center justify-between gap-4">
      <div>
        <h2 class="text-lg font-semibold text-white">Roles</h2>
        <p class="text-sm text-gray-400">
          Roles apply from the bottom up: <em>@everyone</em>, then <em>Guest</em> (guest accounts),
          then custom roles. <em>Owner</em> sits on top and only sets the owner's name and colour.
          Each role can allow (✓), deny (✕) or inherit (/) a permission, and higher roles win. Room
          and category overrides are set from each room's menu.
        </p>
      </div>
      <button
        type="button"
        data-testid="create-role"
        class="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors flex-shrink-0 disabled:opacity-50"
        :disabled="busy || !permissionsStore.canManageRoles"
        @click="createRole">
        Create role
      </button>
    </div>

    <div class="flex flex-col md:flex-row min-h-[420px]">
      <!-- Role list -->
      <div class="md:w-64 border-b md:border-b-0 md:border-r border-gray-700 p-2 space-y-1">
        <div
          v-for="(role, index) in orderedRoles"
          :key="role.id"
          class="flex items-center gap-1 rounded"
          :class="selectedId === role.id ? 'bg-gray-700' : 'hover:bg-gray-700/50'">
          <button
            type="button"
            class="flex-1 min-w-0 flex items-center gap-2 px-2 py-2 text-left text-sm"
            :data-testid="`role-item-${role.system_key ?? role.name}`"
            @click="select(role.id)">
            <span
              class="w-3 h-3 rounded-full flex-shrink-0"
              :style="{ backgroundColor: role.color || '#6b7280' }"></span>
            <span class="truncate text-gray-200">{{ role.name }}</span>
            <PhLock
              v-if="!permissionsStore.canManageRole(role)"
              class="w-3.5 h-3.5 text-gray-500 flex-shrink-0"
              title="Above your highest role" />
          </button>
          <template v-if="!role.system_key">
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-white disabled:opacity-30"
              title="Move up"
              :disabled="busy || index === 0 || !canMove(role, orderedRoles[index - 1])"
              @click="swap(role, orderedRoles[index - 1])">
              <PhCaretUp class="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              class="p-1 text-gray-400 hover:text-white disabled:opacity-30"
              title="Move down"
              :disabled="
                busy ||
                !isCustom(orderedRoles[index + 1]) ||
                !canMove(role, orderedRoles[index + 1])
              "
              @click="swap(role, orderedRoles[index + 1])">
              <PhCaretDown class="w-3.5 h-3.5" />
            </button>
          </template>
        </div>
      </div>

      <!-- Editor -->
      <div v-if="selected && draft" class="flex-1 p-4 space-y-6">
        <fieldset :disabled="!editable || busy" class="space-y-6">
          <div class="flex flex-col sm:flex-row gap-3">
            <label class="flex-1">
              <span class="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
                >Name</span
              >
              <input
                v-model="draft.name"
                data-testid="role-name"
                type="text"
                maxlength="32"
                :disabled="!isCustomisable || !editable"
                class="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm disabled:opacity-60" />
            </label>
            <label v-if="isCustomisable">
              <span class="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1"
                >Color</span
              >
              <input
                v-model="draft.color"
                type="color"
                class="h-[38px] w-16 bg-gray-900 border border-gray-700 rounded" />
            </label>
          </div>

          <p v-if="isOwnerRole" class="text-sm text-gray-400">
            Held automatically by the server owner and always shown on top. The owner bypasses every
            permission, so only the name and colour can be changed.
          </p>
          <p v-else-if="selected.system_key === 'everyone'" class="text-sm text-gray-400">
            The base layer for every signed-in user, including guests. Other roles inherit from it.
          </p>
          <p v-else-if="selected.system_key === 'guest'" class="text-sm text-gray-400">
            Applied automatically to guest accounts, right above <em>@everyone</em>. Deny something
            here to take it away from guests only.
          </p>

          <div v-for="group in groups" :key="group.id">
            <h3 class="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
              {{ group.label }}
            </h3>
            <div class="divide-y divide-gray-700/60 border border-gray-700 rounded">
              <div
                v-for="info in group.items"
                :key="info.key"
                class="flex items-center justify-between gap-4 px-3 py-2.5"
                :class="{ 'opacity-50': !isToggleable(Permission[info.key]) }">
                <span class="min-w-0">
                  <span class="block text-sm text-gray-200">{{ info.label }}</span>
                  <span class="block text-xs text-gray-500">{{ info.description }}</span>
                </span>
                <PermissionTriState
                  :model-value="stateOf(Permission[info.key])"
                  :label="info.label"
                  :testid-prefix="`role-perm-${info.key}`"
                  :two-state="isEveryoneRole"
                  :disabled="busy || !isToggleable(Permission[info.key])"
                  @update:model-value="setState(Permission[info.key], $event)" />
              </div>
            </div>
          </div>
        </fieldset>

        <!-- Members -->
        <div v-if="!selected.system_key">
          <h3 class="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
            Members ({{ members.length }})
          </h3>
          <div class="flex gap-2 mb-2">
            <select
              v-model="memberToAdd"
              data-testid="role-add-member"
              class="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm"
              :disabled="!editable || busy">
              <option value="">Add member…</option>
              <option v-for="user in nonMembers" :key="user.id" :value="user.id">
                {{ user.nickname }}
              </option>
            </select>
            <button
              type="button"
              class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50"
              :disabled="!memberToAdd || !editable || busy"
              @click="addMember">
              Add
            </button>
          </div>
          <ul class="divide-y divide-gray-700/60 border border-gray-700 rounded">
            <li
              v-for="user in members"
              :key="user.id"
              class="flex items-center justify-between px-3 py-2 text-sm">
              <span class="text-gray-200">{{ user.nickname }}</span>
              <button
                type="button"
                class="text-red-400 hover:text-red-300 disabled:opacity-40"
                :disabled="!editable || busy"
                @click="removeMember(user.id)">
                Remove
              </button>
            </li>
            <li v-if="members.length === 0" class="px-3 py-2 text-sm text-gray-500">
              Nobody has this role yet.
            </li>
          </ul>
        </div>

        <div class="flex items-center justify-between gap-3 pt-2 border-t border-gray-700">
          <button
            v-if="!selected.system_key"
            type="button"
            class="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 disabled:opacity-40"
            :disabled="!editable || busy"
            @click="deleteRole">
            Delete role
          </button>
          <span v-else></span>
          <div class="flex items-center gap-3">
            <span v-if="error" class="text-sm text-red-400">{{ error }}</span>
            <span v-else-if="!editable" class="text-sm text-gray-500"
              >You can't edit this role.</span
            >
            <button
              type="button"
              data-testid="role-save"
              class="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50"
              :disabled="!editable || busy || !dirty"
              @click="save">
              {{ busy ? "Saving…" : "Save changes" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue"
import { PhLock, PhCaretUp, PhCaretDown } from "@phosphor-icons/vue"
import { usePermissionsStore, useUsersStore } from "@/stores"
import PermissionTriState, { type TriState } from "@/components/PermissionTriState.vue"
import { apiService } from "@/services/api"
import { Permission, PERMISSION_INFO, hasPermission, type Role } from "@/types/permissions"

const permissionsStore = usePermissionsStore()
const usersStore = useUsersStore()

const selectedId = ref<string | null>(null)
const draft = ref<{ name: string; color: string; permissions: number; deny: number } | null>(null)
const busy = ref(false)
const error = ref("")
const memberToAdd = ref("")

// Owner on top, custom roles highest first, then Guest, then @everyone (like Discord's list).
const orderedRoles = computed<Role[]>(() => {
  const list: Role[] = []
  if (permissionsStore.ownerRole) list.push(permissionsStore.ownerRole)
  list.push(...permissionsStore.customRoles)
  if (permissionsStore.guestRole) list.push(permissionsStore.guestRole)
  if (permissionsStore.everyoneRole) list.push(permissionsStore.everyoneRole)
  return list
})

const selected = computed(() => orderedRoles.value.find((r) => r.id === selectedId.value) ?? null)
const editable = computed(() => !!selected.value && permissionsStore.canManageRole(selected.value))
const isEveryoneRole = computed(() => selected.value?.system_key === "everyone")
const isOwnerRole = computed(() => selected.value?.system_key === "owner")
// Name and colour can be changed on custom roles and on Owner.
const isCustomisable = computed(
  () => !!selected.value && (!selected.value.system_key || isOwnerRole.value),
)

// Every role is tri-state; @everyone is the base layer, so "not allowed" = denied.
const stateOf = (bit: number): TriState => {
  const d = draft.value
  if (!d) return "inherit"
  if (d.permissions & bit) return "allow"
  if (isEveryoneRole.value || d.deny & bit) return "deny"
  return "inherit"
}

const setState = (bit: number, state: TriState) => {
  const d = draft.value
  if (!d) return
  d.permissions &= ~bit
  d.deny &= ~bit
  if (state === "allow") d.permissions |= bit
  if (state === "deny" && !isEveryoneRole.value) d.deny |= bit
}

const groups = computed(() => {
  const all = [
    { id: "server", label: "Server", items: PERMISSION_INFO.filter((p) => p.group === "server") },
    { id: "room", label: "Rooms", items: PERMISSION_INFO.filter((p) => p.group === "room") },
    {
      id: "voice",
      label: "Voice & video",
      items: PERMISSION_INFO.filter((p) => p.group === "voice"),
    },
  ]
  // The owner bypasses permissions; there is nothing to toggle.
  if (isOwnerRole.value) return []
  if (isEveryoneRole.value) {
    // Giving everyone Administrator is refused by the backend.
    return all.map((g) => ({ ...g, items: g.items.filter((p) => p.key !== "Administrator") }))
  }
  return all
})

const grantable = computed(() => permissionsStore.grantable())

// You can only toggle permissions you hold yourself (backend enforces the same).
const isToggleable = (bit: number) => editable.value && hasPermission(grantable.value, bit)

const dirty = computed(() => {
  if (!selected.value || !draft.value) return false
  return (
    draft.value.name !== selected.value.name ||
    (draft.value.color || "") !== (selected.value.color || "") ||
    draft.value.permissions !== selected.value.permissions ||
    draft.value.deny !== selected.value.deny_permissions
  )
})

const members = computed(() => {
  if (!selected.value) return []
  const id = selected.value.id
  return usersStore.allUsers.filter((u) => permissionsStore.roleIdsOf(u.id).includes(id))
})

const nonMembers = computed(() => {
  const memberIds = new Set(members.value.map((m) => m.id))
  return usersStore.allUsers
    .filter((u) => !memberIds.has(u.id) && u.role !== "super_admin")
    .sort((a, b) => a.nickname.localeCompare(b.nickname))
})

const resetDraft = () => {
  const role = selected.value
  draft.value = role
    ? {
        name: role.name,
        color: role.color || "",
        permissions: role.permissions,
        deny: role.deny_permissions,
      }
    : null
  error.value = ""
}

watch(selected, resetDraft, { immediate: true })

const select = (id: string) => {
  selectedId.value = id
}

const isCustom = (role?: Role) => !!role && !role.system_key

const canMove = (a: Role, b?: Role) =>
  !!b && isCustom(b) && permissionsStore.canManageRole(a) && permissionsStore.canManageRole(b)

const run = async (fn: () => Promise<void>) => {
  busy.value = true
  error.value = ""
  try {
    await fn()
    await permissionsStore.refresh()
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Request failed"
  } finally {
    busy.value = false
  }
}

const createRole = () =>
  run(async () => {
    const role = await apiService.createRole({ name: "new role" })
    selectedId.value = role.id
  })

const save = () =>
  run(async () => {
    if (!selected.value || !draft.value) return
    const role = selected.value
    await apiService.updateRole(role.id, {
      name: isCustomisable.value ? draft.value.name : undefined,
      color: isCustomisable.value ? draft.value.color : undefined,
      permissions: isOwnerRole.value ? undefined : draft.value.permissions,
      denyPermissions: isEveryoneRole.value || isOwnerRole.value ? undefined : draft.value.deny,
    })
  })

const deleteRole = () =>
  run(async () => {
    if (!selected.value) return
    if (!window.confirm(`Delete role "${selected.value.name}"? Members lose its permissions.`))
      return
    await apiService.deleteRole(selected.value.id)
    selectedId.value = orderedRoles.value[0]?.id ?? null
  })

const swap = (a: Role, b?: Role) =>
  run(async () => {
    if (!b) return
    await apiService.reorderRoles({ [a.id]: b.position, [b.id]: a.position })
  })

const setMembership = (userId: string, add: boolean) =>
  run(async () => {
    if (!selected.value) return
    const current = permissionsStore.roleIdsOf(userId)
    const id = selected.value.id
    const next = add ? [...new Set([...current, id])] : current.filter((r) => r !== id)
    await apiService.setUserRoles(userId, next)
  })

const addMember = async () => {
  if (!memberToAdd.value) return
  await setMembership(memberToAdd.value, true)
  memberToAdd.value = ""
}

const removeMember = (userId: string) => setMembership(userId, false)

onMounted(async () => {
  await Promise.all([permissionsStore.refresh(), usersStore.fetchAllUsers()])
  if (!selectedId.value) selectedId.value = orderedRoles.value[0]?.id ?? null
})
</script>
