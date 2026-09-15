<template>
  <div
    class="fixed inset-0 bg-theme-backdrop flex items-center justify-center z-50 p-4"
    data-testid="pumpkin-modal"
    @click.self="$emit('close')">
    <div
      class="modal-panel w-full max-w-lg bg-theme-bg-primary border border-theme-border rounded-2xl shadow-2xl overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-theme-border">
        <div class="flex items-center gap-2">
          <PhPottedPlant class="w-6 h-6 text-orange-500" weight="duotone" />
          <h2 class="text-lg font-bold text-theme-text-primary">Halloween Pumpkin</h2>
        </div>
        <button
          type="button"
          class="p-1.5 rounded-lg hover:bg-theme-bg-secondary transition-colors"
          data-testid="close-pumpkin-modal"
          @click="$emit('close')">
          <PhX class="w-5 h-5 text-theme-text-muted" />
        </button>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-theme-border px-3">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 transition-colors"
          :class="
            activeTab === tab.id
              ? 'border-orange-500 text-theme-text-primary'
              : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
          "
          :data-testid="`tab-${tab.id}`"
          @click="activeTab = tab.id">
          <component :is="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Content -->
      <div class="p-5 max-h-[60vh] overflow-y-auto">
        <DefendTab v-if="activeTab === 'defend'" @play="$emit('play')" />
        <CustomizationTab v-else-if="activeTab === 'customization'" />
        <LeaderboardTab v-else-if="activeTab === 'leaderboard'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { PhPottedPlant, PhX, PhShieldCheck, PhPencilSimple, PhTrophy } from "@phosphor-icons/vue"
import DefendTab from "./DefendTab.vue"
import CustomizationTab from "./CustomizationTab.vue"
import LeaderboardTab from "./LeaderboardTab.vue"

defineEmits<{
  close: []
  play: []
}>()

type TabId = "defend" | "customization" | "leaderboard"

const activeTab = ref<TabId>("defend")

const tabs = [
  { id: "defend" as const, label: "Defend", icon: PhShieldCheck },
  { id: "customization" as const, label: "Customization", icon: PhPencilSimple },
  { id: "leaderboard" as const, label: "Leaderboard", icon: PhTrophy },
]
</script>
