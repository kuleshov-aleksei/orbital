<template>
  <div class="space-y-6">
    <!-- Summary cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div class="text-sm text-gray-400">Total games</div>
        <div class="text-2xl font-bold text-white mt-1">{{ games.length }}</div>
      </div>
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div class="text-sm text-gray-400">Avg score</div>
        <div class="text-2xl font-bold text-white mt-1">{{ avgScore }}</div>
      </div>
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div class="text-sm text-gray-400">Rewards granted</div>
        <div class="text-2xl font-bold text-white mt-1">{{ rewards.length }}</div>
      </div>
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <div class="text-sm text-gray-400">Cheaters flagged</div>
        <div class="text-2xl font-bold text-red-400 mt-1">{{ cheaterCount }}</div>
      </div>
    </div>

    <!-- Analytics charts -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 class="text-sm font-semibold text-white mb-1">Income sources</h3>
        <p class="text-xs text-gray-500 mb-3">Seeds earned from kills vs from Cramer production</p>
        <PieChart
          v-if="incomePie.labels.length"
          :labels="incomePie.labels"
          :values="incomePie.values"
          :colors="incomePie.colors"
          :height="220" />
        <p v-else class="text-gray-500 text-sm py-8 text-center">No games yet</p>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 class="text-sm font-semibold text-white mb-1">Income per game</h3>
        <p class="text-xs text-gray-500 mb-3">
          Kill income vs Cramer income — last {{ perGameIncome.labels.length }} games
        </p>
        <BarChart
          v-if="perGameIncome.datasets[0].data.length"
          :data="perGameIncome"
          :height="220" />
        <p v-else class="text-gray-500 text-sm py-8 text-center">No games yet</p>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 class="text-sm font-semibold text-white mb-1">Slugs killed by type</h3>
        <p class="text-xs text-gray-500 mb-3">Total kills across all games</p>
        <BarChart v-if="killsByTypeData.labels.length" :data="killsByTypeData" :height="220" />
        <p v-else class="text-gray-500 text-sm py-8 text-center">No kills yet</p>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h3 class="text-sm font-semibold text-white mb-1">Scores per game</h3>
        <p class="text-xs text-gray-500 mb-3">Final score of the latest games</p>
        <BarChart v-if="scoresData.labels.length" :data="scoresData" :height="220" />
        <p v-else class="text-gray-500 text-sm py-8 text-center">No games yet</p>
      </div>
    </div>

    <!-- Round history -->
    <div class="bg-gray-800 rounded-lg border border-gray-700">
      <div class="p-4 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-white">Round history</h2>
          <p class="text-sm text-gray-400 mt-1">Every recorded mini-game round</p>
        </div>
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
          :disabled="loading"
          @click="loadAll">
          <span v-if="loading">Loading...</span>
          <span v-else>Refresh</span>
        </button>
      </div>

      <div v-if="games.length === 0" class="p-8 text-center text-gray-400">
        No rounds played yet
      </div>

      <div v-else class="divide-y divide-gray-700">
        <div v-for="game in games" :key="game.id" class="p-4">
          <button
            type="button"
            class="w-full flex items-center justify-between gap-3 text-left"
            @click="toggle(game.id)">
            <div class="flex items-center gap-3 min-w-0">
              <span
                class="px-2 py-0.5 rounded-full text-xs font-semibold"
                :class="
                  game.is_cheater ? 'bg-red-500/15 text-red-400' : 'bg-gray-700 text-gray-300'
                ">
                #{{ game.id }}
              </span>
              <span class="font-medium text-white truncate">{{ game.nickname }}</span>
              <span v-if="game.is_cheater" class="text-xs text-red-400 font-semibold">Cheater</span>
              <span v-if="game.is_incomplete" class="text-xs text-gray-500">Incomplete</span>
            </div>
            <div class="flex items-center gap-4 flex-shrink-0">
              <div class="text-right hidden sm:block">
                <div class="text-sm text-white font-semibold">{{ game.score }} pts</div>
                <div class="text-xs text-gray-500">
                  R{{ game.completed_rounds }} · {{ formatDate(game.created_at) }}
                </div>
              </div>
              <span class="text-gray-500" :class="expanded.has(game.id) ? 'rotate-180' : ''">
                ▾
              </span>
            </div>
          </button>

          <div
            v-if="expanded.has(game.id)"
            class="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <div class="text-xs font-semibold text-gray-400 uppercase mb-2">Spawned pumpkins</div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(count, type) in game.spawned_pumpkins"
                  :key="type"
                  class="text-[11px] px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30">
                  {{ pumpkinName(type) }} ×{{ count }}
                </span>
                <span
                  v-if="!Object.keys(game.spawned_pumpkins).length"
                  class="text-xs text-gray-500">
                  none
                </span>
              </div>
            </div>

            <div>
              <div class="text-xs font-semibold text-gray-400 uppercase mb-2">Kills by type</div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(count, type) in game.kills_by_type"
                  :key="type"
                  class="text-[11px] px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
                  {{ slugName(type) }} ×{{ count }}
                </span>
                <span v-if="!Object.keys(game.kills_by_type).length" class="text-xs text-gray-500">
                  none
                </span>
              </div>
            </div>

            <div>
              <div class="text-xs font-semibold text-gray-400 uppercase mb-2">Used items</div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(count, item) in game.used_items"
                  :key="item"
                  class="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  {{ abilityName(item) }} ×{{ count }}
                </span>
                <span v-if="!Object.keys(game.used_items).length" class="text-xs text-gray-500">
                  none
                </span>
              </div>
            </div>

            <div>
              <div class="text-xs font-semibold text-gray-400 uppercase mb-2">Rewards</div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="r in game.rewards"
                  :key="r.item_id"
                  class="text-[11px] px-2 py-0.5 rounded-full border"
                  :class="rarityClass(r.rarity)">
                  {{ r.name }}
                </span>
                <span v-if="!game.rewards.length" class="text-xs text-gray-500">none</span>
              </div>
            </div>

            <div
              class="sm:col-span-2 lg:col-span-4 text-xs text-gray-400 flex flex-wrap gap-x-6 gap-y-1 mt-1">
              <span
                >Income:
                <span class="text-emerald-400 font-semibold">{{ game.coins_earned }} 🌰</span></span
              >
              <span
                >from kills <span class="text-indigo-300">{{ game.kill_income }}</span></span
              >
              <span
                >from Cramer <span class="text-amber-300">{{ game.cramer_income }}</span></span
              >
              <span
                >spent <span class="text-white">{{ game.coins_spent }}</span></span
              >
              <span
                >kills <span class="text-white">{{ game.kills.length }}</span></span
              >
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Rewards ledger + grant form -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4 lg:col-span-2">
        <h2 class="text-lg font-semibold text-white mb-1">Rewards ledger</h2>
        <p class="text-sm text-gray-400 mb-4">
          Every decoration users have earned, game or admin granted
        </p>

        <div v-if="rewards.length === 0" class="py-8 text-center text-gray-400">
          No rewards granted yet
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-gray-500 text-xs uppercase">
                <th class="pb-2 pr-4">User</th>
                <th class="pb-2 pr-4">Item</th>
                <th class="pb-2 pr-4">Rarity</th>
                <th class="pb-2 pr-4">Socket</th>
                <th class="pb-2 pr-4">Source</th>
                <th class="pb-2">Date</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-700">
              <tr v-for="(r, i) in rewards" :key="`${r.granted_at}-${i}`">
                <td class="py-2 pr-4 text-white">{{ r.nickname }}</td>
                <td class="py-2 pr-4 text-gray-300">{{ r.name }}</td>
                <td class="py-2 pr-4">
                  <span
                    class="text-[11px] px-2 py-0.5 rounded-full border"
                    :class="rarityClass(r.rarity)">
                    {{ r.rarity }}
                  </span>
                </td>
                <td class="py-2 pr-4 text-gray-400">{{ r.socket }}</td>
                <td class="py-2 pr-4">
                  <span
                    class="text-[11px] px-2 py-0.5 rounded-full"
                    :class="
                      r.source === 'admin'
                        ? 'bg-purple-500/15 text-purple-300'
                        : 'bg-gray-700 text-gray-400'
                    ">
                    {{ r.source }}
                  </span>
                </td>
                <td class="py-2 text-gray-400">{{ formatDate(r.granted_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
        <h2 class="text-lg font-semibold text-white mb-1">Grant a reward</h2>
        <p class="text-sm text-gray-400 mb-4">Give any decoration to any user</p>

        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-gray-400 mb-1">User</label>
            <select
              v-model="grantUserId"
              class="w-full bg-gray-900 border border-gray-700 rounded text-sm text-white px-3 py-2">
              <option value="" disabled>Select user...</option>
              <option v-for="u in users" :key="u.id" :value="u.id">
                {{ u.nickname }}{{ u.id === currentUserId ? " (you)" : "" }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-medium text-gray-400 mb-1">Item</label>
            <select
              v-model="grantItemId"
              class="w-full bg-gray-900 border border-gray-700 rounded text-sm text-white px-3 py-2">
              <option value="" disabled>Select item...</option>
              <option v-for="item in items" :key="item.id" :value="item.id">
                {{ item.name }} ({{ item.rarity }} · {{ item.socket }})
              </option>
            </select>
          </div>

          <div v-if="grantError" class="text-xs text-red-400">{{ grantError }}</div>
          <div v-if="grantMessage" class="text-xs text-emerald-400">{{ grantMessage }}</div>

          <button
            type="button"
            class="w-full px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors disabled:opacity-50"
            :disabled="!grantUserId || !grantItemId || granting"
            @click="grantReward">
            <span v-if="granting">Granting...</span>
            <span v-else>Grant item</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import { apiService } from "@/services/api"
import { useUserStore } from "@/stores"
import { storeToRefs } from "pinia"
import type { User } from "@/types"
import type { HalloweenAdminGame, HalloweenAdminReward, HalloweenItem } from "@/halloween/types"
import PieChart from "./PieChart.vue"
import BarChart from "./BarChart.vue"

defineProps<{
  users: User[]
}>()

const userStore = useUserStore()
const { currentUser } = storeToRefs(userStore)
const currentUserId = computed(() => currentUser.value?.id)

const games = ref<HalloweenAdminGame[]>([])
const rewards = ref<HalloweenAdminReward[]>([])
const items = ref<HalloweenItem[]>([])
const loading = ref(false)

const expanded = ref<Set<number>>(new Set())

const grantUserId = ref("")
const grantItemId = ref("")
const granting = ref(false)
const grantError = ref("")
const grantMessage = ref("")

const cheaterCount = computed(() => games.value.filter((g) => g.is_cheater).length)

const avgScore = computed(() => {
  if (!games.value.length) return "—"
  const total = games.value.reduce((sum, g) => sum + g.score, 0)
  return Math.round(total / games.value.length).toString()
})

const toggle = (id: number) => {
  const next = new Set(expanded.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expanded.value = next
}

const loadAll = async () => {
  loading.value = true
  try {
    const [g, r, i] = await Promise.all([
      apiService.getHalloweenAdminGames(),
      apiService.getHalloweenAdminRewards(),
      apiService.getHalloweenAdminItems(),
    ])
    games.value = g
    rewards.value = r
    items.value = i
  } catch (error) {
    console.error("Failed to load halloween admin data:", error)
  } finally {
    loading.value = false
  }
}

const grantReward = async () => {
  if (!grantUserId.value || !grantItemId.value) return
  granting.value = true
  grantError.value = ""
  grantMessage.value = ""
  try {
    const res = await apiService.issueHalloweenReward(grantUserId.value, grantItemId.value)
    grantMessage.value = res.message
    if (res.granted) {
      grantUserId.value = ""
      grantItemId.value = ""
      const r = await apiService.getHalloweenAdminRewards()
      rewards.value = r
    }
  } catch (error) {
    grantError.value = error instanceof Error ? error.message : "Failed to grant reward"
  } finally {
    granting.value = false
  }
}

const formatDate = (dateStr: string): string => {
  if (!dateStr) return ""
  return new Date(dateStr).toLocaleString()
}

const pumpkinName = (type: string): string => {
  const names: Record<string, string> = {
    ferdinand: "Ferdinand",
    chunky: "Chunky",
    herbert: "Herbert",
    gwynevere: "Gwynevere",
    cramer: "Cramer",
  }
  return names[type] ?? type
}

const slugName = (type: string): string => {
  const names: Record<string, string> = {
    scout: "Scout",
    marvin: "Marvin",
    gerald: "Gerald",
    dell: "Dr. Dell",
  }
  return names[type] ?? type
}

const abilityName = (id: string): string => {
  const names: Record<string, string> = {
    annihilation: "Annihilation",
    holy_grenade: "Holy grenade",
    beer: "Beer puddle",
    salt_line: "Salt line",
    tailwind: "Tailwind",
  }
  return names[id] ?? id
}

const rarityClass = (rarity: string): string => {
  switch (rarity) {
    case "rare":
      return "bg-purple-500/15 text-purple-300 border-purple-500/30"
    case "uncommon":
      return "bg-green-500/15 text-green-300 border-green-500/30"
    case "common":
      return "bg-blue-500/15 text-blue-300 border-blue-500/30"
    case "regular":
    default:
      return "bg-gray-700 text-gray-300 border-gray-600"
  }
}

const incomePie = computed(() => {
  const kills = games.value.reduce((sum, g) => sum + g.kill_income, 0)
  const cramer = games.value.reduce((sum, g) => sum + g.cramer_income, 0)
  if (kills === 0 && cramer === 0)
    return { labels: [] as string[], values: [] as number[], colors: [] as string[] }
  return {
    labels: ["Kills", "Cramer"],
    values: [kills, cramer],
    colors: ["#6366f1", "#f59e0b"],
  }
})

const lastGames = computed(() => games.value.slice(0, 12).reverse())

const perGameIncome = computed(() => {
  const labels = lastGames.value.map((g) => `#${g.id}`)
  return {
    labels,
    datasets: [
      {
        label: "Kills",
        data: lastGames.value.map((g) => g.kill_income),
        backgroundColor: "#6366f1",
      },
      {
        label: "Cramer",
        data: lastGames.value.map((g) => g.cramer_income),
        backgroundColor: "#f59e0b",
      },
    ],
  }
})

const killsByTypeData = computed(() => {
  const types = ["scout", "marvin", "gerald", "dell"]
  const labels = types.map(slugName)
  const data = types.map((t) => games.value.reduce((sum, g) => sum + (g.kills_by_type[t] ?? 0), 0))
  return {
    labels,
    datasets: [{ label: "Kills", data, backgroundColor: "#fbbf24" }],
  }
})

const scoresData = computed(() => {
  const labels = lastGames.value.map((g) => `#${g.id}`)
  return {
    labels,
    datasets: [
      { label: "Score", data: lastGames.value.map((g) => g.score), backgroundColor: "#a78bfa" },
    ],
  }
})

onMounted(() => {
  void loadAll()
})
</script>
