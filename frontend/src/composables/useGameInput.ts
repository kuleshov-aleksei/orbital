import { ref, onMounted, onUnmounted, type Ref } from "vue"

export interface GameInputState {
  direction: Ref<{ x: number; y: number }>
}

export function useGameInput(): {
  direction: Ref<{ x: number; y: number }>
  setMobileInput: (x: number, y: number) => void
  startListening: () => void
  stopListening: () => void
} {
  const direction = ref<{ x: number; y: number }>({ x: 0, y: 0 })
  let isListening = false

  const keyDownListener = (e: KeyboardEvent) => {
    const prev = direction.value
    const next = { x: prev.x, y: prev.y }

    if (e.key === "ArrowUp" || e.key === "w") next.y = -1
    else if (e.key === "ArrowDown" || e.key === "s") next.y = 1

    if (e.key === "ArrowLeft" || e.key === "a") next.x = -1
    else if (e.key === "ArrowRight" || e.key === "d") next.x = 1

    if (next.x !== prev.x || next.y !== prev.y) {
      direction.value = next
    }
  }

  const keyUpListener = (e: KeyboardEvent) => {
    const prev = direction.value
    const next = { x: prev.x, y: prev.y }

    if ((e.key === "ArrowUp" || e.key === "w") && prev.y === -1) next.y = 0
    else if ((e.key === "ArrowDown" || e.key === "s") && prev.y === 1) next.y = 0

    if ((e.key === "ArrowLeft" || e.key === "a") && prev.x === -1) next.x = 0
    else if ((e.key === "ArrowRight" || e.key === "d") && prev.x === 1) next.x = 0

    if (next.x !== prev.x || next.y !== prev.y) {
      direction.value = next
    }
  }

  const startListening = () => {
    if (isListening) return
    isListening = true
    document.addEventListener("keydown", keyDownListener)
    document.addEventListener("keyup", keyUpListener)
  }

  const stopListening = () => {
    if (!isListening) return
    isListening = false
    document.removeEventListener("keydown", keyDownListener)
    document.removeEventListener("keyup", keyUpListener)
  }

  const setMobileInput = (x: number, y: number) => {
    direction.value = { x, y }
  }

  return {
    direction,
    setMobileInput,
    startListening,
    stopListening,
  }
}
