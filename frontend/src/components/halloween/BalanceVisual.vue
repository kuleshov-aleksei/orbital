<!--
  DEV-ONLY balance visualizer (mounted at /dev/balance, never linked in prod).
  Runs one headless-style sim game live in the browser using the SAME
  HalloweenGameEngine + Pixi renderer as the real game (MiniGame.vue), driven
  by the SAME bot policies as tools/halloween-balance (heuristic / systemone).
  Purpose: watch policy behaviour (buys, placements, ability holds) unfold.
-->
<template>
  <div class="flex h-screen flex-col bg-stone-950 text-stone-200">
    <div class="flex flex-wrap items-center gap-3 border-b border-stone-800 px-4 py-2">
      <span class="font-semibold text-amber-300">balance visual</span>
      <span class="rounded bg-amber-900/60 px-1.5 py-0.5 text-[11px] text-amber-200">dev only</span>

      <label class="text-xs text-stone-400">
        policy
        <select
          v-model="policyName"
          :disabled="running"
          class="ml-1 rounded bg-stone-800 px-1.5 py-1 text-stone-200">
          <option value="systemone">systemone</option>
          <option value="heuristic">heuristic</option>
        </select>
      </label>

      <label class="text-xs text-stone-400">
        seed
        <input
          v-model.number="seed"
          type="number"
          :disabled="running"
          class="ml-1 w-20 rounded bg-stone-800 px-1.5 py-1 text-stone-200" />
      </label>

      <label v-if="policyName === 'systemone'" class="text-xs text-stone-400">
        decider
        <input
          v-model="systemoneUrl"
          type="text"
          :disabled="running"
          class="ml-1 w-64 rounded bg-stone-800 px-1.5 py-1 font-mono text-stone-200" />
      </label>

      <label class="text-xs text-stone-400">
        speed
        <select v-model.number="speed" class="ml-1 rounded bg-stone-800 px-1.5 py-1 text-stone-200">
          <option :value="1">1x</option>
          <option :value="2">2x</option>
          <option :value="4">4x</option>
          <option :value="8">8x</option>
        </select>
      </label>

      <button
        type="button"
        class="rounded bg-amber-700 px-2.5 py-1 text-sm text-white hover:bg-amber-600"
        @click="restart">
        {{ started ? "restart" : "start" }}
      </button>
      <button
        type="button"
        :disabled="!started || finished"
        class="rounded bg-stone-700 px-2.5 py-1 text-sm hover:bg-stone-600 disabled:opacity-40"
        @click="paused = !paused">
        {{ paused ? "resume" : "pause" }}
      </button>
      <button
        type="button"
        :disabled="!started || !paused || finished"
        class="rounded bg-stone-700 px-2.5 py-1 text-sm hover:bg-stone-600 disabled:opacity-40"
        @click="stepOnce">
        step
      </button>

      <span v-if="awaiting" class="animate-pulse text-xs text-sky-300">
        waiting for decider ({{ decisionTotal }} decisions so far)…
      </span>
      <span v-if="error" class="text-xs text-red-400">error: {{ error }}</span>
      <span v-if="finished" class="text-xs text-emerald-300">{{ endLine }}</span>
    </div>

    <div class="flex min-h-0 flex-1">
      <div ref="canvasEl" class="min-w-0 flex-1"></div>

      <div class="flex w-96 flex-col border-l border-stone-800">
        <div class="grid grid-cols-4 gap-1 border-b border-stone-800 px-3 py-2 font-mono text-xs">
          <div>
            round <span class="text-amber-200">{{ hud?.round ?? "–" }}</span>
          </div>
          <div>
            score <span class="text-amber-200">{{ hud?.score ?? "–" }}</span>
          </div>
          <div>
            coins <span class="text-amber-200">{{ hud?.coins ?? "–" }}</span>
          </div>
          <div>
            xp <span class="text-amber-200">{{ hud?.xp ?? "–" }}</span>
          </div>
          <div>
            pumpkins <span class="text-amber-200">{{ alivePumpkins }}</span>
          </div>
          <div>
            slugs <span class="text-amber-200">{{ aliveSlugs }}</span>
          </div>
          <div>
            ticks <span class="text-amber-200">{{ ticks }}</span>
          </div>
          <div>
            phase <span class="text-amber-200">{{ hud?.phase ?? "–" }}</span>
          </div>
        </div>
        <div class="border-b border-stone-800 px-3 py-1.5 font-mono text-[11px] text-stone-400">
          inv: {{ inventoryLine }}
        </div>
        <div
          ref="feedEl"
          class="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
          <div v-for="(d, i) in feed" :key="i" class="whitespace-pre-wrap">
            <span class="text-stone-500">{{ d.phase }}</span>
            <span :class="d.note ? 'text-stone-300' : 'text-sky-300'"> {{ d.question }}</span>
            <span class="text-stone-200"> → {{ d.choice }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef } from "vue"
