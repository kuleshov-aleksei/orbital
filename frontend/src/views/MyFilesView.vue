<template>
  <div class="h-full overflow-y-auto p-4 lg:p-8" data-testid="my-files">
    <div class="max-w-5xl mx-auto">
      <header class="flex flex-wrap items-end gap-4 mb-6">
        <div class="flex-1 min-w-[240px]">
          <h1 class="text-2xl font-bold text-theme-text-primary">My files</h1>
          <p class="text-sm text-theme-text-muted mt-1">
            Files you attached in text channels. When your storage is full, your
            <strong class="text-theme-text-secondary">oldest unprotected</strong> files are removed
            automatically to make room for new uploads. Protect a file to keep it.
          </p>
        </div>
        <button
          type="button"
          class="px-3 py-1.5 rounded-md text-sm border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover"
          @click="refresh">
          Refresh
        </button>
      </header>

      <p
        v-if="!configStore.attachments && configStore.isLoaded"
        class="p-4 rounded-lg bg-theme-bg-secondary text-theme-text-secondary">
        Attachments are disabled on this server.
      </p>

      <template v-else>
        <!-- Usage -->
        <section
          v-if="usage"
          class="mb-6 p-4 rounded-lg border border-theme-border bg-theme-bg-secondary"
          aria-label="Storage usage">
          <div class="flex items-baseline gap-2 mb-2">
            <span class="text-lg font-semibold text-theme-text-primary">{{
              formatBytes(usage.used_bytes)
            }}</span>
            <span class="text-sm text-theme-text-muted"
              >of {{ formatBytes(usage.quota_bytes) }} used · {{ usage.count }}
              {{ usage.count === 1 ? "file" : "files" }}</span
            >
            <span
              class="ml-auto text-sm tabular-nums"
              :class="usedPct >= 90 ? 'text-amber-300' : 'text-theme-text-muted'"
              >{{ usedPct }}%</span
            >
          </div>
          <div
            class="flex h-2.5 rounded-full overflow-hidden bg-theme-bg-tertiary"
            role="meter"
            :aria-valuenow="usage.used_bytes"
            aria-valuemin="0"
            :aria-valuemax="usage.quota_bytes"
            :aria-valuetext="`${formatBytes(usage.used_bytes)} of ${formatBytes(usage.quota_bytes)}`">
            <div class="bg-emerald-500" :style="{ width: pct(usage.protected_bytes) }" />
            <div class="bg-theme-accent" :style="{ width: pct(unprotectedBytes) }" />
            <div class="bg-theme-text-muted/60" :style="{ width: pct(usage.pending_bytes) }" />
          </div>
          <div class="flex flex-wrap gap-4 mt-2 text-xs text-theme-text-muted">
            <span class="flex items-center gap-1.5"
              ><span class="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Protected
              {{ formatBytes(usage.protected_bytes) }}</span
            >
            <span class="flex items-center gap-1.5"
              ><span class="w-2.5 h-2.5 rounded-sm bg-theme-accent" /> Can be auto-removed
              {{ formatBytes(unprotectedBytes) }}</span
            >
            <span v-if="usage.pending_bytes" class="flex items-center gap-1.5"
              ><span class="w-2.5 h-2.5 rounded-sm bg-theme-text-muted/60" /> Not sent yet
              {{ formatBytes(usage.pending_bytes) }}</span
            >
          </div>
        </section>

        <!-- Toolbar -->
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <div
            class="flex rounded-md border border-theme-border overflow-hidden"
            role="group"
            aria-label="File type">
            <button
              v-for="k in KINDS"
              :key="k.value"
              type="button"
              class="px-3 py-1.5 text-sm transition-colors"
              :class="
                filters.kind === k.value
                  ? 'bg-theme-accent text-white'
                  : 'text-theme-text-secondary hover:bg-theme-bg-hover'
              "
              :aria-pressed="filters.kind === k.value"
              @click="filters.kind = k.value">
              {{ k.label }}
            </button>
          </div>
          <select v-model="filters.roomId" :class="field" aria-label="Channel">
            <option value="">All channels</option>
            <option v-for="r in textRooms" :key="r.id" :value="r.id">
              #{{ emojiTextToPlain(r.name) }}
            </option>
          </select>
          <select v-model="filters.sort" :class="field" aria-label="Sort">
            <option value="oldest">Oldest first (removed first)</option>
            <option value="newest">Newest first</option>
            <option value="largest">Largest first</option>
          </select>
          <input
            v-model="search"
            type="search"
            placeholder="Search file names"
            :class="[field, 'flex-1 min-w-[160px]']"
            aria-label="Search file names" />
          <label class="flex items-center gap-1.5 text-sm text-theme-text-secondary">
            <input
              v-model="filters.protectedOnly"
              type="checkbox"
              class="accent-[var(--color-accent)]" />
            Protected only
          </label>
        </div>

        <!-- Bulk actions -->
        <div
          v-if="selected.size"
          class="sticky top-0 z-10 flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-theme-bg-tertiary border border-theme-border text-sm"
          data-testid="bulk-bar">
          <span class="text-theme-text-primary font-medium">{{ selected.size }} selected</span>
          <button type="button" :class="smallBtn" @click="bulk('protect')">Protect</button>
          <button type="button" :class="smallBtn" @click="bulk('unprotect')">
            Allow auto-removal
          </button>
          <button type="button" :class="[smallBtn, '!text-red-400']" @click="confirmBulkDelete">
            {{ confirmDelete ? `Click again to delete ${selected.size}` : "Delete" }}
          </button>
          <button
            type="button"
            class="ml-auto text-theme-text-muted hover:text-theme-text-primary"
            @click="clearSelection">
            Clear
          </button>
        </div>

        <p v-if="error" class="mb-3 text-sm text-red-400" role="alert">{{ error }}</p>

        <!-- Files -->
        <div class="rounded-lg border border-theme-border overflow-hidden">
          <div
            class="hidden sm:grid grid-cols-[28px_56px_1fr_90px_140px_110px_auto] gap-3 px-3 py-2 text-xs font-medium text-theme-text-muted bg-theme-bg-secondary border-b border-theme-border">
            <input
              type="checkbox"
              :checked="allSelected"
              :indeterminate="selected.size > 0 && !allSelected"
              aria-label="Select all"
              class="accent-[var(--color-accent)]"
              @change="toggleAll" />
            <span />
            <span>Name</span>
            <span>Size</span>
            <span>Channel</span>
            <span>Uploaded</span>
            <span class="text-right">Actions</span>
          </div>
          <div
            v-for="f in items"
            :key="f.id"
            class="grid grid-cols-[28px_56px_1fr_auto] sm:grid-cols-[28px_56px_1fr_90px_140px_110px_auto] gap-3 items-center px-3 py-2 border-b border-theme-border/60 last:border-b-0 hover:bg-theme-bg-secondary/60"
            data-testid="my-file-row">
            <input
              type="checkbox"
              :checked="selected.has(f.id)"
              :aria-label="`Select ${f.filename}`"
              class="accent-[var(--color-accent)]"
              @change="toggle(f.id)" />
            <FileThumb :file="f" />
            <div class="min-w-0">
              <div class="truncate text-sm text-theme-text-primary" :title="f.filename">
                {{ f.filename }}
              </div>
              <div class="flex flex-wrap gap-1.5 mt-0.5">
                <span v-if="f.protected" class="badge bg-emerald-500/15 text-emerald-300">
                  <PhLock class="w-3 h-3" weight="fill" /> Protected
                </span>
                <span
                  v-if="f.removal_next"
                  class="badge bg-amber-500/15 text-amber-300"
                  title="Removed first when storage is full">
                  Removed next
                </span>
                <span
                  v-if="f.status === 'pending'"
                  class="badge bg-theme-bg-tertiary text-theme-text-muted"
                  >Not sent</span
                >
                <span class="sm:hidden text-xs text-theme-text-muted"
                  >{{ formatBytes(f.stored_bytes) }} · #{{ roomLabel(f) }}</span
                >
              </div>
            </div>
            <span class="hidden sm:block text-sm tabular-nums text-theme-text-secondary">{{
              formatBytes(f.stored_bytes)
            }}</span>
            <span class="hidden sm:block text-sm truncate text-theme-text-secondary"
              >#{{ roomLabel(f) }}</span
            >
            <span
              class="hidden sm:block text-sm text-theme-text-secondary"
              :title="formatFullTime(f.created_at)"
              >{{ formatDay(f.created_at) }}</span
            >
            <div class="flex items-center justify-end gap-0.5">
              <button
                type="button"
                :class="iconBtn"
                :disabled="!f.can_view || !f.message_id"
                :title="f.can_view ? 'Jump to message' : 'You can no longer see this channel'"
                aria-label="Jump to message"
                @click="requestMessageJump(f.room_id, f.message_id!)">
                <PhArrowSquareOut class="w-4 h-4" />
              </button>
              <button
                type="button"
                :class="iconBtn"
                title="Download"
                aria-label="Download"
                @click="openAttachment(f.id, 'download')">
                <PhDownloadSimple class="w-4 h-4" />
              </button>
              <button
                type="button"
                :class="iconBtn"
                :disabled="f.status !== 'attached'"
                :title="f.protected ? 'Allow auto-removal' : 'Protect from auto-removal'"
                :aria-label="f.protected ? 'Allow auto-removal' : 'Protect from auto-removal'"
                :aria-pressed="f.protected"
                data-testid="my-file-protect"
                @click="protect(f)">
                <PhLock v-if="f.protected" class="w-4 h-4 text-emerald-400" weight="fill" />
                <PhLockOpen v-else class="w-4 h-4" />
              </button>
              <button
                type="button"
                :class="[
                  iconBtn,
                  confirmId === f.id ? '!text-red-400 bg-red-500/10' : 'hover:!text-red-400',
                ]"
                :title="confirmId === f.id ? 'Click again to delete' : 'Delete'"
                :aria-label="confirmId === f.id ? 'Confirm delete' : 'Delete'"
                data-testid="my-file-delete"
                @click="remove(f)">
                <PhTrash class="w-4 h-4" />
              </button>
            </div>
          </div>
          <div
            v-if="!items.length && !loading"
            class="p-8 text-center text-sm text-theme-text-muted">
            {{
              hasFilters ? "No files match these filters." : "You haven't attached any files yet."
            }}
          </div>
          <div v-if="loading" class="p-4 flex justify-center">
            <PhSpinner class="w-5 h-5 animate-spin text-theme-text-muted" />
          </div>
        </div>
        <div v-if="nextCursor && !loading" class="flex justify-center mt-3">
          <button type="button" :class="smallBtn" @click="load(false)">Load more</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue"
