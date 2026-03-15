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
  
  interface TileMove {
    tile: Tile
    targetRow: number
    targetCol: number
    merged: boolean
    mergedFromId?: number
  }

  const moves: TileMove[] = []
  const occupied = new Map<string, Tile>()

  oldTiles.forEach((tile) => {
    occupied.set(`${tile.row},${tile.col}`, tile)
  })

  const rowOrder = direction === "down" ? [3, 2, 1, 0] : [0, 1, 2, 3]
  const colOrder = direction === "right" ? [3, 2, 1, 0] : [0, 1, 2, 3]
  
  for (const row of rowOrder) {
    for (const col of colOrder) {
      const key = `${row},${col}`
      const tile = occupied.get(key)
      if (!tile) continue

      let targetRow = row
      let targetCol = col
      let merged = false
      let mergedFromId: number | undefined

      while (true) {
        let testRow = targetRow
        let testCol = targetCol

        if (direction === "up") testRow--
        else if (direction === "down") testRow++
        else if (direction === "left") testCol--
        else if (direction === "right") testCol++

        if (testRow < 0 || testRow >= COLS || testCol < 0 || testCol >= COLS) break

        const testKey = `${testRow},${testCol}`
        const otherTile = occupied.get(testKey)

        if (!otherTile) {
          targetRow = testRow
          targetCol = testCol
        } else if (otherTile.value === tile.value && !moves.some(m => m.targetRow === testRow && m.targetCol === testCol && m.merged)) {
          targetRow = testRow
          targetCol = testCol
          merged = true
          mergedFromId = tile.id
          break
        } else {
          break
        }
      }

      moves.push({ tile, targetRow, targetCol, merged, mergedFromId })
    }
  }

  const newTiles: Tile[] = []
  const usedTileIds = new Set<number>()
  let hasMoved = false

  for (const move of moves) {
    const { tile, targetRow, targetCol, merged, mergedFromId } = move

    if (merged) {
      const newValue = tile.value * 2
      score.value += newValue
      if (newValue > bestTile.value) {
        bestTile.value = newValue
        if (newValue >= 512) {
          hasReached512.value = true
        }
      }
      newTiles.push({ id: tile.id, row: targetRow, col: targetCol, value: newValue })
      usedTileIds.add(tile.id)
      if (tile.row !== targetRow || tile.col !== targetCol || tile.value !== newValue) {
        hasMoved = true
      }
    } else {
      if (tile.row !== targetRow || tile.col !== targetCol) {
        newTiles.push({ id: tile.id, row: targetRow, col: targetCol, value: tile.value })
        usedTileIds.add(tile.id)
        hasMoved = true
      } else {
        newTiles.push(tile)
      }
    }
  }

  if (newTiles.length !== oldTiles.length) {
    hasMoved = true
  }

  if (!hasMoved) {
    for (const newTile of newTiles) {
      const oldTile = oldTiles.find((t) => t.id === newTile.id)
      if (!oldTile || oldTile.row !== newTile.row || oldTile.col !== newTile.col || oldTile.value !== newTile.value) {
        hasMoved = true
        break
      }
    }
  }

  tiles.value = newTiles

  if (hasMoved) {
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