import { HalloweenGameEngine } from "@/halloween/game/engine"
import { createMiniGameRenderer } from "@/halloween/game/renderer"
import { useHalloweenStore } from "@/stores"
import type { GameSnapshot } from "@/halloween/game/types"
import type { HalloweenGameConfig } from "@/halloween/types"
// Single source of truth with the headless harness (vite fs.allow covers
// ../../../../tools). Browser-safe: pure TS + fetch, no node imports.
import { HeuristicPolicy, type Policy } from "../../../../tools/halloween-balance/policies"
import {
  SystemOnePolicy,
  type DecisionRecord,
} from "../../../../tools/halloween-balance/policies-systemone"
import { defaultConfig } from "../../../../tools/halloween-balance/fixture"
import { mulberry32, type Rng } from "../../../../tools/halloween-balance/rng"

const DT = 1 / 30 // sim-seconds per tick — same fixed step as driver.ts
const MAX_TICKS = 45 * 60 * 30 // safety cap, mirrors maxSimSeconds 45 min

interface FeedItem extends DecisionRecord {
  note?: boolean
}

const halloweenStore = useHalloweenStore()
const canvasEl = useTemplateRef<HTMLElement>("canvasEl")
const feedEl = useTemplateRef<HTMLElement>("feedEl")

const policyName = ref<"systemone" | "heuristic">("systemone")
const seed = ref(5)
const systemoneUrl = ref("http://localhost:8000/v1/systemone")
const speed = ref(2)

const running = ref(false) // a sim loop is alive
const started = ref(false)
const paused = ref(false)
const finished = ref(false)
const awaiting = ref(false) // blocked inside a policy await (decider fetch)
const error = ref<string | null>(null)
const hud = ref<GameSnapshot | null>(null)
const ticks = ref(0)
const alivePumpkins = ref(0)
const aliveSlugs = ref(0)
const feed = ref<FeedItem[]>([])
const endLine = ref("")

let engine: HalloweenGameEngine | null = null
let renderer: ReturnType<typeof createMiniGameRenderer> | null = null
let policy: Policy | null = null
let rng: Rng = Math.random
let runId = 0
let raf = 0
let lastSeenDecisions = 0

const decisionTotal = computed(() => feed.value.filter((d) => !d.note).length)
const inventoryLine = computed(
  () =>
    hud.value?.inventory
      .map((i) => (i.kind === "pumpkin" ? i.pumpkinType : i.abilityId))
      .join(", ") || "empty",
)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pushNote(choice: string): void {
  if (!engine) return
  const snap = engine.snapshot()
  feed.value.push({ phase: `R${snap.round}/${snap.phase}`, question: "note", choice, note: true })
  void nextTick(scrollFeed)
}

function syncPolicyDecisions(): void {
  const decisions = (policy as SystemOnePolicy | null)?.decisions
  if (!decisions) return
  while (lastSeenDecisions < decisions.length) {
    feed.value.push(decisions[lastSeenDecisions])
    lastSeenDecisions++
  }
  void nextTick(scrollFeed)
}

function scrollFeed(): void {
  const el = feedEl.value
  if (el) el.scrollTop = el.scrollHeight
}

/** One fixed sim step. Mirrors driver.ts: cards phase resolves popups via
 * the policy, playing phase calls onTick, then engine.update(DT). */
