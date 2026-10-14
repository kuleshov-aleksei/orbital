import { defineStore } from "pinia"
import { computed, ref } from "vue"
import { apiService } from "@/services/api"
import { useUserStore } from "@/stores/user"
import { HALLOWEEN_FREE_BASE_ID } from "@/halloween/assets"
import type {
  BaseLayouts,
  EquippedCustomization,
  HalloweenGameConfig,
  HalloweenItem,
  HalloweenLeaderboardEntry,
} from "@/halloween/types"

function parseEquipped(json: string): EquippedCustomization {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === "object" ? (parsed as EquippedCustomization) : {}
  } catch {
    return {}
  }
}

export const useHalloweenStore = defineStore("halloween", () => {
  const userStore = useUserStore()

  // State
  const config = ref<HalloweenGameConfig | null>(null)
  const catalog = ref<HalloweenItem[]>([])
  const baseLayouts = ref<BaseLayouts>({})
  const ownedItemIds = ref<string[]>([])
  const equipped = ref<EquippedCustomization>({})
  const others = ref<Record<string, EquippedCustomization>>({})
  const leaderboard = ref<HalloweenLeaderboardEntry[]>([])
  const loaded = ref(false)

  // Getters
  const enabled = computed(() => config.value?.enabled ?? false)
  const ownedItems = computed(() =>
    catalog.value.filter((item) => ownedItemIds.value.includes(item.id)),
  )

  // Only the free starter base is equippable without earning it; everything
  // else must be in the rewards ledger (mirrors backend UpdatePumpkin).
  function isUnlocked(item: Pick<HalloweenItem, "id">): boolean {
    return item.id === HALLOWEEN_FREE_BASE_ID || ownedItemIds.value.includes(item.id)
  }

  // Drop locked or unknown ids from an equipped map (one-time self-heal for
  // customizations saved while an item was still free). Local only — the
  // server receives the clean set on the next save.
  function sanitizeEquipped(next: EquippedCustomization): EquippedCustomization {
    const clean: EquippedCustomization = {}
    for (const [socket, itemId] of Object.entries(next)) {
      if (!itemId) continue
      const item = catalog.value.find((i) => i.id === itemId)
      if (item && item.socket === socket && isUnlocked(item)) clean[socket] = itemId
    }
    return clean
  }

  // Actions
  async function fetchConfig() {
    try {
      config.value = await apiService.getHalloweenConfig()
    } catch (error) {
      console.warn("Failed to load halloween config:", error)
    }
  }

  async function fetchState() {
    try {
      const state = await apiService.getHalloweenState()
      ownedItemIds.value = state.owned_items.map((o) => o.item_id)
      catalog.value = state.catalog
      baseLayouts.value = state.base_layouts ?? {}
      equipped.value = sanitizeEquipped(parseEquipped(state.equipped_json))
      loaded.value = true
    } catch (error) {
      console.warn("Failed to load halloween state:", error)
    }
  }

  async function updatePumpkin(next: EquippedCustomization) {
    // Never send locked ids (the server rejects them): strip against the
    // loaded catalog, but pass through untouched when the catalog isn't
    // loaded yet to avoid wiping a valid customization.
    const clean = catalog.value.length ? sanitizeEquipped(next) : next
    equipped.value = clean
    try {
      await apiService.updatePumpkin(JSON.stringify(clean))
    } catch (error) {
      console.warn("Failed to save pumpkin customization:", error)
    }
  }

  async function fetchLeaderboard() {
    try {
      leaderboard.value = await apiService.getHalloweenLeaderboard()
    } catch (error) {
      console.warn("Failed to load halloween leaderboard:", error)
    }
  }

  function handlePumpkinState(data: { user_id?: string; equipped_json?: string }) {
    const userId = data.user_id
    if (!userId || !data.equipped_json) return
    const parsed = parseEquipped(data.equipped_json)
    if (userId === userStore.userId) {
      equipped.value = parsed
    } else {
      others.value = { ...others.value, [userId]: parsed }
    }
  }

  function reset() {
    config.value = null
    catalog.value = []
    baseLayouts.value = {}
    ownedItemIds.value = []
    equipped.value = {}
    others.value = {}
    leaderboard.value = []
    loaded.value = false
  }

  return {
    config,
    catalog,
    baseLayouts,
    ownedItemIds,
    equipped,
    others,
    leaderboard,
    loaded,
    enabled,
    ownedItems,
    isUnlocked,
    fetchConfig,
    fetchState,
    updatePumpkin,
    fetchLeaderboard,
    handlePumpkinState,
    reset,
  }
})
