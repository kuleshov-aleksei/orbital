<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex flex-col bg-theme-backdrop/95 backdrop-blur-md"
      data-testid="mini-game">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-theme-border">
        <div class="flex items-center gap-4 text-sm">
          <span class="font-bold text-theme-text-primary">Mini Game</span>
          <span class="text-theme-text-secondary">Round {{ hud?.round ?? 1 }}</span>
          <span class="text-theme-text-secondary">Score: {{ hud?.score ?? 0 }}</span>
          <span class="text-theme-text-secondary"
            >Pumpkins: {{ engine?.alivePumpkinCount() ?? 0 }}</span
          >
          <span class="text-theme-text-secondary">Slugs: {{ engine?.aliveSlugCount() ?? 0 }}</span>
          <span class="flex items-center gap-1 text-theme-text-secondary">
            <span aria-hidden="true">🌰</span>
            {{ hud?.coins ?? 0 }}
          </span>
          <span
            class="flex items-center gap-1 text-theme-text-secondary"
            title="XP for leveling up pumpkins">
            <span aria-hidden="true">✨</span>
            {{ hud?.xp ?? 0 }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <div
            class="flex items-center gap-1 rounded-lg bg-theme-bg-secondary border border-theme-border p-0.5"
            data-testid="speed-controls">
            <button
              v-for="o in SPEED_OPTIONS"
              :key="o.label"
              type="button"
              class="px-2.5 py-1 rounded-md text-xs font-bold transition-colors"
              :class="
                speedLabel === o.label
                  ? 'bg-orange-500 text-white'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              "
              :data-testid="`speed-${o.label}`"
              @click="speedLabel = o.label">
              {{ o.label }}x
            </button>
          </div>
          <button
            v-if="!isEnded"
            type="button"
            class="px-4 py-1.5 rounded-lg bg-theme-bg-secondary border border-theme-border text-theme-text-primary text-sm font-semibold hover:bg-theme-bg-tertiary transition-colors"
            data-testid="end-game-button"
            @click="endGame">
            End Game
          </button>
        </div>
      </div>

      <!-- Battlefield -->
      <div
        ref="canvasEl"
        class="relative flex-1 min-h-0"
        data-testid="game-canvas"
        @pointermove="onFieldPointerMove"
        @pointerleave="onFieldPointerLeave">
        <!-- Pumpkin hover tooltip (absolute → positioned against this wrapper) -->
        <div
          v-if="hoverInfo"
          ref="tooltipElement"
          class="absolute z-10 w-60 rounded-xl bg-theme-bg-secondary border border-theme-border shadow-2xl p-3"
          :style="tooltipStyle"
          data-testid="pumpkin-tooltip">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-theme-text-primary text-sm">{{ hoverInfo.name }}</span>
            <span class="text-[10px] uppercase tracking-wide text-theme-text-muted">{{
              hoverInfo.type
            }}</span>
          </div>
          <div class="mt-1 text-[11px] font-bold text-amber-400" data-testid="pumpkin-level">
            Level {{ hoverInfo.level }} {{ levelPips(hoverInfo.level) }}
          </div>
          <p class="text-[11px] text-theme-text-muted mt-1 leading-snug">
            {{ hoverInfo.description }}
          </p>
          <div v-if="hoverInfo.buffs.length" class="flex flex-wrap gap-1 mt-2">
            <span
              v-for="buff in hoverInfo.buffs"
              :key="buff"
              class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30">
              {{ buff }}
            </span>
          </div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[11px]">
            <template v-for="stat in hoverInfo.stats" :key="stat.label">
              <span class="text-theme-text-muted">{{ stat.label }}</span>
              <span class="text-right text-theme-text-primary font-semibold">
                {{ stat.value }}
                <template v-if="stat.next">
                  <span class="text-theme-text-muted font-normal"> → </span>
                  <span class="text-emerald-400 font-bold">{{ stat.next }}</span>
                </template>
              </span>
            </template>
          </div>
          <button
            v-if="hoverInfo.levelCost != null && hud?.phase === 'playing'"
            type="button"
            class="mt-2.5 w-full py-1.5 rounded-lg text-xs font-bold border transition-colors"
            :class="
              hoverInfo.canLevelUp
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                : 'bg-theme-bg-tertiary text-theme-text-muted border-theme-border cursor-not-allowed'
            "
            :disabled="!hoverInfo.canLevelUp"
            data-testid="levelup-pumpkin"
            @click="levelUpPumpkin(hoverInfo.id)">
            Level up ({{ hoverInfo.levelCost }} ✨)
          </button>
          <div
            v-else-if="hud?.phase === 'playing'"
            class="mt-2.5 w-full py-1 text-center text-[11px] font-bold text-amber-400/80">
            MAX LEVEL
          </div>
          <button
            v-if="hud?.phase === 'playing'"
            type="button"
            class="mt-2.5 w-full py-1.5 rounded-lg text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
            data-testid="sell-pumpkin"
            @click="sellPumpkin(hoverInfo.id)">
            Sell for {{ hoverInfo.refund }} 🌰
          </button>
        </div>
      </div>

      <!-- Prompt -->
      <div v-if="hud?.prompt" class="px-5 py-1.5 text-center text-xs text-theme-text-muted">
        {{ hud.prompt }}
      </div>

      <!-- Shop + Inventory -->
      <div
        class="px-5 py-3 border-t border-theme-border flex items-stretch gap-3 justify-center"
        data-testid="game-bottom-bar">
        <!-- Shop -->
        <div
          class="relative flex flex-col items-center gap-2 rounded-xl bg-theme-bg-secondary border border-theme-border p-2"
          data-testid="game-shop"
          @pointerleave="onShopPointerLeave">
          <span
            class="flex items-center gap-1 text-xs font-bold text-theme-text-primary"
            data-testid="seeds-counter">
            <span aria-hidden="true">🌰</span>
            {{ hud?.coins ?? 0 }} seeds
          </span>
          <div class="flex items-center gap-1.5">
            <button
              v-for="item in shopItems"
              :key="item.type"
              type="button"
              class="w-14 h-14 rounded-xl border flex flex-col items-center justify-center transition-colors"
              :class="[
                canBuy(item)
                  ? 'bg-theme-bg-primary border-theme-border hover:bg-theme-bg-tertiary cursor-pointer'
                  : 'bg-theme-bg-primary border-theme-border/50 cursor-not-allowed opacity-60',
              ]"
              :data-testid="`shop-${item.type}`"
              :aria-disabled="!canBuy(item)"
              @pointerenter="(e: PointerEvent) => onShopPointerEnter(e, item.type)"
              @pointermove="onShopPointerMove"
              @focus="hoveredShopType = item.type"
              @blur="hoveredShopType = null"
              @click="buy(item.type)">
              <span class="text-xl leading-none text-orange-400">{{
                PUMPKIN_ICONS[item.type] ?? "P"
              }}</span>
              <span class="text-[10px] mt-1 text-theme-text-muted font-semibold"
                >{{ item.cost }} 🌰</span
              >
            </button>
          </div>
          <!-- Custom shop tooltip — same card style as the field pumpkin tooltip,
               follows the cursor -->
          <div
            v-if="shopHoverInfo"
            class="fixed z-50 w-60 rounded-xl bg-theme-bg-secondary border border-theme-border shadow-2xl p-3 pointer-events-none"
            :style="shopTooltipStyle"
            data-testid="shop-tooltip"
            role="tooltip">
            <div class="flex items-center justify-between gap-2">
              <span class="font-bold text-theme-text-primary text-sm">{{
                shopHoverInfo.name
              }}</span>
              <span class="text-[10px] uppercase tracking-wide text-theme-text-muted">{{
                shopHoverInfo.type
              }}</span>
            </div>
            <p class="text-[11px] text-theme-text-muted mt-1 leading-snug">
              {{ shopHoverInfo.description }}
            </p>
            <div class="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[11px]">
              <template v-for="stat in shopHoverInfo.stats" :key="stat.label">
                <span class="text-theme-text-muted">{{ stat.label }}</span>
                <span class="text-right text-theme-text-primary font-semibold">{{
                  stat.value
                }}</span>
              </template>
            </div>
            <div
              class="mt-2.5 w-full py-1.5 rounded-lg text-xs font-bold text-center bg-orange-500/15 text-orange-400 border border-orange-500/30">
              {{ shopHoverInfo.cost }} 🌰
            </div>
          </div>
        </div>

        <!-- Inventory -->
        <div class="flex items-center gap-2" data-testid="game-inventory">
          <button
            v-for="(item, index) in inventorySlots"
            :key="index"
            type="button"
            class="w-14 h-14 rounded-xl border flex flex-col items-center justify-center transition-colors"
            :class="[
              item
                ? 'bg-theme-bg-secondary border-theme-border hover:bg-theme-bg-tertiary cursor-pointer'
                : 'bg-theme-bg-primary border-theme-border/50 cursor-default',
              hud?.mode === 'place-pumpkin' && hud?.selectedInventoryIndex === index
                ? 'ring-2 ring-orange-500'
                : '',
              item?.kind === 'ability' && hud?.selectedInventoryIndex === index
                ? 'ring-2 ring-orange-500'
                : '',
            ]"
            :data-testid="`inventory-slot-${index}`"
            :title="item ? itemLabel(item) : 'Empty slot'"
            :disabled="!item"
            @click="item && selectItem(index)">
            <template v-if="item">
              <span
                class="text-xl leading-none"
                :class="item.kind === 'ability' ? '' : 'text-orange-400'">
                {{ itemIcon(item) }}
              </span>
              <span class="text-[10px] mt-1 text-theme-text-muted font-semibold">{{
                itemLabel(item)
              }}</span>
            </template>
            <span v-else class="text-theme-text-muted/40">—</span>
          </button>
        </div>
      </div>

      <!-- Card popup -->
      <div
        v-if="hud?.phase === 'cards' && hud.cards"
        class="absolute inset-0 flex items-center justify-center bg-black/60 p-6"
        data-testid="card-popup">
        <div
          class="modal-panel w-full max-w-2xl bg-theme-bg-primary border border-theme-border rounded-2xl shadow-2xl p-6">
          <h3 class="text-lg font-bold text-theme-text-primary text-center">
            Round {{ hud.completedRounds }} complete!
          </h3>
          <p class="text-sm text-theme-text-muted text-center mt-1">
            Choose a reward ({{ hud.popupIndex + 1 }} / {{ hud.popupTotal }})
          </p>
          <div class="grid grid-cols-3 gap-4 mt-5">
            <button
              v-for="(card, i) in hud.cards.cards"
              :key="i"
              type="button"
              class="relative overflow-hidden rounded-xl border-2 transition-transform hover:scale-105"
              :class="
                card.kind === 'pumpkin'
                  ? 'border-orange-500/70 hover:border-orange-400'
                  : 'border-purple-500/70 hover:border-purple-400'
              "
              :data-testid="`card-${i}`"
              @click="engine?.pickCard(i)">
              <img
                src="/assets/hw26/cards/card_A.png"
                alt="card"
                class="w-full h-40 object-cover" />
              <div
                class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/35">
                <img
                  :src="
                    card.kind === 'pumpkin'
                      ? '/assets/hw26/pumkins/pumkin_A.png'
                      : '/assets/hw26/items/item_A.png'
                  "
                  :class="
                    card.kind === 'pumpkin'
                      ? 'w-16 h-16 object-contain'
                      : 'w-12 h-12 object-contain'
                  "
                  alt="reward" />
                <div class="font-bold text-sm text-white drop-shadow">
                  {{ card.kind === "pumpkin" ? card.pumpkinType : cardLabel(card.abilityId) }}
                </div>
                <div
                  class="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
                  :class="
                    card.kind === 'pumpkin'
                      ? 'bg-orange-500/80 text-white'
                      : 'bg-purple-500/80 text-white'
                  ">
                  {{ card.kind === "pumpkin" ? "Pumpkin" : "Ability" }}
                </div>
              </div>
            </button>
          </div>
          <button
            type="button"
            class="mt-5 w-full py-2 rounded-lg text-sm text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-bg-secondary transition-colors"
            data-testid="skip-cards"
            @click="engine?.pickCard(-1)">
            Skip
          </button>
        </div>
      </div>

      <!-- Result / game over -->
      <div
        v-if="isEnded"
        class="absolute inset-0 flex items-center justify-center bg-black/70 p-6"
        data-testid="game-result">
        <div
          class="modal-panel w-full max-w-md bg-theme-bg-primary border border-theme-border rounded-2xl shadow-2xl p-6 text-center">
          <h3 class="text-xl font-bold text-theme-text-primary">{{ resultTitle }}</h3>
          <p class="text-sm text-theme-text-secondary mt-1">{{ hud?.gameOverReason }}</p>
          <div class="grid grid-cols-2 gap-3 mt-5">
            <div class="rounded-xl bg-theme-bg-secondary p-3">
              <div class="text-2xl font-bold text-orange-500">{{ hud?.score ?? 0 }}</div>
              <div class="text-xs text-theme-text-muted mt-1">Score</div>
            </div>
            <div class="rounded-xl bg-theme-bg-secondary p-3">
              <div class="text-2xl font-bold text-theme-text-primary">
                {{ hud?.completedRounds ?? 0 }}
              </div>
              <div class="text-xs text-theme-text-muted mt-1">Rounds</div>
            </div>
          </div>
          <div class="mt-4 text-sm text-theme-text-secondary">
            <template v-if="result">
              <template v-if="(result.granted ?? []).length > 0">
                Earned: {{ (result.granted ?? []).join(", ") }}
              </template>
              <template v-else>{{ result.message }}</template>
            </template>
            <span v-else class="text-theme-text-muted">Submitting report…</span>
          </div>
          <button
            type="button"
            class="mt-5 w-full py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold transition-colors"
            data-testid="close-game"
            @click="$emit('exit')">
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from "vue"
import { apiService, getAuthToken, BACKEND_BASE } from "@/services/api"
import { useSounds } from "@/services/sounds"
import { useHalloweenStore } from "@/stores"
import type { SubmitGameReportResponse } from "@/halloween/types"
import { HalloweenGameEngine } from "@/halloween/game/engine"
import { createMiniGameRenderer } from "@/halloween/game/renderer"
import {
  ABILITY_META,
  MAX_PUMPKIN_LEVEL,
  PUMPKIN_META,
  levelStatsFor,
} from "@/halloween/game/balance"
import type {
  GameInventoryItem,
  GamePumpkin,
  GameSnapshot,
  PumpkinType,
} from "@/halloween/game/types"