async function simStep(config: HalloweenGameConfig): Promise<boolean> {
  if (!engine || !policy) return false
  const snap = engine.snapshot()
  if (snap.phase === "gameover" || snap.phase === "ended") return false

  if (snap.phase === "cards" && snap.cards) {
    const pumpkins = engine.pumpkins.filter((p) => p.health > 0)
    awaiting.value = true
    try {
      const pick = await policy.pickCard(snap.cards.cards, rng, {
        cramerCount: pumpkins.filter((p) => p.type === "cramer").length,
        damagedAny: pumpkins.some((p) => p.health < p.maxHealth),
      })
      if (policyName.value === "heuristic") {
        feed.value.push({ phase: "cards", question: "card_decision", choice: String(pick) })
      }
      engine.pickCard(pick)
    } finally {
      awaiting.value = false
    }
  } else if (snap.phase === "playing") {
    awaiting.value = true
    try {
      await policy.onTick(engine, config, rng)
    } finally {
      awaiting.value = false
    }
  }
  engine.update(DT)
  ticks.value++
  syncPolicyDecisions()

  const after = engine.snapshot()
  if (after.round !== snap.round && after.phase === "playing") {
    pushNote(`reached round ${after.round}`)
  }
  const done = after.phase === "gameover" || after.phase === "ended"
  if (done) {
    const report = engine.buildReport(false)
    endLine.value =
      `game over: R${after.round} completed ${report.completed_rounds}, ` +
      `score ${report.score}, ${report.kills.length} kills ` +
      `(${after.gameOverReason ?? after.phase})`
    pushNote(endLine.value)
  }
  return !done && ticks.value < MAX_TICKS
}

/** Sim task: advances the game while the render loop paints. Each iteration
 * runs `speed` sequential sim steps, then yields ~33ms so the UI breathes.
 * Systemone steps are decider-bound (each awaits a fetch), so speed scales
 * decider throughput; heuristic steps are synchronous. Pause is honored
 * between steps. */
async function simLoop(config: HalloweenGameConfig, id: number): Promise<void> {
  while (id === runId) {
    if (paused.value) {
      await sleep(100)
      continue
    }
    const steps = speed.value
    for (let i = 0; i < steps; i++) {
      if (id !== runId || paused.value) break
      try {
        const alive = await simStep(config)
        if (!alive) {
          finished.value = true
          running.value = false
          return
        }
      } catch (e) {
        error.value = (e as Error).message
        running.value = false
        return
      }
    }
    await sleep(33)
  }
}

const renderFrame = (): void => {
  if (engine) {
    renderer?.sync()
    hud.value = engine.snapshot()
    alivePumpkins.value = engine.pumpkins.filter((p) => p.health > 0).length
    aliveSlugs.value = engine.slugs.filter((s) => s.health > 0).length
  }
  raf = requestAnimationFrame(renderFrame)
}

async function restart(): Promise<void> {
  runId++ // abort any in-flight loop
  const id = runId
  error.value = null
  endLine.value = ""
  feed.value = []
  ticks.value = 0
  finished.value = false
  paused.value = false
  lastSeenDecisions = 0

  renderer?.destroy()
  renderer = null

  if (!halloweenStore.config) await halloweenStore.fetchConfig()
  const config = halloweenStore.config ?? defaultConfig()
  rng = mulberry32(seed.value)
  engine = new HalloweenGameEngine(config, rng)
  policy =
    policyName.value === "systemone"
      ? new SystemOnePolicy({ url: systemoneUrl.value, timeoutMs: 20000 })
      : new HeuristicPolicy()
  hud.value = engine.snapshot()

  // No sounds in the visualizer — engine.onEvent stays unwired.
  renderer = createMiniGameRenderer(engine)
  if (canvasEl.value) await renderer.init(canvasEl.value)

  started.value = true
  running.value = true
  pushNote(`start policy=${policy.name} seed=${seed.value}`)
  void simLoop(config, id)
}

/** Advance exactly one sim step while paused (steps through systemone
 * decider calls one at a time — handy for watching its reasoning). */
async function stepOnce(): Promise<void> {
  if (!engine || !policy || finished.value || !paused.value) return
  if (!halloweenStore.config) await halloweenStore.fetchConfig()
  const config = halloweenStore.config ?? defaultConfig()
  try {
    const alive = await simStep(config)
    if (!alive) finished.value = true
  } catch (e) {
    error.value = (e as Error).message
  }
}

onMounted(() => {
  raf = requestAnimationFrame(renderFrame)
  void restart()
})

onUnmounted(() => {
  runId++
  cancelAnimationFrame(raf)
  renderer?.destroy()
  renderer = null
  engine = null
  policy = null
})
</script>
