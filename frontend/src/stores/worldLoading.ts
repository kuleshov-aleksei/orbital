import { defineStore } from "pinia"
import { ref } from "vue"

export const useWorldLoadingStore = defineStore("worldLoading", () => {
  const active = ref(false)
  const progress = ref(0)
  const stage = ref("")
  const error = ref<string | null>(null)

  function start() {
    active.value = true
    progress.value = 0
    stage.value = "Loading world…"
    error.value = null
  }

  function update(p: number, s: string) {
    progress.value = p
    stage.value = s
  }

  function finish() {
    active.value = false
    progress.value = 100
    stage.value = ""
  }

  function setError(msg: string) {
    error.value = msg
    active.value = false
  }

  return {
    active,
    progress,
    stage,
    error,
    start,
    update,
    finish,
    setError,
  }
})
