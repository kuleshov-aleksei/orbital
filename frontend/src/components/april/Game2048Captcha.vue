<template>
  <div class="text-center">
    <h2 class="text-2xl font-bold mb-2 text-red-500">Verify: Reach 512</h2>

    <p class="text-sm text-gray-400 mb-4">Use arrow keys to move tiles. Reach 512 to verify!</p>

    <!-- Game Container -->
    <div class="flex flex-col items-center">
      <!-- Score and Status -->
      <div class="flex gap-4 mb-4">
        <div class="bg-gray-800 px-4 py-2 rounded-lg">
          <div class="text-xs text-gray-500">Score</div>
          <div class="text-xl font-bold text-white">{{ score }}</div>
        </div>
        <div class="bg-gray-800 px-4 py-2 rounded-lg">
          <div class="text-xs text-gray-500">Best Tile</div>
          <div class="text-xl font-bold" :class="getBestTileColorClass()">{{ bestTile }}</div>
        </div>
      </div>

      <!-- Win indicator -->
      <div
        v-if="hasReached512 && !isCompleted"
        class="mb-3 px-4 py-1 bg-green-900/50 border border-green-500 rounded-lg">
        <span class="text-green-400 text-sm font-bold">512 reached! You can verify now.</span>
      </div>

      <!-- Game Over indicator -->
      <div
        v-if="gameOver && !isCompleted"
        class="mb-3 px-4 py-1 bg-red-900/50 border border-red-500 rounded-lg">
        <span class="text-red-400 text-sm font-bold">No more moves! Game Over.</span>
      </div>

      <!-- Game Board -->
      <div
        class="game-board relative bg-gray-700 p-2 rounded-xl"
        tabindex="0"
        @keydown="handleKeydown"
        ref="boardRef">
        <!-- Background grid cells -->
        <div class="grid grid-cols-4 gap-2 w-[280px] h-[280px]">
          <div v-for="i in 16" :key="i" class="w-16 h-16 bg-gray-600 rounded-lg"></div>
        </div>

        <!-- Tiles -->
        <div class="absolute top-2 left-2 pointer-events-none">
          <div
            v-for="tile in tiles"
            :key="tile.id"
            class="tile absolute w-16 h-16 rounded-lg flex items-center justify-center font-bold text-xl shadow-md"
            :class="getTileColorClass(tile.value)"
            :style="getTileStyle(tile)">
            {{ tile.value }}
          </div>
        </div>
      </div>

      <!-- Instructions -->
      <p class="text-xs text-gray-500 mt-3">Click board and use arrow keys to play</p>

      <!-- Verify Button -->
      <button
        v-if="!gameOver"
        type="button"
        class="mt-4 px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="!hasVerified"
        @click="handleVerify">
        {{ hasVerified ? "Verified!" : "I'm Not a Robot" }}
      </button>

      <!-- Reset Button -->
      <button
        v-if="gameOver"
        type="button"
        class="mt-4 px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white font-bold rounded-lg transition-colors duration-200"
        @click="initGame">
        Try Again
      </button>
    </div>

    <!-- Completion checkmark -->
    <Transition name="fade">
      <svg
        v-if="isCompleted"
        class="w-16 h-16 text-green-500 mx-auto mt-4 animate-bounce"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
      </svg>
    </Transition>

    <div class="text-sm text-gray-400 mt-2">
      {{ getTypeLabel() }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue"
import { useAprilStore } from "@/stores/april"

interface Tile {
  id: number
  value: number
  row: number
  col: number
}

const aprilStore = useAprilStore()

const tiles = ref<Tile[]>([])
const score = ref(0)
const bestTile = ref(2)
const hasReached512 = ref(false)
const hasVerified = ref(false)
const isCompleted = ref(false)
const gameOver = ref(false)
const boardRef = ref<HTMLElement | null>(null)
let tileIdCounter = 0

const COLS = 4
const CELL_SIZE = 64
const CELL_GAP = 8

function getEmptyBoard(): (number | null)[][] {
  return Array(COLS)
    .fill(null)
    .map(() => Array(COLS).fill(null))
}

function getTilePosition(row: number, col: number): { top: string; left: string } {
  return {
    top: `${row * (CELL_SIZE + CELL_GAP)}px`,
    left: `${col * (CELL_SIZE + CELL_GAP)}px`,
  }
}

function getTileStyle(tile: Tile) {
  const pos = getTilePosition(tile.row, tile.col)
  return {
    top: pos.top,
    left: pos.left,
  }
}

function getTileColorClass(value: number): string {
  const colors: Record<number, string> = {
    2: "bg-gray-200 text-gray-800",
    4: "bg-gray-300 text-gray-800",
    8: "bg-orange-200 text-orange-900",
    16: "bg-orange-300 text-orange-900",
    32: "bg-orange-400 text-white",
    64: "bg-orange-500 text-white",
    128: "bg-yellow-300 text-yellow-900",
    256: "bg-yellow-400 text-yellow-900",
    512: "bg-yellow-500 text-white",
    1024: "bg-yellow-600 text-white",
    2048: "bg-yellow-700 text-white",
    4096: "bg-green-500 text-white",
    8192: "bg-green-600 text-white",
    16384: "bg-purple-600 text-white",
  }
  return colors[value] || "bg-purple-700 text-white"
}

function getBestTileColorClass(): string {
  if (bestTile.value >= 4096) return "text-green-400"
  if (bestTile.value >= 2048) return "text-yellow-400"
  if (bestTile.value >= 1024) return "text-yellow-300"
  return "text-white"
}

function initGame() {
  tiles.value = []
  score.value = 0
  bestTile.value = 2
  hasReached512.value = false
  hasVerified.value = false
  isCompleted.value = false
  gameOver.value = false
  tileIdCounter = 0

  spawnTile()
  spawnTile()
}

function spawnTile() {
  const occupied = new Set(tiles.value.map((t) => `${t.row},${t.col}`))
  const emptyCells: { row: number; col: number }[] = []

  for (let r = 0; r < COLS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!occupied.has(`${r},${c}`)) {
        emptyCells.push({ row: r, col: c })
      }
    }
  }

  if (emptyCells.length === 0) return

  const cell = emptyCells[Math.floor(Math.random() * emptyCells.length)]
  const value = Math.random() < 0.9 ? 2 : 4

  tiles.value.push({
    id: tileIdCounter++,
    value,
    row: cell.row,
    col: cell.col,
  })
}

