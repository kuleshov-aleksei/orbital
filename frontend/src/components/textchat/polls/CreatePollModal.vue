<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex bg-theme-backdrop"
      :class="isMobile ? 'items-end' : 'items-center justify-center p-4'"
      data-testid="create-poll-modal"
      @click.self="close"
      @keydown.escape.stop="close">
      <form
        ref="panel"
        class="poll-panel relative flex flex-col w-full bg-theme-bg-secondary shadow-2xl"
        :class="
          isMobile
            ? 'max-h-[92dvh] rounded-t-2xl border-t border-theme-border'
            : 'max-w-lg max-h-[90vh] rounded-xl'
        "
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-poll-title"
        @submit.prevent="submit">
        <div
          v-if="isMobile"
          class="mx-auto mt-2 h-1 w-10 rounded-full bg-theme-border"
          aria-hidden="true" />
        <header class="flex items-center gap-3 px-5 pt-4 pb-3">
          <div
            class="w-9 h-9 rounded-full bg-theme-accent/15 text-theme-accent flex items-center justify-center flex-shrink-0">
            <PhChartBarHorizontal class="w-5 h-5" weight="bold" />
          </div>
          <h2 id="create-poll-title" class="flex-1 text-lg font-semibold text-theme-text-primary">
            Create a poll
          </h2>
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-hover"
            aria-label="Close"
            @click="close">
            <PhX class="w-5 h-5" />
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
          <!-- Question -->
          <section>
            <label
              for="poll-question"
              class="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-theme-text-muted mb-1.5">
              Question
              <span
                class="font-normal normal-case tabular-nums"
                :class="questionLength > POLL_LIMITS.questionChars ? 'text-red-400' : ''"
                >{{ questionLength }}/{{ POLL_LIMITS.questionChars }}</span
              >
            </label>
            <EmojiTextInput
              id="poll-question"
              v-model="question"
              allow-custom
              placeholder="What do you want to ask?"
              autocomplete="off"
              data-testid="poll-question"
              :input-class="inputClass"
              @keydown.enter.prevent="focusOption(0)" />
          </section>

          <!-- Options -->
          <section>
            <div
              class="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-theme-text-muted mb-1.5">
              Answers
              <span class="font-normal normal-case tabular-nums"
                >{{ filledOptions.length }}/{{ POLL_LIMITS.maxOptions }}</span
              >
            </div>
            <TransitionGroup tag="ul" name="option" class="space-y-2">
              <li v-for="(opt, i) in options" :key="opt.key" class="flex items-center gap-2">
                <span
                  class="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums"
                  :class="
                    opt.text.trim()
                      ? 'border-theme-accent text-theme-accent'
                      : 'border-theme-border text-theme-text-muted'
                  "
                  aria-hidden="true"
                  >{{ i + 1 }}</span
                >
                <div class="relative flex-1 min-w-0">
                  <input
                    :ref="(el) => setOptionRef(i, el)"
                    v-model="opt.text"
                    type="text"
                    :class="[inputClass, isDuplicate(i) ? '!border-red-400' : '']"
                    :placeholder="i < POLL_LIMITS.minOptions ? `Answer ${i + 1}` : 'Add an answer'"
                    :aria-label="`Answer ${i + 1}`"
                    :maxlength="POLL_LIMITS.optionChars * 4"
                    autocomplete="off"
                    enterkeyhint="next"
                    data-testid="poll-option"
                    @input="onOptionInput(i)"
                    @keydown.enter.prevent="focusOption(i + 1)"
                    @keydown.backspace="onBackspace(i, $event)" />
                  <span
                    v-if="emojiTextLength(opt.text) > POLL_LIMITS.optionChars * 0.8"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] tabular-nums"
                    :class="
                      emojiTextLength(opt.text) > POLL_LIMITS.optionChars
                        ? 'text-red-400'
                        : 'text-theme-text-muted'
                    "
                    >{{ POLL_LIMITS.optionChars - emojiTextLength(opt.text) }}</span
                  >
                </div>
                <button
                  type="button"
                  class="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-md text-theme-text-muted hover:text-red-400 hover:bg-theme-bg-hover disabled:opacity-0 disabled:pointer-events-none"
                  :disabled="!canRemove(i)"
                  :aria-label="`Remove answer ${i + 1}`"
                  data-testid="poll-option-remove"
                  @click="removeOption(i)">
                  <PhTrash class="w-4 h-4" />
                </button>
              </li>
            </TransitionGroup>
          </section>

          <!-- Settings -->
          <section class="rounded-lg border border-theme-border divide-y divide-theme-border">
            <label
              v-for="s in SETTINGS"
              :key="s.key"
              class="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
              <component :is="s.icon" class="w-5 h-5 flex-shrink-0 text-theme-text-muted" />
              <span class="flex-1 min-w-0">
                <span class="block text-sm text-theme-text-primary">{{ s.label }}</span>
                <span class="block text-xs text-theme-text-muted">{{ s.hint }}</span>
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="settings[s.key]"
                :aria-label="s.label"
                :data-testid="`poll-${s.key}`"
                class="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent"
                :class="settings[s.key] ? 'bg-theme-accent' : 'bg-theme-bg-hover'"
                @click.prevent="settings[s.key] = !settings[s.key]">
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform"
                  :class="settings[s.key] ? 'translate-x-6' : 'translate-x-1'" />
              </button>
            </label>
          </section>

          <!-- Duration -->
          <section>
            <div class="text-xs font-semibold uppercase tracking-wide text-theme-text-muted mb-1.5">
              Ends
            </div>
            <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Poll duration">
              <button
                v-for="d in DURATIONS"
                :key="d.value"
                type="button"
                role="radio"
                :aria-checked="duration === d.value"
                class="px-3 py-1.5 rounded-full text-sm border transition-colors"
                :class="
                  duration === d.value
                    ? 'bg-theme-accent border-theme-accent text-theme-text-on-accent'
                    : 'border-theme-border text-theme-text-secondary hover:bg-theme-bg-hover'
                "
                :data-testid="`poll-duration-${d.value}`"
                @click="duration = d.value">
                {{ d.label }}
              </button>
            </div>
            <input
              v-if="duration === 'custom'"
              v-model="customEnd"
              type="datetime-local"
              :min="toLocalInput(minEnd)"
              :max="toLocalInput(maxEnd)"
              :class="[inputClass, 'mt-2']"
              aria-label="Poll end time"
              data-testid="poll-custom-end" />
            <p class="mt-1.5 text-xs text-theme-text-muted" data-testid="poll-end-preview">
              <template v-if="endsAt">
                Ends <span class="text-theme-text-secondary">{{ formatEnd(endsAt) }}</span>
                — a message will announce the result.
              </template>
              <template v-else>Runs until you end it.</template>
            </p>
          </section>
        </div>

        <footer class="flex items-center gap-3 px-5 py-3 border-t border-theme-border">
          <p class="flex-1 min-w-0 text-xs text-red-400 truncate" data-testid="poll-error">
            {{ shownError }}
          </p>
          <button
            type="button"
            class="px-4 py-2 rounded-lg text-sm text-theme-text-primary bg-theme-bg-tertiary hover:bg-theme-bg-hover"
            @click="close">
            Cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2 rounded-lg text-sm font-semibold bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!!validationError"
            data-testid="poll-submit">
            Create poll
          </button>
        </footer>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue"
