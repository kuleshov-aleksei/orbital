import { defineStore } from "pinia"
import { computed, ref } from "vue"
import type { BadgeDto, UserBadgeDto } from "@/types"
import { apiService } from "@/services/api"
import { badgeMediaKey, mediaCacheAvailable, mediaUrl } from "@/services/attachments/mediaCache"

/** A badge as the UI renders it (image resolved, app builds go through the media cache). */
export interface Badge {
  id: string
  name: string
  description: string
  /** Rendered image URL (the on-device cache in the apps). */
  imageUrl: string
  /** Plain backend URL, used when a cached file can't be served. */
  sourceUrl: string
}

/** A badge one user holds, with the date it was awarded. */
export interface HeldBadge extends Badge {
  assignedAt: string
  /** Pinned next to the nickname (one per user). */
  displayed: boolean
}

/** Resolved badges kept in the offline cache (services/offlineCache.ts). */
export interface BadgesSnapshot {
  badges: BadgeDto[]
  assignments: Record<string, UserBadgeDto[]>
}

/**
 * Image URL; in the apps it goes through the on-device media cache, so badges
 * work offline. The `v` param is a fresh filename per upload, so replacing an
 * image produces a new cache key.
 */
function badgeImageUrl(dto: BadgeDto): string {
  const src = apiService.getBadgeImageUrl(dto)
  if (!mediaCacheAvailable()) return src
  const version = new URL(dto.image_url, "http://x").searchParams.get("v") ?? "0"
  return mediaUrl(badgeMediaKey(dto.id, version), src)
}

function toBadge(dto: BadgeDto): Badge {
  const sourceUrl = apiService.getBadgeImageUrl(dto)
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    imageUrl: badgeImageUrl(dto),
    sourceUrl,
  }
}

export const useBadgesStore = defineStore("badges", () => {
  const definitions = ref<BadgeDto[]>([])
  // user id -> badges they hold (ids + award dates)
  const assignments = ref<Record<string, UserBadgeDto[]>>({})
  const isLoaded = ref(false)
  const isLoading = ref(false)
  /** A reload was requested while one was already in flight. */
  let pendingReload = false
  /** Bumped whenever cached data changes, so the offline snapshot is rewritten. */
  const version = ref(0)

  /** Every badge in library order (admin list, pickers). */
  const allBadges = computed<Badge[]>(() => definitions.value.map(toBadge))

  function bump() {
    version.value++
  }

  async function load() {
    if (isLoading.value) {
      // A change arrived while a fetch was in flight; refetch once it settles
      // so the response started before the change can't win.
      pendingReload = true
      return
    }
    isLoading.value = true
    try {
      const [badges, assigned] = await Promise.all([
        apiService.getBadges(),
        apiService.getBadgeAssignments(),
      ])
      definitions.value = badges
      assignments.value = assigned.assignments ?? {}
      isLoaded.value = true
      bump()
    } catch (err) {
      console.error("[Badges] Failed to load badges:", err)
    } finally {
      isLoading.value = false
      if (pendingReload) {
        pendingReload = false
        void load()
      }
    }
  }

  /** Loads the library once (member list rows call this in case nothing else did). */
  async function ensureLoaded(): Promise<void> {
    if (!isLoaded.value) await load()
  }

  /** Re-fetches definitions and assignments (badges_updated). */
  async function onLibraryChanged(): Promise<void> {
    if (!isLoaded.value) return
    await load()
  }

  /** user_badges_updated: one user's set changed. */
  function applyUserBadges(userId: string, badges: UserBadgeDto[]): void {
    assignments.value = { ...assignments.value, [userId]: badges }
    bump()
  }

  /**
   * Badges a user holds, newest award first, so a freshly granted badge is
   * always among the few shown in the member list. Unknown ids (deleted
   * badges) are skipped.
   */
  function badgesOf(userId: string): HeldBadge[] {
    const byId = new Map(definitions.value.map((dto) => [dto.id, toBadge(dto)]))
    return (assignments.value[userId] ?? [])
      .map((ub) => {
        const badge = byId.get(ub.badge_id)
        return badge ? { ...badge, assignedAt: ub.assigned_at, displayed: !!ub.displayed } : null
      })
      .filter((b): b is HeldBadge => b !== null)
      .sort((a, b) => Date.parse(b.assignedAt) - Date.parse(a.assignedAt))
  }

  /**
   * The one badge shown next to the nickname: the user's pinned badge, or the
   * newest award when they haven't picked one.
   */
  function displayedBadgeOf(userId: string): HeldBadge | null {
    const badges = badgesOf(userId)
    return badges.find((b) => b.displayed) ?? badges[0] ?? null
  }

  function holderIDs(badgeId: string): string[] {
    return Object.entries(assignments.value)
      .filter(([, badges]) => badges.some((b) => b.badge_id === badgeId))
      .map(([userId]) => userId)
  }

  function hydrateFromCache(snapshot: BadgesSnapshot): void {
    if (isLoaded.value) return
    definitions.value = snapshot.badges ?? []
    assignments.value = snapshot.assignments ?? {}
    bump()
  }

  function snapshot(): BadgesSnapshot {
    return { badges: definitions.value, assignments: assignments.value }
  }

  // --- Admin mutations (super admin only; the backend enforces it)
  async function upload(input: {
    file: File
    name: string
    description: string
  }): Promise<BadgeDto> {
    const badge = await apiService.uploadBadge(input)
    definitions.value = [...definitions.value, badge]
    bump()
    return badge
  }

  async function update(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<BadgeDto> {
    const badge = await apiService.updateBadge(id, patch)
    definitions.value = definitions.value.map((b) => (b.id === id ? badge : b))
    bump()
    return badge
  }

  async function replaceImage(id: string, file: File): Promise<BadgeDto> {
    const badge = await apiService.replaceBadgeImage(id, file)
    definitions.value = definitions.value.map((b) => (b.id === id ? badge : b))
    bump()
    return badge
  }

  async function remove(id: string): Promise<void> {
    await apiService.deleteBadge(id)
    definitions.value = definitions.value.filter((b) => b.id !== id)
    const next: Record<string, UserBadgeDto[]> = {}
    for (const [userId, badges] of Object.entries(assignments.value)) {
      const kept = badges.filter((b) => b.badge_id !== id)
      if (kept.length) next[userId] = kept
    }
    assignments.value = next
    bump()
  }

  async function setUserBadges(userId: string, badgeIds: string[]): Promise<void> {
    const res = await apiService.setUserBadges(userId, badgeIds)
    applyUserBadges(userId, res.badges ?? [])
  }

  /** Pins one of the caller's own badges next to their nickname (null = newest). */
  async function setDisplayedBadge(badgeId: string | null): Promise<void> {
    const res = await apiService.setDisplayedBadge(badgeId)
    applyUserBadges(res.user_id, res.badges ?? [])
  }

  return {
    definitions,
    assignments,
    allBadges,
    isLoaded,
    isLoading,
    version,
    ensureLoaded,
    load,
    onLibraryChanged,
    applyUserBadges,
    badgesOf,
    displayedBadgeOf,
    holderIDs,
    hydrateFromCache,
    snapshot,
    upload,
    update,
    replaceImage,
    remove,
    setUserBadges,
    setDisplayedBadge,
  }
})