function move(direction: "up" | "down" | "left" | "right") {
  const oldTiles = tiles.value.map((t) => ({ ...t }))
  const tileMap = new Map<string, Tile>()
  oldTiles.forEach((t) => tileMap.set(`${t.row},${t.col}`, t))

  const board = getEmptyBoard()
  oldTiles.forEach((t) => {
    board[t.row][t.col] = t.value
  })

  const rows = direction === "down" ? [3, 2, 1, 0] : [0, 1, 2, 3]
  const cols = direction === "right" ? [3, 2, 1, 0] : [0, 1, 2, 3]
  const merged: { row: number; col: number; value: number }[] = []
  const mergedFrom = new Map<string, string>()

  for (const r of rows) {
    for (const c of cols) {
      if (board[r][c] === null) continue

      const value = board[r][c]
      let newR = r
      let newC = c

      while (true) {
        let testR = newR
        let testC = newC

        if (direction === "up") testR--
        else if (direction === "down") testR++
        else if (direction === "left") testC--
        else if (direction === "right") testC++

        if (testR < 0 || testR >= COLS || testC < 0 || testC >= COLS) break
        if (board[testR][testC] === null) {
          newR = testR
          newC = testC
        } else if (
          board[testR][testC] === value &&
          !merged.some((m) => m.row === testR && m.col === testC)
        ) {
          newR = testR
          newC = testC
          break
        } else {
          break
        }
      }

      if (newR !== r || newC !== c) {
        if (
          board[newR][newC] !== null &&
          board[newR][newC] === value &&
          !merged.some((m) => m.row === newR && m.col === newC)
        ) {
          board[newR][newC] *= 2
          const mergedValue = board[newR][newC]
          board[r][c] = null
          score.value += mergedValue
          merged.push({ row: newR, col: newC, value: mergedValue })
          mergedFrom.set(`${newR},${newC}`, `${r},${c}`)

          if (mergedValue > bestTile.value) {
            bestTile.value = mergedValue
            if (mergedValue >= 512) {
              hasReached512.value = true
            }
          }
        } else {
          board[newR][newC] = value
          board[r][c] = null
        }
      }
    }
  }

  const newTiles: Tile[] = []
  const usedIds = new Set<number>()
  let moved = false

  for (let r = 0; r < COLS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = board[r][c]
      if (value !== null) {
        const key = `${r},${c}`
        const fromKey = mergedFrom.get(key)

        let tile: Tile | undefined

        if (fromKey) {
          tile = tileMap.get(fromKey)
        }

        if (!tile || usedIds.has(tile.id)) {
          tile = tileMap.get(key)
        }

        if (!tile || usedIds.has(tile.id)) {
          for (const t of oldTiles) {
            if (!usedIds.has(t.id) && t.value === value) {
              tile = t
              break
            }
          }
        }

        if (tile) {
          usedIds.add(tile.id)
          if (tile.row !== r || tile.col !== c || tile.value !== value) {
            newTiles.push({ id: tile.id, row: r, col: c, value })
            moved = true
          } else {
            newTiles.push(tile)
          }
        } else {
          newTiles.push({ id: tileIdCounter++, row: r, col: c, value })
          moved = true
        }
      }
    }
  }

  if (newTiles.length !== oldTiles.length) {
    moved = true
  }

  if (!moved) {
    for (const nt of newTiles) {
      const ot = oldTiles.find((t) => t.id === nt.id)
      if (!ot || ot.row !== nt.row || ot.col !== nt.col || ot.value !== nt.value) {
        moved = true
        break
      }
    }
  }

  tiles.value = newTiles

  if (moved) {
    nextTick(() => {
      spawnTile()
      checkGameOver()
    })
  }
}