defineEmits<{
  exit: []
}>()

const halloweenStore = useHalloweenStore()
const sounds = useSounds()

const canvasEl = useTemplateRef<HTMLElement>("canvasEl")
let engine: HalloweenGameEngine | null = null
let renderer: ReturnType<typeof createMiniGameRenderer> | null = null
let raf = 0
let last = performance.now()

const hud = shallowRef<GameSnapshot | null>(null)
const result = ref<SubmitGameReportResponse | null>(null)
const submitting = ref(false)
// Visual labels stay 1x/2x/3x; actual multipliers are 2x/4x/6x so the game
// starts twice as fast as before (label 1x = 2x sim speed).
const SPEED_OPTIONS = [
  { label: 1, mult: 2 },
  { label: 2, mult: 4 },
  { label: 3, mult: 6 },
] as const
const speedLabel = ref<number>(1)
const speedMult = computed(() => SPEED_OPTIONS.find((o) => o.label === speedLabel.value)?.mult ?? 2)

const hoveredPumpkin = ref<GamePumpkin | null>(null)
const hoveredShopType = ref<PumpkinType | null>(null)
// Cursor position for the pointer-following shop tooltip (viewport coords).
const shopTooltipPos = ref<{ x: number; y: number } | null>(null)
const tooltipElement = useTemplateRef<HTMLDivElement>("tooltipElement")

