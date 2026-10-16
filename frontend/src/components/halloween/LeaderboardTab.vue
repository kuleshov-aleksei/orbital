<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between mb-1">
      <span class="text-sm font-semibold text-theme-text-primary">Top scores</span>
      <button
        type="button"
        class="text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
        @click="load">
        Refresh
      </button>
    </div>

    <p v-if="!halloweenStore.loaded" class="text-sm text-theme-text-muted py-4 text-center">
      Loading scores…
    </p>

    <p
      v-else-if="halloweenStore.leaderboard.length === 0"
      class="text-sm text-theme-text-muted py-4 text-center">
      No scores yet. Be the first to defend a pumpkin!
    </p>

    <div
      v-for="(entry, index) in halloweenStore.leaderboard"
      v-else
      :key="entry.user_id"
      class="flex items-center gap-3 px-3 py-2 rounded-lg bg-theme-bg-secondary"
      :data-testid="`leaderboard-${index}`">
      <span
        class="w-6 text-center font-bold"
        :class="
          index === 0
            ? 'text-yellow-400'
            : index === 1
              ? 'text-slate-300'
              : index === 2
                ? 'text-amber-600'
                : 'text-theme-text-muted'
        ">
        {{ index + 1 }}
      </span>
      <span class="flex-1 text-sm font-medium text-theme-text-primary truncate">
        {{ entry.nickname }}
      </span>
      <span class="text-sm font-semibold text-orange-400">
        {{ entry.best_score.toLocaleString() }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue"
import { useHalloweenStore } from "@/stores"

const halloweenStore = useHalloweenStore()

const load = () => {
  void halloweenStore.fetchLeaderboard()
}

onMounted(load)
</script>
