<template>
  <div
    class="poll-card mt-1 w-full max-w-md rounded-xl border border-theme-border bg-theme-bg-secondary p-3"
    data-testid="poll-card"
    :data-poll-state="ended ? 'ended' : 'open'">
    <!-- Header -->
    <div class="flex items-start gap-2">
      <PhChartBarHorizontal
        class="w-5 h-5 mt-0.5 flex-shrink-0 text-theme-accent"
        weight="bold"
        aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <EmojiText
          :text="poll.question"
          class="block font-semibold text-[15px] leading-snug text-theme-text-primary break-words"
          data-testid="poll-question-text" />
        <div class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-theme-text-muted">
          <span>{{ poll.multiple ? "Multiple choice" : "Single choice" }}</span>
          <span aria-hidden="true">·</span>
          <span class="inline-flex items-center gap-1">
            <PhEyeSlash v-if="poll.anonymous" class="w-3.5 h-3.5" aria-hidden="true" />
            {{ poll.anonymous ? "Anonymous" : "Public" }}
          </span>
          <template v-if="statusText">
            <span aria-hidden="true">·</span>
            <span
              :class="ended ? 'text-theme-text-secondary font-medium' : ''"
              :title="statusTitle"
              data-testid="poll-status"
              >{{ statusText }}</span
            >
          </template>
        </div>
      </div>
    </div>

    <!-- Options -->
    <ul class="mt-3 space-y-1.5" :aria-label="`Answers to: ${plainQuestion}`">
      <li v-for="opt in poll.options" :key="opt.id">
        <button
          type="button"
          class="option-row relative w-full overflow-hidden rounded-lg border text-left transition-colors"
          :class="[
            isPicked(opt.id)
              ? 'border-theme-accent'
              : 'border-theme-border ' + (selecting ? 'hover:border-theme-text-muted' : ''),
            selecting ? 'cursor-pointer' : 'cursor-default',
          ]"
          :disabled="!selecting || busy"
          :role="poll.multiple ? 'checkbox' : 'radio'"
          :aria-checked="isPicked(opt.id)"
          data-testid="poll-option-row"
          :data-option-id="opt.id"
          @click="pick(opt.id)">
          <!-- Result bar -->
          <span
            v-if="showResults"
            class="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out"
            :class="isMine(opt.id) ? 'bg-theme-accent/25' : 'bg-theme-bg-hover'"
            :style="{ width: `${percent(opt)}%` }"
            aria-hidden="true" />
          <span class="relative flex items-center gap-2.5 px-3 py-2 min-h-[44px]">
            <!-- Radio / checkbox mark -->
            <span
              v-if="selecting || isMine(opt.id)"
              class="w-[18px] h-[18px] flex-shrink-0 flex items-center justify-center border-2 transition-colors"
              :class="[
                poll.multiple ? 'rounded-[5px]' : 'rounded-full',
                isPicked(opt.id)
                  ? 'border-theme-accent bg-theme-accent text-theme-text-on-accent'
                  : 'border-theme-text-muted',
              ]"
              aria-hidden="true">
              <PhCheck v-if="isPicked(opt.id)" class="w-3 h-3" weight="bold" />
            </span>
            <EmojiText
              :text="opt.text"
              class="flex-1 min-w-0 text-sm text-theme-text-primary break-words" />
            <template v-if="showResults">
              <span
                v-if="!poll.anonymous && opt.user_ids?.length"
                class="hidden sm:flex -space-x-1.5 flex-shrink-0"
                aria-hidden="true">
                <UserAvatar
                  v-for="uid in opt.user_ids.slice(0, 3)"
                  :key="uid"
                  :user-id="uid"
                  :size="18"
                  :show-status="false"
                  class="ring-2 ring-theme-bg-secondary rounded-full" />
              </span>
              <span
                class="flex-shrink-0 text-xs tabular-nums text-theme-text-secondary"
                data-testid="poll-option-count">
                <span class="font-semibold text-theme-text-primary">{{ percent(opt) }}%</span>
                · {{ opt.count ?? 0 }}
              </span>
            </template>
          </span>
        </button>
      </li>
    </ul>

    <!-- Footer -->
    <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <button
        v-if="canShowVoters"
        type="button"
        class="text-theme-text-secondary hover:text-theme-text-primary hover:underline"
        data-testid="poll-view-votes"
        @click="$emit('show-voters')">
        {{ voterText }}
      </button>
      <span v-else class="text-theme-text-muted" data-testid="poll-voter-count">{{
        voterText
      }}</span>
      <span v-if="!showResults && !ended" class="text-theme-text-muted">
        · Vote to see results
      </span>
      <span v-if="offlineHint" class="text-theme-text-muted">· Voting needs a connection</span>
      <PhSpinner v-if="busy" class="w-3.5 h-3.5 animate-spin text-theme-text-muted" />

      <span class="flex-1" />

      <template v-if="!pending && open && canVote && online">
        <button
          v-if="selecting && poll.multiple"
          type="button"
          class="px-3 py-1.5 rounded-md font-semibold bg-theme-accent hover:bg-theme-accent-hover text-theme-text-on-accent disabled:opacity-50"
          :disabled="busy || !selectionChanged || (!selection.length && !voted)"
          data-testid="poll-submit-vote"
          @click="submitSelection">
          {{ voted ? "Update vote" : "Vote" }}
        </button>
        <button
          v-if="changing"
          type="button"
          class="text-theme-text-secondary hover:text-theme-text-primary"
          @click="stopChanging">
          Cancel
        </button>
        <button
          v-else-if="voted && poll.allow_change"
          type="button"
          class="text-theme-text-secondary hover:text-theme-text-primary"
          data-testid="poll-change-vote"
          @click="startChanging">
          Change vote
        </button>
        <button
          v-if="voted && poll.allow_change"
          type="button"
          class="text-theme-text-secondary hover:text-theme-text-primary"
          :disabled="busy"
          data-testid="poll-retract"
          @click="retract">
          Retract
        </button>
      </template>
      <template v-if="!pending && open && canEnd && online">
        <button
          v-if="!confirmingEnd"
          type="button"
          class="text-theme-text-secondary hover:text-red-400"
          data-testid="poll-end"
          @click="confirmingEnd = true">
          End poll
        </button>
        <span v-else class="inline-flex items-center gap-2">
          <span class="text-theme-text-secondary">End now?</span>
          <button
            type="button"
            class="font-semibold text-red-400 hover:text-red-300"
            data-testid="poll-end-confirm"
            @click="endPoll">
            End
          </button>
          <button
            type="button"
            class="text-theme-text-secondary hover:text-theme-text-primary"
            @click="confirmingEnd = false">
            Keep
          </button>
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { PhChartBarHorizontal, PhCheck, PhEyeSlash, PhSpinner } from "@phosphor-icons/vue"
import EmojiText from "@/components/common/EmojiText.vue"
import UserAvatar from "@/components/UserAvatar.vue"
import { emojiTextToPlain } from "@/services/emoji"
import { useNow } from "@/composables/useNow"
import { useConnectionStore, useTextChatStore } from "@/stores"
import { formatFullTime } from "@/utils/messageGrouping"
import type { TextPoll, TextPollOption } from "@/types/textChat"

