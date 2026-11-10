import { defineStore } from "pinia"
import { ref } from "vue"
import { apiService } from "@/services/api"
import type { TextSearchHit, TextSearchSort } from "@/types/textChat"

const SEARCH_DEBOUNCE_MS = 200
const PAGE = 25

/**
 * Text channel search (docs/specs/CHAT_SYSTEM.md §7.11). The query string
 * holds the inline filters (from:, in:, during:, ...); the backend parses it.
 */
export const useTextSearchStore = defineStore("textSearch", () => {
  const query = ref("")
  const sort = ref<TextSearchSort>("relevance")
  const hits = ref<TextSearchHit[]>([])
  const total = ref(0)
  const hints = ref<string[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  /** The query the results belong to ("" = no search yet). */
  const shownQuery = ref("")

  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null

  async function run(append = false) {
    const q = query.value.trim()
    controller?.abort()
    if (!q) {
      clearResults()
      return
    }
    controller = new AbortController()
    const signal = controller.signal
    if (append) loadingMore.value = true
    else loading.value = true
    error.value = null
    try {
      const resp = await apiService.searchTextMessages(q, {
        sort: sort.value,
        offset: append ? hits.value.length : 0,
        limit: PAGE,
        signal,
      })
      if (signal.aborted) return
      hits.value = append ? [...hits.value, ...resp.hits] : resp.hits
      total.value = resp.total
      hints.value = resp.hints
      shownQuery.value = q
    } catch (e) {
      if (signal.aborted || (e as { name?: string }).name === "AbortError") return
      const status = (e as { status?: number }).status
      error.value = status === 503 ? "Search is temporarily unavailable." : "Search failed."
    } finally {
      if (!signal.aborted) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  /** Search as you type (debounced). */
  function setQuery(q: string) {
    query.value = q
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void run()
    }, SEARCH_DEBOUNCE_MS)
  }

  function searchNow() {
    if (timer) clearTimeout(timer)
    timer = null
    void run()
  }

  function setSort(next: TextSearchSort) {
    if (sort.value === next) return
    sort.value = next
    searchNow()
  }

  function loadMore() {
    if (loading.value || loadingMore.value || hits.value.length >= total.value) return
    void run(true)
  }

  function clearResults() {
    hits.value = []
    total.value = 0
    hints.value = []
    shownQuery.value = ""
    loading.value = false
    loadingMore.value = false
    error.value = null
  }

  function reset() {
    if (timer) clearTimeout(timer)
    controller?.abort()
    query.value = ""
    sort.value = "relevance"
    clearResults()
  }

  return {
    query,
    sort,
    hits,
    total,
    hints,
    loading,
    loadingMore,
    error,
    shownQuery,
    setQuery,
    searchNow,
    setSort,
    loadMore,
    reset,
  }
})