import {
  PhArrowSquareOut,
  PhDownloadSimple,
  PhLock,
  PhLockOpen,
  PhSpinner,
  PhTrash,
} from "@phosphor-icons/vue"
import FileThumb from "@/components/textchat/attachments/FileThumb.vue"
import { apiService } from "@/services/api"
import { emojiTextToPlain } from "@/services/emoji"
import { forgetAttachmentUrls, openAttachment } from "@/services/attachments/urls"
import { requestMessageJump } from "@/services/attachments/jumps"
import { useConfigStore } from "@/stores"
import type { Room } from "@/types"
import { formatBytes } from "@/utils/formatBytes"
import { formatFullTime } from "@/utils/messageGrouping"
import type {
  AttachmentBulkAction,
  AttachmentKind,
  AttachmentUsage,
  MyAttachment,
  MyAttachmentsSort,
} from "@/types/textChat"

const configStore = useConfigStore()

const KINDS: { value: AttachmentKind | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
]
const field =
  "px-2.5 py-1.5 rounded-md text-sm bg-theme-bg-tertiary border border-theme-border text-theme-text-primary focus:border-theme-accent"
const smallBtn =
  "px-2.5 py-1 rounded-md text-sm border border-theme-border text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover"
const iconBtn =
  "w-8 h-8 flex items-center justify-center rounded text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover disabled:opacity-40 disabled:pointer-events-none transition-colors"