import {
  PhArrowsClockwise,
  PhChartBarHorizontal,
  PhEyeSlash,
  PhListChecks,
  PhTrash,
  PhX,
} from "@phosphor-icons/vue"
import EmojiTextInput from "@/components/common/EmojiTextInput.vue"
import { emojiTextLength } from "@/services/emoji"
import { pushBackHandler } from "@/services/backButton"
import { useAppStore } from "@/stores"
import { POLL_LIMITS, type TextPollInput } from "@/types/textChat"

const emit = defineEmits<{ close: []; create: [poll: TextPollInput] }>()

const appStore = useAppStore()
const isMobile = computed(() => appStore.isMobile)

const inputClass =
  "w-full rounded-lg bg-theme-bg-tertiary border border-theme-border px-3 py-2 text-[15px] text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:border-theme-accent"

// --- Question and answers ------------------------------------------------
const question = ref("")
const questionLength = computed(() => emojiTextLength(question.value.trim()))

let nextKey = 0
const options = ref([
  { key: nextKey++, text: "" },
  { key: nextKey++, text: "" },
])
const optionRefs: (HTMLInputElement | null)[] = []
function setOptionRef(i: number, el: unknown) {
  optionRefs[i] = el as HTMLInputElement | null
}

const filledOptions = computed(() => options.value.map((o) => o.text.trim()).filter(Boolean))

/** A new empty row appears once the last one is filled, up to the limit. */
function onOptionInput(i: number) {
  const list = options.value
  if (i === list.length - 1 && list[i].text.trim() && list.length < POLL_LIMITS.maxOptions) {
    list.push({ key: nextKey++, text: "" })
  }
}

function canRemove(i: number): boolean {
  const list = options.value
  if (list.length <= POLL_LIMITS.minOptions) return false
  // The trailing empty row is the "add" slot.
  return !(i === list.length - 1 && !list[i].text.trim())
}

function removeOption(i: number) {
  options.value.splice(i, 1)
  const list = options.value
  const last = list[list.length - 1]
  if (last.text.trim() && list.length < POLL_LIMITS.maxOptions) {
    list.push({ key: nextKey++, text: "" })
  }
}

async function focusOption(i: number) {
  await nextTick()
  const el = optionRefs[i]
  if (el) el.focus()
  else if (!validationError.value) submit()
}