function onShopPointerEnter(e: PointerEvent, type: PumpkinType) {
  hoveredShopType.value = type
  shopTooltipPos.value = { x: e.clientX, y: e.clientY }
}

function onShopPointerMove(e: PointerEvent) {
  if (hoveredShopType.value) shopTooltipPos.value = { x: e.clientX, y: e.clientY }
}

function onShopPointerLeave() {
  hoveredShopType.value = null
  shopTooltipPos.value = null
}

interface TooltipStat {
  label: string
  value: string
  next?: string // improved value at the next level — rendered with accent
}

interface PumpkinHoverInfo {
  id: number
  x: number
  y: number
  type: PumpkinType
  name: string
  description: string
  stats: TooltipStat[]
  buffs: string[]
  refund: number
  level: number
  levelCost: number | null // XP price of the next level; null when maxed
  canLevelUp: boolean
}

// fmtInterval renders a fire rate as a shot interval ("Every 1.00s"),
// matching the shop tooltip style.
function fmtInterval(ratePerSec: number): string {
  if (!Number.isFinite(ratePerSec) || ratePerSec <= 0) return "—"
  return `${(1 / ratePerSec).toFixed(ratePerSec >= 1 ? 1 : 2)}s`
}

const hoverInfo = computed<PumpkinHoverInfo | null>(() => {
  const p = hoveredPumpkin.value
  const config = halloweenStore.config
  if (!p || !config) return null
  // Hide while the player is aiming a placement — the tooltip would cover the
  // placement cell highlight and get in the way.
  if (hud.value?.mode === "place-pumpkin") return null
  const meta = PUMPKIN_META[p.type]
  const cfg = config.pumpkins[p.type]
  // Level-aware base health: a leveled pumpkin's bigger max HP is not a
  // wide_pumpkin buff, so only max HP above the *current level's* base earns
  // the badge.
  const baseHealth = levelStatsFor(p.type, p.level, config)?.health ?? cfg?.health ?? p.maxHealth
  // fireInterval already encodes fireRateMul (daddy halves the interval AND
  // bumps the multiplier; level-ups divide by it) — so the live rate is
  // simply 1/interval. Dividing by the multiplier again would double-count
  // buffs and make level-ups look like downgrades.
  const ratePerSec = Number.isFinite(p.fireInterval) && p.fireInterval > 0 ? 1 / p.fireInterval : 0
  const buffs: string[] = []
  if (p.fireRateMul > 1) buffs.push(`Fire rate ×${p.fireRateMul}`)
  if (p.maxHealth > baseHealth) buffs.push("Health ×2")

  // Next-level preview for the improvement diff (null when maxed or dead).
  const preview = engine?.levelUpPreview(p.id) ?? null
  const next = preview?.stats ?? null
  const nextRate = next && next.fireRate > 0 ? next.fireRate * p.fireRateMul : 0
  const improved = <T,>(cur: T, nxt: T): string | undefined =>
    next && nxt !== cur ? `${nxt}` : undefined

  // Per-type stats: combat pumpkins show damage, Herbert shows healing,
  // Cramer shows seed production, and Chunky is pure HP. Rows that improve
  // on level-up carry `next`, rendered as "current → next" with accent.
  // wide_pumpkin doubles max HP, so the previewed max keeps that multiplier.
  const buffMul = baseHealth > 0 ? p.maxHealth / baseHealth : 1
  const nextMax = next ? Math.round(next.health * buffMul) : 0
  const stats: TooltipStat[] = [
    {
      label: "Health",
      value: `${Math.ceil(p.health)} / ${Math.ceil(p.maxHealth)}`,
      next: next && nextMax !== Math.ceil(p.maxHealth) ? `${nextMax}` : undefined,
    },
  ]
  if (p.type === "cramer") {
    const coinStats = levelStatsFor(p.type, p.level, config)
    const curInterval = coinStats?.coin_interval_s ?? cfg?.coin_interval_s ?? 0
    const perMin = curInterval > 0 ? ((coinStats?.coins_per_tick ?? 0) / curInterval) * 60 : 0
    stats.push({ label: "Seeds / min", value: `${Math.round(perMin)}` })
    if (next && next.coinInterval > 0) {
      stats.push({
        label: "Seeds every",
        value: `${curInterval}s`,
        next: next.coinInterval !== curInterval ? `${next.coinInterval}s` : undefined,
      })
    }
  } else if (p.type === "herbert") {
    // Herbert's heal amount never scales (nerfed) — only the interval does,
    // so Heal / shot intentionally has no `next`.
    stats.push({ label: "Heal / shot", value: `${p.damage}` })
    stats.push({
      label: "Heal every",
      value: fmtInterval(ratePerSec),
      next: nextRate > 0 && nextRate !== ratePerSec ? fmtInterval(nextRate) : undefined,
    })
  } else if (p.type === "chunky") {
    stats.push({ label: "Role", value: "Tank" })
  } else {
    stats.push({
      label: "Damage / shot",
      value: `${p.damage}`,
      next: improved(p.damage, next?.damage ?? p.damage),
    })
    stats.push({
      label: "Every",
      value: fmtInterval(ratePerSec),
      next: nextRate > 0 && nextRate !== ratePerSec ? fmtInterval(nextRate) : undefined,
    })
    if (p.type === "gwynevere" && next && next.blastRadius !== p.blastRadius) {
      stats.push({ label: "Blast", value: `${p.blastRadius}`, next: `${next.blastRadius}` })
    }
  }

  const levelCost = preview?.cost ?? null
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    type: p.type,
    name: meta?.name ?? p.type,
    description: meta?.description ?? "",
    buffs,
    stats,
    refund: Math.floor((cfg?.cost ?? 0) * 0.5),
    level: p.level,
    levelCost,
    canLevelUp:
      hud.value?.phase === "playing" && levelCost != null && (hud.value?.xp ?? 0) >= levelCost,
  }
})

