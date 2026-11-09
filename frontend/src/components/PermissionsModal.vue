<template>
  <Teleport to="body">
    <div
      class="modal-overlay fixed inset-0 bg-theme-backdrop flex items-center justify-center z-[10000] p-4"
      data-testid="permissions-modal"
      @click.self="$emit('close')">
      <div class="modal-content bg-gray-800 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between p-5 border-b border-gray-700">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-white truncate">
              Permissions — {{ targetName }}
            </h2>
            <p class="text-sm text-gray-400">
              Overrides for this {{ targetType }}. <span class="text-red-400">✕</span> denies,
              <span class="text-gray-300">/</span> inherits,
              <span class="text-green-400">✓</span> allows.
            </p>
          </div>
          <button
            type="button"
            class="text-gray-400 hover:text-white"
            title="Close"
            @click="$emit('close')">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <!-- Sync with category (rooms only) -->
        <div
          v-if="targetType === 'room'"
          class="px-5 py-3 border-b border-gray-700 flex items-center justify-between gap-4 bg-gray-900/40">
          <div class="text-sm">
            <div class="text-gray-200">
              {{ synced ? "Synced with category" : "Custom permissions" }}
            </div>
            <div class="text-gray-500">
              {{
                synced
                  ? "This room uses its category's permissions. Editing below makes a copy for this room."
                  : "This room has its own permissions and ignores the category's."
              }}
            </div>
          </div>
          <button
            v-if="!synced"
            type="button"
            data-testid="permissions-sync"
            class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50 flex-shrink-0"
            :disabled="busy"
            @click="syncWithCategory">
            Sync with category
          </button>
        </div>

        <div class="flex flex-col md:flex-row flex-1 min-h-0">
          <!-- Subjects -->
          <div
            class="md:w-60 border-b md:border-b-0 md:border-r border-gray-700 p-2 overflow-y-auto">
            <div class="text-xs font-medium uppercase tracking-wide text-gray-400 px-2 py-1">
              Roles / members
            </div>
            <button
              v-for="subject in subjects"
              :key="subject.key"
              type="button"
              class="w-full flex items-center gap-2 px-2 py-2 rounded text-left text-sm"
              :class="
                selectedKey === subject.key
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:bg-gray-700/50'
              "
              :data-testid="`permissions-subject-${subject.label}`"
              @click="selectedKey = subject.key">
              <span
                v-if="subject.type === 'role'"
                class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                :style="{ backgroundColor: subject.color || '#6b7280' }"></span>
              <PhUser v-else class="w-3.5 h-3.5 flex-shrink-0" />
              <span class="truncate">{{ subject.label }}</span>
            </button>

            <div class="mt-3 px-2 space-y-2">
              <select
                v-model="toAdd"
                data-testid="permissions-add-subject"
                class="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-white text-sm"
                :disabled="busy">
                <option value="">Add role or member…</option>
                <optgroup v-if="addableRoles.length" label="Roles">
                  <option v-for="r in addableRoles" :key="r.id" :value="`role:${r.id}`">
                    {{ r.name }}
                  </option>
                </optgroup>
                <optgroup v-if="addableUsers.length" label="Members">
                  <option v-for="u in addableUsers" :key="u.id" :value="`user:${u.id}`">
                    {{ u.nickname }}
                  </option>
                </optgroup>
              </select>
            </div>
          </div>

          <!-- Editor -->
          <div class="flex-1 overflow-y-auto p-4">
            <div v-if="loading" class="text-sm text-gray-400">Loading…</div>
            <template v-else-if="current">
              <div v-for="group in groups" :key="group.id" class="mb-5">
                <h3 class="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
                  {{ group.label }}
                </h3>
                <div class="divide-y divide-gray-700/60 border border-gray-700 rounded">
                  <div
                    v-for="info in group.items"
                    :key="info.key"
                    class="flex items-center justify-between gap-4 px-3 py-2.5"
                    :class="{ 'opacity-50': !isEditable(Permission[info.key]) }">
                    <div class="min-w-0">
                      <div class="text-sm text-gray-200">{{ info.label }}</div>
                      <div class="text-xs text-gray-500">{{ info.description }}</div>
                    </div>
                    <PermissionTriState
                      :model-value="stateOf(Permission[info.key])"
                      :label="info.label"
                      :testid-prefix="`perm-${info.key}`"
                      :disabled="busy || !isEditable(Permission[info.key])"
                      @update:model-value="setState(Permission[info.key], $event)" />
                  </div>
                </div>
              </div>
            </template>
            <p v-else class="text-sm text-gray-400">
              Select a role or member to edit its permissions here.
            </p>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 p-4 border-t border-gray-700">
          <button
            v-if="current && current.persisted && current.key !== everyoneKey"
            type="button"
            class="text-sm text-red-400 hover:text-red-300 disabled:opacity-40"
            :disabled="busy"
            @click="removeOverwrite">
            Remove override
          </button>
          <span v-else></span>
          <div class="flex items-center gap-3">
            <span v-if="error" class="text-sm text-red-400">{{ error }}</span>
            <button
              type="button"
              data-testid="permissions-save"
              class="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50"
              :disabled="busy || !current || !current.dirty"
              @click="save">
              {{ busy ? "Saving…" : "Save" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import { PhX, PhUser } from "@phosphor-icons/vue"
import { apiService } from "@/services/api"
import PermissionTriState, { type TriState } from "@/components/PermissionTriState.vue"
import { usePermissionsStore, useUsersStore, useRoomStore } from "@/stores"
import {
  Permission,
  PERMISSION_INFO,
  ROLE_ONLY_PERMISSIONS,
  type OverwriteTargetType,
  type OverwriteSubjectType,
  type PermissionOverwrite,
} from "@/types/permissions"

interface Props {
  targetType: OverwriteTargetType
  targetId: string
  targetName: string
  /** For rooms: the category it syncs with. */
  categoryId?: string
}

const props = defineProps<Props>()
defineEmits<{ close: [] }>()

const permissionsStore = usePermissionsStore()
const usersStore = useUsersStore()
const roomStore = useRoomStore()

interface Draft {
  key: string
  type: OverwriteSubjectType
  id: string
  allow: number
  deny: number
  original: { allow: number; deny: number }
  persisted: boolean
  readonly dirty: boolean
}

const everyoneKey = "role:everyone"
const loading = ref(true)
const busy = ref(false)
const error = ref("")
const drafts = ref<Record<string, Draft>>({})
const selectedKey = ref<string>(everyoneKey)
const toAdd = ref("")
const synced = ref(false)

const makeDraft = (
  type: OverwriteSubjectType,
  id: string,
  allow = 0,
  deny = 0,
  persisted = false,
): Draft => ({
  key: `${type}:${id}`,
  type,
  id,
  allow,
  deny,
  original: { allow, deny },
  persisted,
  get dirty() {
    return this.allow !== this.original.allow || this.deny !== this.original.deny
  },
})

const groups = computed(() => [
  { id: "room", label: "Room", items: PERMISSION_INFO.filter((p) => p.group === "room") },
  {
    id: "voice",
    label: "Voice & video",
    items: PERMISSION_INFO.filter((p) => p.group === "voice"),
  },
])

const scope = computed(() =>
  props.targetType === "room" ? { roomId: props.targetId } : { categoryId: props.targetId },
)
// You can only change bits you hold in this room/category (backend enforces too).
const grantable = computed(() => permissionsStore.grantable(scope.value) & ~ROLE_ONLY_PERMISSIONS)
const isEditable = (bit: number) => (grantable.value & bit) === bit

const subjects = computed(() => {
  const list = Object.values(drafts.value).map((d) => {
    if (d.type === "role") {
      const role = permissionsStore.roles.find((r) => r.id === d.id)
      return {
        key: d.key,
        type: d.type,
        label: role?.name ?? "Unknown role",
        color: role?.color ?? "",
        position: role?.position ?? -1,
      }
    }
    const user = usersStore.allUsers.find((u) => u.id === d.id)
    return {
      key: d.key,
      type: d.type,
      label: user?.nickname ?? "Unknown user",
      color: "",
      position: -2,
    }
  })
  // @everyone first, then roles by position, then members
  return list.sort((a, b) => {
    if (a.key === everyoneKey) return -1
    if (b.key === everyoneKey) return 1
    if (a.type !== b.type) return a.type === "role" ? -1 : 1
    return b.position - a.position || a.label.localeCompare(b.label)
  })
})

const addableRoles = computed(() =>
  permissionsStore.roles.filter(
    (r) => r.system_key !== "everyone" && r.system_key !== "owner" && !drafts.value[`role:${r.id}`],
  ),
)
const addableUsers = computed(() =>
  usersStore.allUsers
    .filter((u) => u.role !== "super_admin" && !drafts.value[`user:${u.id}`])
    .sort((a, b) => a.nickname.localeCompare(b.nickname)),
)

const current = computed(() => drafts.value[selectedKey.value] ?? null)

const stateOf = (bit: number): TriState => {
  const d = current.value
  if (!d) return "inherit"
  if (d.allow & bit) return "allow"
  if (d.deny & bit) return "deny"
  return "inherit"
}

const setState = (bit: number, state: TriState) => {
  const d = current.value
  if (!d) return
  d.allow &= ~bit
  d.deny &= ~bit
  if (state === "allow") d.allow |= bit
  if (state === "deny") d.deny |= bit
}

// Adding a subject from the dropdown creates a local draft.
const onAdd = (value: string) => {
  if (!value) return
  const [type, id] = value.split(":") as [OverwriteSubjectType, string]
  if (!drafts.value[value]) drafts.value[value] = makeDraft(type, id)
  selectedKey.value = value
  toAdd.value = ""
}

const load = async () => {
  loading.value = true
  error.value = ""
  try {
    const room =
      props.targetType === "room" ? roomStore.rooms.find((r) => r.id === props.targetId) : undefined
    synced.value = !!room?.permissions_synced
    // A synced room shows its category's overrides (editing makes a copy).
    const sourceType: OverwriteTargetType =
      synced.value && props.categoryId ? "category" : props.targetType
    const sourceId = synced.value && props.categoryId ? props.categoryId : props.targetId
    const list: PermissionOverwrite[] = await apiService.getOverwrites(sourceType, sourceId)
    const next: Record<string, Draft> = { [everyoneKey]: makeDraft("role", "everyone") }
    for (const o of list) {
      next[`${o.subject_type}:${o.subject_id}`] = makeDraft(
        o.subject_type,
        o.subject_id,
        o.allow,
        o.deny,
        true,
      )
    }
    drafts.value = next
    if (!next[selectedKey.value]) selectedKey.value = everyoneKey
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load permissions"
  } finally {
    loading.value = false
  }
}

const run = async (fn: () => Promise<void>) => {
  busy.value = true
  error.value = ""
  try {
    await fn()
    // The backend broadcasts permissions_updated; refresh our own view now.
    await permissionsStore.loadMine()
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Request failed"
  } finally {
    busy.value = false
  }
}

const save = () =>
  run(async () => {
    const d = current.value
    if (!d) return
    if (d.allow === 0 && d.deny === 0 && d.persisted) {
      await apiService.deleteOverwrite(props.targetType, props.targetId, d.type, d.id)
    } else {
      await apiService.setOverwrite(props.targetType, props.targetId, d.type, d.id, d.allow, d.deny)
    }
    if (props.targetType === "room")
      roomStore.updateRoom(props.targetId, { permissions_synced: false })
  })

const removeOverwrite = () =>
  run(async () => {
    const d = current.value
    if (!d) return
    await apiService.deleteOverwrite(props.targetType, props.targetId, d.type, d.id)
    if (props.targetType === "room")
      roomStore.updateRoom(props.targetId, { permissions_synced: false })
    selectedKey.value = everyoneKey
  })

const syncWithCategory = () =>
  run(async () => {
    await apiService.setRoomPermissionsSynced(props.targetId, true)
    roomStore.updateRoom(props.targetId, { permissions_synced: true })
  })

// Choosing from the "Add role or member" select creates a draft.
watch(toAdd, onAdd)

onMounted(async () => {
  await Promise.all([permissionsStore.loadRoles(), usersStore.fetchAllUsers()])
  await load()
})
</script>