const usage = ref<AttachmentUsage | null>(null)
const items = ref<MyAttachment[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref("")
const filters = reactive({
  kind: "" as AttachmentKind | "",
  roomId: "",
  sort: "oldest" as MyAttachmentsSort,
  q: "",
  protectedOnly: false,
})
const selected = ref(new Set<string>())
const confirmId = ref<string | null>(null)
const confirmDelete = ref(false)

// The page runs in its own tab, so it loads the channel list itself.
const rooms = ref<Room[]>([])
const textRooms = computed(() => rooms.value.filter((r) => r.type === "text"))
const hasFilters = computed(
  () => !!(filters.kind || filters.roomId || filters.q || filters.protectedOnly),
)
const usedPct = computed(() =>
  usage.value?.quota_bytes
    ? Math.round((usage.value.used_bytes / usage.value.quota_bytes) * 100)
    : 0,
)
const unprotectedBytes = computed(() =>
  usage.value
    ? Math.max(0, usage.value.used_bytes - usage.value.protected_bytes - usage.value.pending_bytes)
    : 0,
)
const allSelected = computed(
  () => items.value.length > 0 && items.value.every((f) => selected.value.has(f.id)),
)

function pct(bytes: number): string {
  return usage.value?.quota_bytes
    ? `${Math.min(100, (bytes / usage.value.quota_bytes) * 100)}%`
    : "0%"
}

function roomLabel(f: MyAttachment): string {
  return f.room_name ? emojiTextToPlain(f.room_name) : "deleted-channel"
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
})
function formatDay(ts: number): string {
  return dayFormat.format(new Date(ts))
}

