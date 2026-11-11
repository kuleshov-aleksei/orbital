<template>
  <div ref="root" class="relative">
    <div
      class="flex items-center gap-1 h-8 px-2 rounded-md bg-theme-bg-tertiary border border-transparent focus-within:border-theme-accent transition-[width] w-44 focus-within:w-72 lg:w-56 lg:focus-within:w-80"
      :class="{ '!w-72 lg:!w-80': chips.length || text }"
      @click="focus">
      <span
        v-for="(chip, i) in chips"
        :key="`${i}-${chip}`"
        class="flex items-center gap-0.5 max-w-[10rem] px-1.5 h-5 rounded bg-theme-bg-hover text-[11px] text-theme-text-primary flex-shrink-0"
        data-testid="search-chip">
        <span class="truncate">{{ chip }}</span>
        <button
          type="button"
          class="text-theme-text-muted hover:text-theme-text-primary"
          :aria-label="`Remove filter ${chip}`"
          @click.stop="removeChip(i)">
          <PhX class="w-3 h-3" />
        </button>
      </span>
      <input
        ref="input"
        v-model="text"
        type="search"
        class="flex-1 min-w-[3rem] bg-transparent text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none"
        :placeholder="chips.length ? '' : 'Search'"
        aria-label="Search messages"
        role="combobox"
        :aria-expanded="suggestions.length > 0"
        aria-autocomplete="list"
        data-testid="text-search-input"
        @input="onInput"
        @keydown="onKeydown"
        @focus="refreshSuggestions"
        @blur="onBlur" />
      <PhMagnifyingGlass
        v-if="!chips.length && !text"
        class="w-4 h-4 text-theme-text-muted flex-shrink-0" />
      <button
        v-else
        type="button"
        class="text-theme-text-muted hover:text-theme-text-primary flex-shrink-0"
        aria-label="Clear search"
        @mousedown.prevent
        @click.stop="clear">
        <PhX class="w-4 h-4" />
      </button>
    </div>

    <div
      v-if="suggestions.length"
      class="absolute right-0 top-full mt-1 w-72 z-30 rounded-lg border border-theme-border bg-theme-bg-secondary shadow-lg py-1"
      role="listbox"
      data-testid="search-suggestions">
      <div
        class="px-3 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-theme-text-muted">
        {{ suggestionTitle }}
      </div>
      <button
        v-for="(s, i) in suggestions"
        :key="s.value"
        type="button"
        role="option"
        :aria-selected="i === active"
        class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left"
        :class="
          i === active
            ? 'bg-theme-bg-hover text-theme-text-primary'
            : 'text-theme-text-secondary hover:bg-theme-bg-hover/60'
        "
        @mousedown.prevent
        @mouseenter="active = i"
        @click="accept(s)">
        <span class="font-medium truncate">{{ s.label }}</span>
        <span v-if="s.hint" class="ml-auto text-xs text-theme-text-muted truncate">{{
          s.hint
        }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue"
import { PhMagnifyingGlass, PhX } from "@phosphor-icons/vue"
import { emojiTextToPlain } from "@/services/emoji"
import { useRoomStore, useTextSearchStore, useUsersStore } from "@/stores"

const emit = defineEmits<{ open: []; close: [] }>()

interface SearchSuggestion {
  /** Text that replaces the current word. */
  value: string
  label: string
  hint?: string
  /** Complete filter: becomes a chip right away. */
  complete: boolean
}

const KEYS: { key: string; hint: string }[] = [
  { key: "from:", hint: "author" },
  { key: "in:", hint: "channel" },
  { key: "mentions:", hint: "mentioned member" },
  { key: "during:", hint: "day or month" },
  { key: "before:", hint: "date" },
  { key: "after:", hint: "date" },
  { key: "has:", hint: "photo, video, audio or file" },
  { key: "pinned:", hint: "true" },
]
const HAS_VALUES: { value: string; label: string }[] = [
  { value: "photo", label: "Photo" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "file", label: "Any attachment" },
]
const FILTER_RE = /^(from|in|mentions|during|before|after|pinned|has):(.+)$/i

const search = useTextSearchStore()
const usersStore = useUsersStore()
const roomStore = useRoomStore()

const root = useTemplateRef<HTMLDivElement>("root")
const input = useTemplateRef<HTMLInputElement>("input")
const chips = ref<string[]>([])
// Remounting (channel closed and reopened) keeps the previous query.
const text = ref(search.query)
const suggestions = ref<SearchSuggestion[]>([])
const suggestionTitle = ref("")
const active = ref(0)

const fullQuery = computed(() => [...chips.value, text.value.trim()].filter(Boolean).join(" "))

watch(fullQuery, (q) => {
  search.setQuery(q)
  if (q) emit("open")
})

function focus() {
  input.value?.focus()
}

function quoteIfNeeded(v: string): string {
  return /\s/.test(v) ? `"${v.replace(/"/g, "")}"` : v
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function dateSuggestions(key: string, partial: string): SearchSuggestion[] {
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  const opts = [
    { v: "today", hint: "" },
    { v: "yesterday", hint: "" },
    { v: today, hint: "day" },
    { v: month, hint: "month" },
  ]
  return opts
    .filter((o) => o.v.startsWith(partial.toLowerCase()))
    .map((o) => ({ value: `${key}${o.v}`, label: `${key}${o.v}`, hint: o.hint, complete: true }))
}

/** The word under the caret (search terms are space separated). */
function currentWord(): { start: number; word: string } {
  const el = input.value
  const caret = el?.selectionStart ?? text.value.length
  const before = text.value.slice(0, caret)
  const start = before.lastIndexOf(" ") + 1
  return { start, word: before.slice(start) }
}

function refreshSuggestions() {
  const { word } = currentWord()
  active.value = 0
  const colon = word.indexOf(":")
  if (colon < 0) {
    const w = word.toLowerCase()
    suggestions.value = KEYS.filter((k) => k.key.startsWith(w) && (w.length > 0 || !text.value))
      .slice(0, 7)
      .map((k) => ({ value: k.key, label: k.key, hint: k.hint, complete: false }))
    suggestionTitle.value = "Search options"
    return
  }
  const key = word.slice(0, colon + 1).toLowerCase()
  const partial = word
    .slice(colon + 1)
    .replace(/^["@#]/, "")
    .toLowerCase()
  if (key === "from:" || key === "mentions:") {
    suggestions.value = usersStore.allUsers
      .filter((u) => u.nickname.toLowerCase().includes(partial))
      .slice(0, 8)
      .map((u) => ({
        value: `${key}${quoteIfNeeded(u.nickname)}`,
        label: u.nickname,
        complete: true,
      }))
    suggestionTitle.value = key === "from:" ? "From member" : "Mentions member"
  } else if (key === "in:") {
    suggestions.value = roomStore.rooms
      .filter((r) => r.type === "text")
      .map((r) => emojiTextToPlain(r.name))
      .filter((name) => name.toLowerCase().includes(partial))
      .slice(0, 8)
      .map((name) => ({ value: `in:${quoteIfNeeded(name)}`, label: `#${name}`, complete: true }))
    suggestionTitle.value = "In channel"
  } else if (key === "during:" || key === "before:" || key === "after:") {
    suggestions.value = dateSuggestions(key, partial)
    suggestionTitle.value = "Date"
  } else if (key === "has:") {
    suggestions.value = HAS_VALUES.filter(
      (h) => h.value.startsWith(partial) || h.label.toLowerCase().includes(partial),
    ).map((h) => ({
      value: `has:${h.value}`,
      label: `has:${h.value}`,
      hint: h.label,
      complete: true,
    }))
    suggestionTitle.value = "Has"
  } else if (key === "pinned:") {
    suggestions.value = [{ value: "pinned:true", label: "pinned:true", complete: true }]
    suggestionTitle.value = "Pinned"
  } else {
    suggestions.value = []
  }
}

function replaceCurrentWord(value: string) {
  const { start, word } = currentWord()
  text.value = text.value.slice(0, start) + value + text.value.slice(start + word.length)
}

function accept(s: SearchSuggestion) {
  if (s.complete) {
    replaceCurrentWord("")
    chips.value = [...chips.value, s.value]
    text.value = text.value.replace(/\s+/g, " ").trimStart()
    suggestions.value = []
  } else {
    replaceCurrentWord(s.value)
    refreshSuggestions()
  }
  focus()
}

/** Turns a finished "key:value" word into a chip. */
function chipFromWord(): boolean {
  const { start, word } = currentWord()
  const m = FILTER_RE.exec(word)
  // An unclosed quote is still being typed.
  if (!m || (m[2].startsWith('"') && !/^".*"$/.test(m[2]))) return false
  chips.value = [...chips.value, word]
  text.value = (text.value.slice(0, start) + text.value.slice(start + word.length)).trimStart()
  return true
}

function removeChip(i: number) {
  chips.value = chips.value.filter((_, j) => j !== i)
  focus()
}

function clear() {
  chips.value = []
  text.value = ""
  suggestions.value = []
  emit("close")
}

function onInput() {
  refreshSuggestions()
}

function onKeydown(event: KeyboardEvent) {
  const n = suggestions.value.length
  if (n && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault()
    active.value = (active.value + (event.key === "ArrowDown" ? 1 : n - 1)) % n
    return
  }
  if (n && (event.key === "Tab" || (event.key === "Enter" && currentWord().word))) {
    event.preventDefault()
    accept(suggestions.value[active.value])
    return
  }
  if (event.key === " " && chipFromWord()) {
    event.preventDefault()
    suggestions.value = []
    return
  }
  if (event.key === "Enter") {
    event.preventDefault()
    chipFromWord()
    suggestions.value = []
    search.searchNow()
    if (fullQuery.value) emit("open")
    return
  }
  if (event.key === "Backspace" && !text.value && chips.value.length) {
    event.preventDefault()
    text.value = chips.value[chips.value.length - 1]
    chips.value = chips.value.slice(0, -1)
    return
  }
  if (event.key === "Escape") {
    event.preventDefault()
    event.stopPropagation()
    if (suggestions.value.length) suggestions.value = []
    else if (fullQuery.value) clear()
    else input.value?.blur()
  }
}

function onBlur() {
  suggestions.value = []
}

defineExpose({ focus, root })
</script>