// The tooltip is anchored to the pumpkin (frozen), not following the cursor,
// so its Sell button is always reachable. Boundaries are clamped like the
// other tooltips in the app (see ParticipantCard).
const tooltipStyle = computed(() => {
  const info = hoverInfo.value
  const el = canvasEl.value
  if (!info || !el || !renderer) return {}
  const rect = el.getBoundingClientRect()
  const screen = renderer.worldToScreen(info.x, info.y)
  const tooltipWidth = 240 // w-60
  const tooltipHeight = tooltipElement.value?.offsetHeight || 220
  const padding = 8
  const margin = 14
  let left = screen.x - tooltipWidth / 2
  left = Math.max(padding, Math.min(left, rect.width - tooltipWidth - padding))
  let top = screen.y - margin - tooltipHeight
  if (top < padding) top = screen.y + margin
  top = Math.max(padding, Math.min(top, rect.height - tooltipHeight - padding))
  return { left: `${left}px`, top: `${top}px` }
})

function onFieldPointerMove(e: PointerEvent) {
  // Keep the hover frozen while the pointer is over the tooltip (so the Sell
  // button stays clickable) or in the narrow strip between the pumpkin and
  // the tooltip (so the cursor can actually travel up to it).
  const tooltipEl = tooltipElement.value
  const info = hoverInfo.value
  const el = canvasEl.value
  const render = renderer
  if (tooltipEl && info && el && render) {
    const r = tooltipEl.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const s = render.worldToScreen(info.x, info.y)
    const sx = elRect.left + s.x
    const sy = elRect.top + s.y
    const overTooltip =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    const overBridge =
      e.clientX >= sx - 50 &&
      e.clientX <= sx + 50 &&
      e.clientY >= Math.min(r.top, sy) &&
      e.clientY <= sy + 10
    if (overTooltip || overBridge) return
  }
  const world = render?.screenToWorld(e.clientX, e.clientY)
  if (world) engine?.setHover(world.x, world.y)
  else engine?.clearHover()
}

