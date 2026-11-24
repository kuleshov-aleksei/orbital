<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-[80] p-4"
      @click.self="close">
      <div
        data-testid="badge-award-modal"
        class="bg-theme-bg-secondary border border-theme-border rounded-lg p-5 w-full max-w-lg max-h-[90vh] flex flex-col">
        <div class="flex items-start justify-between gap-3 mb-1">
          <div class="min-w-0">
            <h2 class="text-lg font-semibold text-theme-text-primary truncate">
              Award “{{ badge.name }}”
            </h2>
            <p class="text-xs text-theme-text-muted">
              {{ checked.size }} {{ checked.size === 1 ? "holder" : "holders" }}
            </p>
          </div>
          <button
            type="button"
            class="text-theme-text-muted hover:text-theme-text-primary shrink-0"
            title="Close"
            @click="close">
            <PhX class="w-5 h-5" />
          </button>
        </div>

        <input
          v-model="query"
          type="text"
          placeholder="Search members"
          class="mt-3 w-full px-2 py-1.5 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary"
          data-testid="badge-award-search" />

        <div class="mt-3 flex-1 min-h-0 overflow-y-auto -mx-1 px-1" data-testid="badge-award-list">
          <label
            v-for="user in filteredUsers"
            :key="user.id"
            class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-theme-bg-hover cursor-pointer">
            <input
              type="checkbox"
              class="accent-indigo-600"
              :checked="checked.has(user.id)"
              :data-testid="`badge-award-user-${user.id}`"
              @change="toggle(user.id, ($event.target as HTMLInputElement).checked)" />
            <span class="text-sm text-theme-text-primary truncate">{{ user.nickname }}</span>
            <span v-if="user.role === 'guest'" class="text-[10px] uppercase text-theme-text-muted"
              >guest</span
            >
          </label>
          <p v-if="!filteredUsers.length" class="p-4 text-center text-sm text-theme-text-muted">
            {{ isLoadingUsers ? "Loading members…" : "No members match your search" }}
          </p>
        </div>

        <p v-if="error" class="mt-2 text-sm text-red-400" data-testid="badge-award-error">
          {{ error }}
        </p>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded bg-theme-bg-tertiary hover:bg-theme-bg-hover text-theme-text-primary disabled:opacity-50"
            :disabled="isSaving"
            @click="close">
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
            :disabled="isSaving || !dirty"
            data-testid="badge-award-save"
            @click="save">
            {{ isSaving ? "Saving…" : "Save" }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { PhX } from "@phosphor-icons/vue"
import { useBadgesStore, useUsersStore, type Badge } from "@/stores"

const props = defineProps<{ badge: Badge }>()
const emit = defineEmits<{ close: [] }>()

const badgesStore = useBadgesStore()
const usersStore = useUsersStore()

const query = ref("")
const isSaving = ref(false)
const isLoadingUsers = ref(false)
const error = ref<string | null>(null)

// Members that hold the badge when the dialog opened, to save only changes.
const initial = new Set(badgesStore.holderIDs(props.badge.id))
const checked = ref(new Set<string>(initial))

const dirty = computed(() => {
  if (checked.value.size !== initial.size) return true
  for (const id of checked.value) if (!initial.has(id)) return true
  return false
})

const filteredUsers = computed(() => {
  const q = query.value.trim().toLowerCase()
  const users = usersStore.sortedUsers
  return q ? users.filter((u) => u.nickname.toLowerCase().includes(q)) : users
})

function toggle(userId: string, on: boolean) {
  const next = new Set(checked.value)
  if (on) next.add(userId)
  else next.delete(userId)
  checked.value = next
}

onMounted(async () => {
  if (usersStore.allUsers.length) return
  isLoadingUsers.value = true
  try {
    await usersStore.fetchAllUsers()
  } finally {
    isLoadingUsers.value = false
  }
})

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  error.value = null
  try {
    for (const user of usersStore.sortedUsers) {
      const current = badgesStore.assignments[user.id] ?? []
      const held = current.some((b) => b.badge_id === props.badge.id)
      const want = checked.value.has(user.id)
      if (held === want) continue
      // setUserBadges replaces the whole set, so keep the user's other badges.
      const ids = current.map((b) => b.badge_id).filter((id) => id !== props.badge.id)
      if (want) ids.push(props.badge.id)
      await badgesStore.setUserBadges(user.id, ids)
    }
    emit("close")
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : "Failed to save badges"
  } finally {
    isSaving.value = false
  }
}

function close() {
  if (isSaving.value) return
  emit("close")
}
</script>