const props = withDefaults(
  defineProps<{
    messageId: string
    poll: TextPoll
    /** May vote (SendMessages in the channel). */
    canVote?: boolean
    /** May end it early: the author or ManageMessages (a UX hint; the
     * server decides). */
    canEnd?: boolean
    /** Not sent yet (outbox). */
    pending?: boolean
  }>(),
  { canVote: true, canEnd: false, pending: false },
)
defineEmits<{ "show-voters": [] }>()

const textChatStore = useTextChatStore()
const connectionStore = useConnectionStore()
const now = useNow()

const online = computed(() => connectionStore.isOnline)
const busy = computed(() => !!textChatStore.pollBusy[props.messageId])
const plainQuestion = computed(() => emojiTextToPlain(props.poll.question))

// Past the due date counts as ended even before the server's closer runs.
const ended = computed(
  () =>
    props.poll.closed || (props.poll.closes_at_ts !== null && now.value >= props.poll.closes_at_ts),
)
const open = computed(() => !ended.value)
const voted = computed(() => props.poll.my_votes.length > 0)
const showResults = computed(() => props.poll.results_visible)

// --- Selecting -----------------------------------------------------------
const changing = ref(false)
const selection = ref<string[]>([])
const selecting = computed(
  () =>
    !props.pending &&
    open.value &&
    props.canVote &&
    online.value &&
    (!voted.value || changing.value),
)
const offlineHint = computed(
  () => !props.pending && open.value && props.canVote && !online.value && !voted.value,
)

// A confirmed vote ends "change vote" mode.
watch(
  () => props.poll.my_votes.join(","),
  () => {
    changing.value = false
    selection.value = [...props.poll.my_votes]
  },
  { immediate: true },
)

function isMine(id: string): boolean {
  return props.poll.my_votes.includes(id)
}
function isPicked(id: string): boolean {
  return selecting.value ? selection.value.includes(id) : isMine(id)
}

const selectionChanged = computed(() => {
  const a = [...selection.value].sort().join(",")
  const b = [...props.poll.my_votes].sort().join(",")
  return a !== b
})

function pick(id: string) {
  if (!selecting.value || busy.value) return
  if (!props.poll.multiple) {
    // Single choice: a tap is the vote.
    if (isMine(id)) {
      changing.value = false
      return
    }
    selection.value = [id]
    textChatStore.votePoll(props.messageId, [id])
    return
  }
  selection.value = selection.value.includes(id)
    ? selection.value.filter((x) => x !== id)
    : [...selection.value, id]
}

function submitSelection() {
  textChatStore.votePoll(props.messageId, [...selection.value])
}

function startChanging() {
  selection.value = [...props.poll.my_votes]
  changing.value = true
}
function stopChanging() {
  selection.value = [...props.poll.my_votes]
  changing.value = false
}

function retract() {
  textChatStore.votePoll(props.messageId, [])
}

const confirmingEnd = ref(false)
function endPoll() {
  confirmingEnd.value = false
  textChatStore.closePoll(props.messageId)
}

// --- Results -------------------------------------------------------------
/** Share of voters who picked this option (sums past 100 % in multiple choice). */
function percent(opt: TextPollOption): number {
  const voters = props.poll.voter_count
  if (!voters || !opt.count) return 0
  return Math.round((opt.count / voters) * 100)
}

const voterText = computed(() => {
  const n = props.poll.voter_count
  return n === 0 ? "No votes yet" : n === 1 ? "1 vote" : `${n} votes`
})

const canShowVoters = computed(
  () => !props.poll.anonymous && showResults.value && props.poll.voter_count > 0,
)

// --- Status --------------------------------------------------------------
function formatLeft(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} days`
}

const statusText = computed(() => {
  if (ended.value) return "Ended"
  const at = props.poll.closes_at_ts
  return at ? `Ends in ${formatLeft(at - now.value)}` : ""
})
const statusTitle = computed(() => {
  const at = props.poll.closed ? props.poll.closed_at_ts : props.poll.closes_at_ts
  return at ? formatFullTime(at) : undefined
})
</script>

<style scoped>
.option-row:disabled {
  opacity: 1;
}
</style>