let loadToken = 0
async function load(reset: boolean) {
  const token = ++loadToken
  loading.value = true
  error.value = null
  try {
    const [page, u] = await Promise.all([
      apiService.listMyAttachments({
        kind: filters.kind,
        roomId: filters.roomId,
        sort: filters.sort,
        q: filters.q,
        protectedOnly: filters.protectedOnly,
        cursor: reset ? null : nextCursor.value,
      }),
      apiService.getMyAttachmentUsage(),
    ])
    if (token !== loadToken) return
    items.value = reset ? page.items : [...items.value, ...page.items]
    nextCursor.value = page.next_cursor
    usage.value = u
    if (reset)
      selected.value = new Set(
        [...selected.value].filter((id) => page.items.some((f) => f.id === id)),
      )
  } catch {
    if (token === loadToken) error.value = "Your files could not be loaded."
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function refresh() {
  void load(true)
}

watch(filters, refresh)
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => (filters.q = q.trim()), 250)
})

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
  confirmDelete.value = false
}

function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(items.value.map((f) => f.id))
  confirmDelete.value = false
}

function clearSelection() {
  selected.value = new Set()
  confirmDelete.value = false
}

async function protect(f: MyAttachment) {
  error.value = null
  try {
    await apiService.setAttachmentProtected(f.id, !f.protected)
    refresh()
  } catch {
    error.value = "That file could not be changed."
  }
}

async function remove(f: MyAttachment) {
  if (confirmId.value !== f.id) {
    confirmId.value = f.id
    return
  }
  confirmId.value = null
  error.value = null
  try {
    await apiService.deleteAttachment(f.id)
    forgetAttachmentUrls(f.id)
    refresh()
  } catch {
    error.value = "That file could not be deleted."
  }
}

async function bulk(action: AttachmentBulkAction) {
  const ids = [...selected.value]
  if (!ids.length) return
  error.value = null
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const res = await apiService.bulkMyAttachments(ids.slice(i, i + 100), action)
      usage.value = res.usage
    }
    if (action === "delete") ids.forEach(forgetAttachmentUrls)
    clearSelection()
    refresh()
  } catch {
    error.value = "Some files could not be changed."
  }
}

function confirmBulkDelete() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  void bulk("delete")
}

// Another tab may have uploaded or removed files.
function onVisible() {
  if (document.visibilityState === "visible") refresh()
}

onMounted(() => {
  document.title = "My files · The Orbital"
  void configStore.loadConfig()
  apiService
    .getRooms()
    .then((list) => (rooms.value = list))
    .catch(() => {})
  refresh()
  document.addEventListener("visibilitychange", onVisible)
})
onBeforeUnmount(() => document.removeEventListener("visibilitychange", onVisible))
</script>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 11px;
  line-height: 1.25rem;
}
</style>
