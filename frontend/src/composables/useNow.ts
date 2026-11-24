import { onBeforeUnmount, ref, type Ref } from "vue"

// One shared clock for countdowns ("ends in 3h"): a single interval however
// many components show one, stopped when the last of them unmounts.
const now = ref(Date.now())
let users = 0
let timer: ReturnType<typeof setInterval> | null = null

/** A reactive Date.now() that ticks every 30 s. Call from setup(). */
export function useNow(): Ref<number> {
  users++
  if (!timer) {
    now.value = Date.now()
    timer = setInterval(() => (now.value = Date.now()), 30_000)
  }
  onBeforeUnmount(() => {
    users--
    if (users === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  })
  return now
}
