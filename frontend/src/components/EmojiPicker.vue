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

    <!-- Grid -->
    <div ref="scrollArea" class="relative h-52 overflow-y-auto px-2 pb-2" @scroll="onScroll">
      <template v-if="isSearching">
        <div
          v-if="searchResults.length === 0"
          class="py-6 text-center text-xs text-theme-text-muted">
          No emoji found
        </div>
        <div v-else class="grid grid-cols-8 gap-0.5 pt-2">
          <button
            v-for="emoji in searchResults"
            :key="emoji.ref"
            type="button"
            class="emoji-cell"
            :title="emoji.name"
            @click="pick(emoji.ref)">
            <EmojiGlyph :emoji-ref="emoji.ref" :size="20" />
          </button>
        </div>
      </template>
      <template v-else>
        <section
          v-for="section in sections"
          :key="section.id"
          :data-category="section.id"
          class="pt-2">
          <div
            class="sticky top-0 z-10 bg-theme-bg-primary py-1 text-[10px] font-semibold uppercase tracking-wide text-theme-text-muted">
            {{ section.label }}
          </div>
          <div class="grid grid-cols-8 gap-0.5">
            <button
              v-for="emoji in section.emojis"
              :key="emoji.ref"
              type="button"
              class="emoji-cell"
              :title="emoji.name"
              @click="pick(emoji.ref)">
              <EmojiGlyph :emoji-ref="emoji.ref" :size="20" />
            </button>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue"
import { PhClockCounterClockwise, PhPlus } from "@phosphor-icons/vue"
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
const scrollArea = useTemplateRef<HTMLElement>("scrollArea")

const query = ref("")
const recent = ref<EmojiRef[]>(getRecentEmojis())
const activeTab = ref<string>("")

const isSearching = computed(() => query.value.trim().length > 0)
const searchResults = computed(() => searchEmojis(query.value).filter(isAllowed))

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

const pick = (emojiRef: EmojiRef) => {
  recent.value = addRecentEmoji(emojiRef)
  emit("select", emojiRef)
}

const pickFirstResult = () => {
  const first = searchResults.value[0]
  if (first) pick(first.ref)
}

const scrollToCategory = (id: string) => {
  const area = scrollArea.value
  const target = area?.querySelector<HTMLElement>(`[data-category="${id}"]`)
  if (!area || !target) return
  area.scrollTop = target.offsetTop
  activeTab.value = id
}

// Sections are positioned relative to the scroll area (it is `relative`).
// Highlight the tab of the section currently at the top of the grid
const onScroll = () => {
  const area = scrollArea.value
  if (!area || isSearching.value) return
  const top = area.scrollTop + 1
  let current = sections.value[0]?.id ?? ""
  for (const el of area.querySelectorAll<HTMLElement>("[data-category]")) {
    if (el.offsetTop <= top) current = el.dataset.category ?? current
  }
  activeTab.value = current
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
  aspect-ratio: 1;
  border-radius: 0.375rem;
  transition: background-color 0.1s;
}
.emoji-cell:hover,
.emoji-cell:focus-visible {
  background-color: var(--color-bg-hover);
  outline: none;
}
</style>
