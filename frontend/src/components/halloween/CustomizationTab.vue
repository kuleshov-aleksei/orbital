<template>
  <div class="flex flex-col gap-5">
    <!-- Preview -->
    <div class="flex justify-center py-2">
      <PumpkinSprite :equipped="halloweenStore.equipped" :size="120" />
    </div>

    <div v-for="group in socketGroups" :key="group.socket" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <span class="text-sm font-semibold text-theme-text-primary capitalize">
          {{ group.label }}
        </span>
        <button
          v-if="halloweenStore.equipped[group.socket]"
          type="button"
          class="text-xs text-theme-text-muted hover:text-red-400 transition-colors"
          @click="unequip(group.socket)">
          Remove
        </button>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          v-for="item in group.items"
          :key="item.id"
          type="button"
          class="px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors"
          :class="
            halloweenStore.equipped[group.socket] === item.id
              ? 'border-orange-500 bg-orange-500/10 text-orange-400'
              : 'border-theme-border text-theme-text-secondary hover:border-orange-400 hover:text-theme-text-primary'
          "
          :data-testid="`item-${item.id}`"
          @click="selectItem(group.socket, item.id)">
          {{ item.name }}
        </button>

        <span v-if="group.items.length === 0" class="text-xs text-theme-text-muted py-1.5">
          No items earned yet
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import PumpkinSprite from "./PumpkinSprite.vue"
import { useHalloweenStore } from "@/stores"
import type { HalloweenItem, PumpkinSocket } from "@/halloween/types"

const halloweenStore = useHalloweenStore()

const socketLabels: Record<string, string> = {
  hat: "Hat",
  eyes: "Eyes",
  mouth: "Smile",
}

const socketGroups = computed(() => {
  const groups = [
    { socket: "hat" as PumpkinSocket, label: socketLabels.hat, items: [] as HalloweenItem[] },
    { socket: "eyes" as PumpkinSocket, label: socketLabels.eyes, items: [] as HalloweenItem[] },
    { socket: "mouth" as PumpkinSocket, label: socketLabels.mouth, items: [] as HalloweenItem[] },
  ]
  for (const item of halloweenStore.ownedItems) {
    const group = groups.find((g) => g.socket === item.socket)
    if (group) group.items.push(item)
  }
  return groups
})

const selectItem = (socket: PumpkinSocket, itemId: string) => {
  void halloweenStore.updatePumpkin({ ...halloweenStore.equipped, [socket]: itemId })
}

const unequip = (socket: PumpkinSocket) => {
  const next = { ...halloweenStore.equipped }
  delete next[socket]
  void halloweenStore.updatePumpkin(next)
}
</script>
