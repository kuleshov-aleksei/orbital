// Shared GIF search settings for the composer button and the picker
// (docs/specs/CHAT_SYSTEM.md §7.17). The provider is read from the app config
// (public) and its client key from an authenticated endpoint, once per app
// session: the settings do not change per user, and the picker opens often.
import { computed, readonly, shallowRef } from "vue"
import { createGifProvider, type GifProvider } from "@/services/gif"
import { loadGifConfig } from "@/services/gif/config"
import { useConfigStore } from "@/stores/config"

const provider = shallowRef<GifProvider | null>(null)
const loaded = shallowRef(false)
/** False until the settings arrive; after that, false when disabled. */
const enabled = computed(() => loaded.value && provider.value !== null)
let pending: Promise<void> | null = null

async function ensureLoaded(): Promise<void> {
  if (loaded.value) return
  if (pending) return pending
  pending = (async () => {
    const configStore = useConfigStore()
    await configStore.loadConfig()
    if (!configStore.isLoaded) {
      // Offline or the server is down; the next composer mount tries again.
      throw new Error("app config is not available")
    }
    if (!configStore.gifProvider) {
      // GIF search is off for this deployment: no key request at all.
      loaded.value = true
      return
    }
    const config = await loadGifConfig()
    provider.value = config ? createGifProvider(config) : null
    loaded.value = true
  })().catch(() => {
    pending = null
  })
  return pending ?? Promise.resolve()
}

/** GIF search state: the provider is null until loaded, then null when off. */
export function useGifSearch() {
  return {
    provider: readonly(provider),
    enabled,
    ensureLoaded,
  }
}