function onFieldPointerLeave() {
  engine?.clearHover()
}

const isEnded = computed(() => hud.value?.phase === "gameover" || hud.value?.phase === "ended")
const resultTitle = computed(() => (hud.value?.phase === "gameover" ? "Game Over" : "Battle Ended"))

const INVENTORY_SLOTS = 6
const inventorySlots = computed<Array<GameInventoryItem | null>>(() => {
  const items = hud.value?.inventory ?? []
  return Array.from({ length: INVENTORY_SLOTS }, (_, i) => items[i] ?? null)
})

const PUMPKIN_ICONS: Record<string, string> = {
  ferdinand: "F",
  chunky: "C",
  herbert: "H",
  gwynevere: "G",
  cramer: "🌰",
  pearcer: "P",
}

const ABILITY_ICONS: Record<string, string> = {
  annihilation: "A",
  freeze: "❄",
  distraction: "↺",
  do_not_stop_daddy: "D",
  wide_pumpkin: "W",
  holy_grenade: "G",
  beer: "🍺",
  salt_line: "🧂",
  tailwind: "💨",
  seed_rain: "🌱",
  thorn_patch: "🌵",
}

function itemIcon(item: GameInventoryItem): string {
  if (item.kind === "pumpkin") return PUMPKIN_ICONS[item.pumpkinType] ?? "P"
  return ABILITY_ICONS[item.abilityId] ?? "?"
}