function checkGameOver() {
  const board = getEmptyBoard()
  tiles.value.forEach((t) => {
    board[t.row][t.col] = t.value
  })

  for (let r = 0; r < COLS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === null) return
    }
  }

  for (let r = 0; r < COLS; r++) {
    for (let c = 0; c < COLS; c++) {
      const value = board[r][c]
      if (r > 0 && board[r - 1][c] === value) return
      if (r < COLS - 1 && board[r + 1][c] === value) return
      if (c > 0 && board[r][c - 1] === value) return
      if (c < COLS - 1 && board[r][c + 1] === value) return
    }
  }

  gameOver.value = true
}

function handleKeydown(event: KeyboardEvent) {
  if (isCompleted.value || gameOver.value) return

  switch (event.key) {
    case "ArrowUp":
      event.preventDefault()
      move("up")
      break
    case "ArrowDown":
      event.preventDefault()
      move("down")
      break
    case "ArrowLeft":
      event.preventDefault()
      move("left")
      break
    case "ArrowRight":
      event.preventDefault()
      move("right")
      break
  }
}

function handleVerify() {
  if (!hasReached512.value) return

  hasVerified.value = true
  isCompleted.value = true
  aprilStore.completeCaptcha()
}

function getTypeLabel(): string {
  switch (aprilStore.currentType) {
    case "join":
      return "Join attempt blocked"
    case "theme":
      return "Theme change intercepted"
    case "settings":
      return "Settings access denied"
    case "mute":
      return "Mute action stopped"
    case "leave":
      return "Leave prevented"
    case "volume":
      return "Volume adjustment halted"
    case "video":
      return "Camera sharing blocked"
    case "screenshare":
      return "Screensharing blocked"
    default:
      return "Captcha required"
  }
}

onMounted(() => {
  initGame()
  nextTick(() => {
    boardRef.value?.focus()
  })
})

watch(
  () => aprilStore.isCaptchaActive,
  (active) => {
    if (active) {
      isCompleted.value = false
      initGame()
      nextTick(() => {
        boardRef.value?.focus()
      })
    }
  },
)
</script>

<style scoped>
.game-board {
  width: 296px;
  height: 296px;
  outline: none;
}

.game-board:focus {
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.5);
}

.tile {
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    top 0.1s ease-out,
    left 0.1s ease-out;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
