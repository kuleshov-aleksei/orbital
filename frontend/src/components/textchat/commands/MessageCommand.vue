<template>
  <div class="mt-1" data-testid="command-card" :data-command="command.name">
    <!-- /vrandom: wheel of fortune -->
    <WheelSpin
      v-if="command.name === 'vrandom' && wheelLabels.length"
      :labels="wheelLabels"
      :result-index="wheelIndex"
      :seed="messageId"
      :animate="animate" />

    <!-- /random, /d20 -->
    <div
      v-else-if="command.name === 'random' || command.name === 'd20'"
      class="inline-flex items-center gap-3 rounded-lg border border-theme-border bg-theme-bg-secondary px-3 py-2 max-w-full">
      <PhDiceFive class="w-6 h-6 flex-shrink-0 text-theme-text-muted" />
      <div class="min-w-0">
        <div
          class="text-xl font-bold leading-tight text-theme-text-primary break-words tabular-nums"
          data-testid="command-result">
          {{ resultText }}
        </div>
        <div class="text-xs text-theme-text-muted">{{ detailText }}</div>
      </div>
      <span
        v-if="command.label"
        class="ml-1 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide"
        :class="
          command.label === 'critical_success'
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-red-500/20 text-red-400'
        "
        data-testid="command-label">
        {{ command.label === "critical_success" ? "Critical Success" : "Critical Failure" }}
      </span>
    </div>

    <!-- /remindme: when it fires -->
    <div
      v-else-if="command.name === 'remindme' && command.due_at_ts"
      class="inline-flex items-center gap-2 text-sm text-theme-text-secondary">
      <PhAlarm class="w-4 h-4 flex-shrink-0 text-theme-text-muted" />
      <span>
        Reminder set for
        <time
          class="font-semibold text-theme-text-primary"
          :datetime="new Date(command.due_at_ts).toISOString()"
          :title="formatFullTime(command.due_at_ts)"
          >{{ formatWhen(command.due_at_ts) }}</time
        >
        <span v-if="senderZoneText" class="text-theme-text-muted"> ({{ senderZoneText }})</span>
      </span>
    </div>

    <!-- Fired reminder -->
    <div
      v-else-if="command.name === 'reminder'"
      class="inline-flex items-center gap-2 text-xs text-theme-text-muted">
      <PhAlarm class="w-4 h-4 flex-shrink-0" />
      <span>Reminder for {{ forName }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { PhAlarm, PhDiceFive } from "@phosphor-icons/vue"
import WheelSpin from "./WheelSpin.vue"
import { useUsersStore } from "@/stores"
import { formatFullTime } from "@/utils/messageGrouping"
import type { TextCommand } from "@/types/textChat"

const props = defineProps<{
  command: TextCommand
  messageId: string
  /** The message arrived live: play the wheel spin. */
  animate: boolean
}>()

const usersStore = useUsersStore()

const isOptionPick = computed(
  () => props.command.options?.length && props.command.result_index !== undefined,
)

const resultText = computed(() => {
  const c = props.command
  if (isOptionPick.value) return c.options![c.result_index!]
  return c.result !== undefined ? String(c.result) : "?"
})

const detailText = computed(() => {
  const c = props.command
  if (c.name === "d20") return "d20"
  if (isOptionPick.value) return `out of ${c.options!.length} options`
  return `${c.min} – ${c.max}`
})

// Wheel segments: the options, or every number of a small range.
const wheelLabels = computed<string[]>(() => {
  const c = props.command
  if (c.options?.length) return c.options
  if (c.min === undefined || c.max === undefined) return []
  return Array.from({ length: c.max - c.min + 1 }, (_, i) => String(c.min! + i))
})

const wheelIndex = computed(() => {
  const c = props.command
  if (c.options?.length) return c.result_index ?? 0
  return (c.result ?? c.min ?? 0) - (c.min ?? 0)
})

const WHEN: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}

/** "Thu, 19 Nov, 14:00" in the viewer's zone (with the year if not this one). */
function formatWhen(ts: number, timeZone?: string): string {
  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear()
  return new Date(ts).toLocaleString(undefined, {
    ...WHEN,
    ...(sameYear ? {} : { year: "numeric" }),
    ...(timeZone ? { timeZone } : {}),
  })
}

function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return ""
  }
}

// When the sender was in another zone, also show their local time.
const senderZoneText = computed(() => {
  const { tz, due_at_ts: ts } = props.command
  if (!tz || !ts || tz === viewerZone()) return ""
  try {
    return `${formatWhen(ts, tz)} ${tz}`
  } catch {
    return ""
  }
})

const forName = computed(() =>
  props.command.reminder_for ? `@${usersStore.displayName(props.command.reminder_for)}` : "",
)
</script>