function itemLabel(item: GameInventoryItem): string {
  if (item.kind === "pumpkin") return item.pumpkinType
  return cardLabel(item.abilityId)
}

function cardLabel(abilityId: string): string {
  return ABILITY_META[abilityId as keyof typeof ABILITY_META]?.name ?? abilityId
}

function selectItem(index: number) {
  engine?.selectInventoryItem(index)
}

const shopItems = computed(() => {
  const cfg = halloweenStore.config
  if (!cfg) return []
  const prices = hud.value?.shopPrices
  return (Object.keys(cfg.pumpkins) as PumpkinType[])
    .filter((type) => !cfg.pumpkins[type].draft_only)
    .map((type) => ({
      type,
      cost: prices?.[type] ?? cfg.pumpkins[type].cost,
    }))
})

function canBuy(item: { type: PumpkinType; cost: number }): boolean {
  return hud.value?.phase === "playing" && (hud.value?.coins ?? 0) >= item.cost
}

interface ShopHoverInfo {
  type: PumpkinType
  name: string
  description: string
  stats: { label: string; value: string }[]
  cost: number
}

// Custom shop tooltip — same card content/style as the field pumpkin tooltip
// (name, description, per-type stats, cost), driven by live inflated prices.
// Replaces the native `title` tooltip which can't render structured stats.
const shopHoverInfo = computed<ShopHoverInfo | null>(() => {
  const type = hoveredShopType.value
  const cfg = type ? halloweenStore.config?.pumpkins[type] : undefined
  if (!type || !cfg) return null
  const meta = PUMPKIN_META[type]
  const prices = hud.value?.shopPrices
  const stats: { label: string; value: string }[] = [{ label: "Health", value: `${cfg.health}` }]
  if (type === "cramer") {
    if (cfg.coins_per_tick > 0) {
      stats.push({ label: "Seeds", value: `${cfg.coins_per_tick} / ${cfg.coin_interval_s}s` })
    }
  } else if (type === "herbert") {
    stats.push({ label: "Heal / shot", value: `${cfg.damage_per_shot}` })
    if (cfg.fire_rate > 0) {
      stats.push({
        label: "Every",
        value: `${(1 / cfg.fire_rate).toFixed(cfg.fire_rate >= 1 ? 1 : 2)}s`,
      })
    }
  } else if (type === "chunky") {
    stats.push({ label: "Role", value: "Tank" })
  } else if (cfg.fire_rate > 0) {
    stats.push({ label: "Damage / shot", value: `${cfg.damage_per_shot}` })
    stats.push({
      label: "Every",
      value: `${(1 / cfg.fire_rate).toFixed(cfg.fire_rate >= 1 ? 1 : 2)}s`,
    })
  }
  return {
    type,
    name: meta?.name ?? type,
    description: meta?.description ?? "",
    stats,
    cost: prices?.[type] ?? cfg.cost,
  }
})

