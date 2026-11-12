<template>
  <div
    class="w-full rounded-lg border border-theme-border bg-theme-bg-primary shadow-lg flex flex-col"
    data-testid="emoji-picker"
    @keydown.escape.stop="emit('close')">
    <div class="p-2 border-b border-theme-border flex items-center gap-1.5">
      <input
        ref="searchInput"
        v-model="query"
        type="text"
        placeholder="Search emoji"
        class="flex-1 min-w-0 px-2 py-1 text-sm bg-theme-bg-tertiary border border-theme-border rounded focus:outline-none focus:border-theme-accent text-theme-text-primary"
        data-testid="emoji-search"
        @keydown.enter.prevent="pickFirstResult" />
      <button
        v-if="canUpload"
        type="button"
        class="h-7 w-7 shrink-0 rounded flex items-center justify-center text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-bg-hover"
        title="Upload a custom emoji"
        aria-label="Upload a custom emoji"
        data-testid="emoji-upload-button"
        @click="openUpload">
        <PhPlus class="w-4 h-4" />
      </button>
    </div>

    <!-- Category tabs -->
    <div v-if="!isSearching" class="flex gap-0.5 px-1 pt-1 overflow-x-auto">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="flex-shrink-0 w-7 h-7 rounded flex items-center justify-center transition-colors"
        :class="
          activeTab === tab.id
            ? 'bg-theme-bg-hover'
            : 'opacity-60 hover:opacity-100 hover:bg-theme-bg-hover'
        "
        :title="tab.label"
        :aria-label="tab.label"
        @click="scrollToCategory(tab.id)">
        <PhClockCounterClockwise
          v-if="tab.id === RECENT_ID"
          class="w-4 h-4 text-theme-text-secondary" />
        <EmojiGlyph v-else :emoji-ref="tab.icon" :size="16" />
      </button>
    </div>

    <!-- Grid: virtualized rows of 8; the Server section pages in on scroll -->
    <div class="relative">
      <div
        v-if="!isSearching && currentLabel"
        class="pointer-events-none absolute top-0 left-2 right-2 z-10 h-6 flex items-end pb-1 bg-theme-bg-primary text-[10px] font-semibold uppercase tracking-wide text-theme-text-muted">
        {{ currentLabel }}
      </div>
      <RecycleScroller
        ref="scroller"
        class="h-52 px-2 pb-2"
        :items="rows"
        :item-size="null"
        key-field="id"
        size-field="size"
        type-field="type"
        :emit-update="true"
        @update="onUpdate">
        <template #default="{ item }">
          <div
            v-if="item.type === 'header'"
            class="h-6 flex items-end pb-1 text-[10px] font-semibold uppercase tracking-wide text-theme-text-muted">
            {{ item.label }}
          </div>
          <div v-else-if="item.type === 'row'" class="grid grid-cols-8 gap-0.5 pb-0.5">
            <button
              v-for="emoji in item.emojis"
              :key="emoji.ref"
              type="button"
              class="emoji-cell"
              :title="emoji.name"
              @click="pick(emoji.ref)">
              <EmojiGlyph :emoji-ref="emoji.ref" :size="20" />
            </button>
          </div>
          <div v-else class="h-9 flex items-center justify-center text-xs text-theme-text-muted">
            {{ item.label }}
          </div>
        </template>
      </RecycleScroller>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue"
import { PhClockCounterClockwise, PhPlus } from "@phosphor-icons/vue"
import { RecycleScroller } from "vue-virtual-scroller"
import "vue-virtual-scroller/index.css"
import EmojiGlyph from "@/components/EmojiGlyph.vue"
import { useCustomEmojisStore, usePermissionsStore, useUserStore } from "@/stores"
import { Permission } from "@/types/permissions"
import {
  addRecentEmoji,
  getEmojiCategories,
  getRecentEmojis,
  resolveEmoji,
  searchEmojis,
  type Emoji,
  type EmojiRef,
} from "@/services/emoji"

// unicodeOnly: for plain-text fields (e.g. room names) where a "custom:<id>"
// ref cannot be rendered; hides custom emojis and the upload button.
const props = withDefaults(defineProps<{ unicodeOnly?: boolean }>(), { unicodeOnly: false })

const emit = defineEmits<{
  select: [ref: EmojiRef]
  close: []
}>()

const RECENT_ID = "__recent"

const customEmojisStore = useCustomEmojisStore()
const permissionsStore = usePermissionsStore()
const userStore = useUserStore()

const canUpload = computed(
  () => !props.unicodeOnly && !userStore.isGuest && permissionsStore.can(Permission.UploadEmojis),
)

const isAllowed = (emoji: Emoji) => !props.unicodeOnly || emoji.kind === "unicode"

// Opens the app-level upload modal; the picker (and its host popover) may close.
const openUpload = () => {
  customEmojisStore.isUploadOpen = true
}

const searchInput = useTemplateRef<HTMLInputElement>("searchInput")
const scroller = useTemplateRef<{
  scrollToItem: (index: number) => void
}>("scroller")

const query = ref("")
const recent = ref<EmojiRef[]>(getRecentEmojis())
const activeTab = ref<string>("")

const isSearching = computed(() => query.value.trim().length > 0)

