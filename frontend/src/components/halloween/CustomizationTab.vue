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
          v-if="group.socket !== 'base' && halloweenStore.equipped[group.socket]"
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
          :disabled="item.locked"
          class="relative overflow-hidden px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-colors"
          :class="[
            rarityBorder(item.rarity),
            isSelected(group.socket, item.id)
              ? 'bg-orange-500/10 text-orange-300'
              : 'text-theme-text-secondary hover:text-theme-text-primary',
            item.locked ? 'cursor-not-allowed opacity-80' : '',
          ]"
          :title="item.locked ? `${item.name} — earn it in the Halloween minigame` : item.name"
          :data-testid="`item-${item.id}`"
          @click="selectItem(group.socket, item.id)">
          <span v-if="isSelected(group.socket, item.id)" aria-hidden="true">✓ </span>{{ item.name }}
          <span
            v-if="item.locked"
            class="absolute inset-0 flex items-center justify-center bg-black/35 text-sm"
            aria-hidden="true">
            🔒
          </span>
        </button>

        <span v-if="group.items.length === 0" class="text-xs text-theme-text-muted py-1.5">
          No items yet
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import PumpkinSprite from "./PumpkinSprite.vue"
import { useHalloweenStore } from "@/stores"
import { HALLOWEEN_RARITY_BORDER } from "@/halloween/assets"
import type { HalloweenItem, HalloweenRarity, PumpkinSocket } from "@/halloween/types"

const halloweenStore = useHalloweenStore()

const socketLabels: Record<string, string> = {
  base: "Pumpkin base",
  hat: "Hat",
  eyes: "Eyes",
  mouth: "Smile",
  feet: "Feet",
}

interface GroupItem extends HalloweenItem {
  locked: boolean
}

interface SocketGroup {
  socket: PumpkinSocket
  label: string
  items: GroupItem[]
}

const socketGroups = computed<SocketGroup[]>(() => {
  const groups: SocketGroup[] = (Object.keys(socketLabels) as PumpkinSocket[]).map((socket) => ({
    socket,
    label: socketLabels[socket],
    items: [],
  }))
  // Every catalog entry is shown; locked ones render with a lock overlay and
  // sort after unlocked ones (stable — backend catalog order is kept within
  // each partition).
  for (const item of halloweenStore.catalog) {
    const group = groups.find((g) => g.socket === item.socket)
    if (group) group.items.push({ ...item, locked: !halloweenStore.isUnlocked(item) })
  }
  for (const group of groups) {
    group.items.sort((a, b) => Number(a.locked) - Number(b.locked))
  }
  return groups
})

const rarityBorder = (rarity: string): string =>
  HALLOWEEN_RARITY_BORDER[rarity as HalloweenRarity] ?? "border-theme-border"

const isSelected = (socket: PumpkinSocket, itemId: string): boolean =>
  halloweenStore.equipped[socket] === itemId

const selectItem = (socket: PumpkinSocket, itemId: string) => {
  const item = halloweenStore.catalog.find((i) => i.id === itemId)
  if (item && !halloweenStore.isUnlocked(item)) return
  void halloweenStore.updatePumpkin({ ...halloweenStore.equipped, [socket]: itemId })
}

const unequip = (socket: PumpkinSocket) => {
  const next = { ...halloweenStore.equipped }
  delete next[socket]
  void halloweenStore.updatePumpkin(next)
}
</script>