// Pointer-following position for the shop tooltip: floats just above-right
// of the cursor, clamped to the viewport so it never clips off-screen.
const shopTooltipStyle = computed(() => {
  const pos = shopTooltipPos.value
  if (!pos) return {}
  const tooltipWidth = 240 // w-60
  const offsetX = 16
  const offsetY = 12
  const padding = 8
  const maxX = window.innerWidth - tooltipWidth - padding
  const left = Math.max(padding, Math.min(pos.x + offsetX, maxX))
  // Shown above the cursor so it doesn't cover the shop button.
  return {
    left: `${left}px`,
    top: `${Math.max(padding, pos.y - offsetY)}px`,
    transform: "translateY(-100%)",
  }
})

function buy(type: PumpkinType) {
  engine?.buyPumpkin(type)
}

function sellPumpkin(id: number) {
  engine?.sellPumpkin(id)
}

function levelUpPumpkin(id: number) {
  engine?.levelUpPumpkin(id)
}

// levelPips renders the level as filled/empty diamonds (◆◆◇).
function levelPips(level: number): string {
  return Array.from({ length: MAX_PUMPKIN_LEVEL }, (_, i) => (i < level ? "◆" : "◇")).join("")
}

async function submitReport(isIncomplete: boolean) {
  if (!engine || engine.wasReportSubmitted || submitting.value) return
  submitting.value = true
  engine.markReportSubmitted()
  const report = engine.buildReport(isIncomplete)
  try {
    result.value = await apiService.submitHalloweenGame(report)
  } catch (error) {
    result.value = {
      game_id: 0,
      score: report.score,
      is_cheater: false,
      granted: [],
      message: `Failed to submit: ${(error as Error).message}`,
    }
  } finally {
    submitting.value = false
  }
}