// Custom emojis outside the loaded pages are searched on the server
// (debounced); unicode and loaded custom emojis match locally right away.
const SEARCH_DEBOUNCE_MS = 150
const serverResults = ref<Emoji[]>([])
const serverQuery = ref("")
const isServerSearching = computed(
  () => !props.unicodeOnly && serverQuery.value !== query.value.trim(),
)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  clearTimeout(searchTimer)
  const q = value.trim()
  if (!q || props.unicodeOnly) {
    serverResults.value = []
    serverQuery.value = q
    return
  }
  searchTimer = setTimeout(async () => {
    const results = await customEmojisStore.search(q).catch(() => [])
    if (query.value.trim() !== q) return
    serverResults.value = results
    serverQuery.value = q
  }, SEARCH_DEBOUNCE_MS)
})
onUnmounted(() => clearTimeout(searchTimer))

const searchResults = computed(() =>
  searchEmojis(query.value, 80, serverResults.value).filter(isAllowed),
)

interface Section {
  id: string
  label: string
  icon: string
  emojis: Emoji[]
}

const sections = computed<Section[]>(() => {
  const recentEmojis = recent.value
    .map((r) => resolveEmoji(r))
    .filter((e): e is Emoji => e !== null && isAllowed(e))
  const categories: Section[] = getEmojiCategories()
    .map((c) => ({ ...c, emojis: c.emojis.filter(isAllowed) }))
    .filter((c) => c.emojis.length > 0)
  return recentEmojis.length > 0
    ? [{ id: RECENT_ID, label: "Recently used", icon: "", emojis: recentEmojis }, ...categories]
    : categories
})

const tabs = computed(() => sections.value.map(({ id, label, icon }) => ({ id, label, icon })))

// Virtual rows. Sizes are fixed (px) so the scroller can position rows
// without measuring them; keep them in step with the row classes above.
const COLUMNS = 8
const HEADER_SIZE = 24
const ROW_SIZE = 36
const STATUS_SIZE = 36

interface Row {
  id: string
  type: "header" | "row" | "status"
  size: number
  section: string
  label?: string
  emojis?: Emoji[]
}

function emojiRows(section: string, emojis: Emoji[]): Row[] {
  const rows: Row[] = []
  for (let i = 0; i < emojis.length; i += COLUMNS) {
    rows.push({
      id: `r:${section}:${i}`,
      type: "row",
      size: ROW_SIZE,
      section,
      emojis: emojis.slice(i, i + COLUMNS),
    })
  }
  return rows
}

const showServerLoading = computed(
  () => !props.unicodeOnly && customEmojisStore.hasMore && !customEmojisStore.error,
)

const rows = computed<Row[]>(() => {
  if (isSearching.value) {
    const results = searchResults.value
    if (results.length > 0) return emojiRows("search", results)
    const label = isServerSearching.value ? "Searching..." : "No emoji found"
    return [{ id: "s:search", type: "status", size: STATUS_SIZE, section: "search", label }]
  }
  const out: Row[] = []
  for (const section of sections.value) {
    out.push({
      id: `h:${section.id}`,
      type: "header",
      size: HEADER_SIZE,
      section: section.id,
      label: section.label,
    })
    out.push(...emojiRows(section.id, section.emojis))
  }
  // More server emojis to page in (the Server section is listed last).
  if (showServerLoading.value) {
    out.push({
      id: "s:more",
      type: "status",
      size: STATUS_SIZE,
      section: "custom",
      label: "Loading...",
    })
  }
  return out
})

const currentLabel = computed(
  () => sections.value.find((s) => s.id === activeTab.value)?.label ?? "",
)

// Load the next page when the end of the list comes into view.
const LOAD_MORE_THRESHOLD_ROWS = 4

function onUpdate(_start: number, end: number, visibleStart: number) {
  const list = rows.value
  if (!isSearching.value) activeTab.value = list[visibleStart]?.section ?? activeTab.value
  if (
    !isSearching.value &&
    showServerLoading.value &&
    end >= list.length - LOAD_MORE_THRESHOLD_ROWS
  ) {
    void customEmojisStore.loadMore()
  }
}

// A new query starts at the top of its results.
watch(isSearching, () => void nextTick(() => scroller.value?.scrollToItem(0)))

const pick = (emojiRef: EmojiRef) => {
  recent.value = addRecentEmoji(emojiRef)
  emit("select", emojiRef)
}

const pickFirstResult = () => {
  const first = searchResults.value[0]
  if (first) pick(first.ref)
}

const scrollToCategory = (id: string) => {
  const index = rows.value.findIndex((r) => r.type === "header" && r.section === id)
  if (index < 0) return
  scroller.value?.scrollToItem(index)
  activeTab.value = id
}

onMounted(() => {
  void customEmojisStore.ensureLoaded()
  activeTab.value = sections.value[0]?.id ?? ""
  searchInput.value?.focus()
})
</script>

<style scoped>
.emoji-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  /* Fixed height: rows are virtualized with ROW_SIZE (34px + 2px gap). */
  height: 34px;
  border-radius: 0.375rem;
  transition: background-color 0.1s;
}
.emoji-cell:hover,
.emoji-cell:focus-visible {
  background-color: var(--color-bg-hover);
  outline: none;
}
</style>