function onBackspace(i: number, e: KeyboardEvent) {
  if (options.value[i].text || i === 0) return
  e.preventDefault()
  if (canRemove(i)) removeOption(i)
  void nextTick(() => optionRefs[Math.max(0, i - 1)]?.focus())
}

function isDuplicate(i: number): boolean {
  const t = options.value[i].text.trim().toLowerCase()
  if (!t) return false
  return options.value.some((o, j) => j < i && o.text.trim().toLowerCase() === t)
}

// --- Settings ------------------------------------------------------------
const settings = reactive({ multiple: false, anonymous: false, allow_change: true })
const SETTINGS = [
  {
    key: "multiple",
    label: "Multiple answers",
    hint: "Voters can pick more than one",
    icon: PhListChecks,
  },
  {
    key: "anonymous",
    label: "Anonymous voting",
    hint: "Nobody sees who voted for what",
    icon: PhEyeSlash,
  },
  {
    key: "allow_change",
    label: "Allow changing votes",
    hint: "Voters can change or take back their vote",
    icon: PhArrowsClockwise,
  },
] as const

// --- Duration ------------------------------------------------------------
const HOUR = 3600_000
const DURATIONS = [
  { value: "none", label: "Never", ms: 0 },
  { value: "1h", label: "1 hour", ms: HOUR },
  { value: "1d", label: "1 day", ms: 24 * HOUR },
  { value: "3d", label: "3 days", ms: 72 * HOUR },
  { value: "1w", label: "1 week", ms: 168 * HOUR },
  { value: "custom", label: "Custom…", ms: 0 },
] as const
type Duration = (typeof DURATIONS)[number]["value"]
const duration = ref<Duration>("none")

// Refreshed every 30 s so the bounds and presets stay current.
const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 30_000)
const minEnd = computed(() => now.value + POLL_LIMITS.minDurationMs)
const maxEnd = computed(() => now.value + POLL_LIMITS.maxDurationMs - HOUR)

function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const customEnd = ref(toLocalInput(Date.now() + 24 * HOUR))

/** The due date picked (unix ms), or null for no due date. */
const endsAt = computed<number | null>(() => {
  if (duration.value === "none") return null
  if (duration.value === "custom") {
    const t = new Date(customEnd.value).getTime()
    return Number.isNaN(t) ? null : t
  }
  const d = DURATIONS.find((x) => x.value === duration.value)
  return now.value + (d?.ms ?? 0)
})

function formatEnd(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// --- Validation and submit -----------------------------------------------
const validationError = computed(() => {
  if (!question.value.trim()) return "Ask a question"
  if (questionLength.value > POLL_LIMITS.questionChars) return "The question is too long"
  if (filledOptions.value.length < POLL_LIMITS.minOptions) return "Add at least two answers"
  if (filledOptions.value.some((t) => emojiTextLength(t) > POLL_LIMITS.optionChars)) {
    return "An answer is too long"
  }
  if (options.value.some((_, i) => isDuplicate(i))) return "Answers must be different"
  if (duration.value === "custom") {
    if (endsAt.value === null) return "Pick an end time"
    if (endsAt.value < minEnd.value) return "The end time must be in the future"
    if (endsAt.value > maxEnd.value + HOUR) return "A poll can run for at most 31 days"
  }
  return ""
})
// Missing input isn't an error until the user tries to submit.
const triedSubmit = ref(false)
const shownError = computed(() => {
  const e = validationError.value
  if (!e) return ""
  if (triedSubmit.value) return e
  return /too long|different|end time|31 days/.test(e) ? e : ""
})

function submit() {
  triedSubmit.value = true
  if (validationError.value) return
  // Presets count from the moment of creation, not from when the modal opened.
  const preset = DURATIONS.find((d) => d.value === duration.value)
  const closesAt =
    duration.value === "none"
      ? null
      : duration.value === "custom"
        ? endsAt.value
        : Date.now() + (preset?.ms ?? 0)
  emit("create", {
    question: question.value.trim(),
    options: filledOptions.value,
    multiple: settings.multiple,
    anonymous: settings.anonymous,
    allow_change: settings.allow_change,
    closes_at_ts: closesAt,
  })
}

function close() {
  emit("close")
}

// --- Lifecycle -----------------------------------------------------------

let stopBack: (() => void) | null = null
onMounted(async () => {
  stopBack = pushBackHandler(close)
  await nextTick()
  // Desktop: start typing at once. On mobile the keyboard would cover the sheet.
  if (!isMobile.value) document.getElementById("poll-question")?.focus()
})
onBeforeUnmount(() => {
  stopBack?.()
  clearInterval(clock)
})
</script>

<style scoped>
.poll-panel {
  padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
}
.option-enter-active,
.option-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.option-enter-from,
.option-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