function endGame() {
  if (!engine) return
  engine.endGame()
  void submitReport(false)
}

function submitIncompleteBeacon() {
  if (!engine || engine.wasReportSubmitted) return
  engine.markReportSubmitted()
  const report = engine.buildReport(true)
  const base = `${BACKEND_BASE}/api`
  const token = getAuthToken()
  void fetch(`${base}/halloween/game/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {})
}

const tick = (now: number) => {
  const dt = Math.min((now - last) / 1000, 0.05)
  last = now
  if (engine) {
    engine.update(dt * speedMult.value)
    renderer?.sync()
    hud.value = engine.snapshot()
    hoveredPumpkin.value = engine.hoveredPumpkin ? { ...engine.hoveredPumpkin } : null
  }
  raf = requestAnimationFrame(tick)
}

const onBeforeUnload = () => submitIncompleteBeacon()

onMounted(async () => {
  const config = halloweenStore.config
  if (!config) {
    hud.value = {
      phase: "ended",
      round: 1,
      completedRounds: 0,
      score: 0,
      coins: 0,
      xp: 0,
      shopPrices: {},
      inventory: [],
      cards: null,
      popupIndex: 0,
      popupTotal: 0,
      mode: "none",
      pendingAbility: null,
      selectedInventoryIndex: null,
      prompt: null,
      gameOverReason: "Game config unavailable",
    } as GameSnapshot
    return
  }

  engine = new HalloweenGameEngine(config)
  engine.onEvent = (event) => {
    if (event === "shooting") sounds.playShooting()
    else if (event === "slug_destroyed") sounds.playSlugDestroyed()
    else if (event === "pumpkin_destroyed") sounds.playPumpkinDestroyed()
    else if (event === "item_used") sounds.playItemUsed()
    else if (event === "shield_break") sounds.playShieldBreak()
    // A retired Dell joining the march is bad news — crunch, not pop.
    else if (event === "dell_retired") sounds.playPumpkinDestroyed()
  }
  hud.value = engine.snapshot()

  renderer = createMiniGameRenderer(engine)
  if (canvasEl.value) {
    await renderer.init(canvasEl.value)
  }

  last = performance.now()
  raf = requestAnimationFrame(tick)
  window.addEventListener("beforeunload", onBeforeUnload)
})

watch(
  () => hud.value?.phase,
  (phase, prev) => {
    if (phase === "gameover" && prev !== "gameover") {
      void submitReport(false)
    }
  },
)

onUnmounted(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener("beforeunload", onBeforeUnload)
  if (
    engine &&
    !engine.wasReportSubmitted &&
    (hud.value?.phase === "playing" || hud.value?.phase === "cards")
  ) {
    submitIncompleteBeacon()
  }
  renderer?.destroy()
  renderer = null
  engine = null
})
</script>
