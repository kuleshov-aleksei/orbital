import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"
import type { BadgeDto } from "@/types"

const api = vi.hoisted(() => ({
  getBadges: vi.fn(),
  getBadgeAssignments: vi.fn(),
  uploadBadge: vi.fn(),
  updateBadge: vi.fn(),
  replaceBadgeImage: vi.fn(),
  deleteBadge: vi.fn(),
  setUserBadges: vi.fn(),
  setDisplayedBadge: vi.fn(),
  getBadgeImageUrl: vi.fn((b: { image_url: string }) => `http://backend${b.image_url}`),
}))
vi.mock("@/services/api", () => ({ apiService: api }))

// Toggled per test: true simulates the Electron/Android on-device media cache.
const native = vi.hoisted(() => ({ available: false }))
vi.mock("@/services/attachments/mediaCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/attachments/mediaCache")>()),
  mediaCacheAvailable: () => native.available,
  mediaUrl: (key: string, src?: string) =>
    `orbital-media://cache/${key}${src ? `?src=${encodeURIComponent(src)}` : ""}`,
}))

import { useBadgesStore } from "./badges"

// Realistic ids: badge ids are UUIDs, user ids padded URL-safe base64.
const BADGE_A = "0b6f3a52-6a47-4d0e-9a51-0f3e8c1d2a11"
const BADGE_B = "7c1e9f04-2b3d-4c5a-8e6f-1a2b3c4d5e6f"
const USER = "qkUrdzLDoqslx8EEy2cM7Q=="

const dto = (id: string, name: string): BadgeDto => ({
  id,
  name,
  description: `${name} description`,
  file_size: 1024,
  created_at: "2026-11-20T12:00:00Z",
  image_url: `/api/badges/${id}/image?v=${id.slice(0, 8)}`,
})

describe("badges store", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    native.available = false
  })

  it("loads definitions and assignments, newest award first", async () => {
    api.getBadges.mockResolvedValue([dto(BADGE_A, "Night Owl"), dto(BADGE_B, "Ship It")])
    api.getBadgeAssignments.mockResolvedValue({
      assignments: {
        [USER]: [
          { badge_id: BADGE_A, assigned_at: "2026-01-01T00:00:00Z" },
          { badge_id: BADGE_B, assigned_at: "2026-06-01T00:00:00Z" },
        ],
      },
    })

    const store = useBadgesStore()
    await store.ensureLoaded()

    const badges = store.badgesOf(USER)
    expect(badges.map((b) => b.name)).toEqual(["Ship It", "Night Owl"])
    expect(badges[0].assignedAt).toBe("2026-06-01T00:00:00Z")
    expect(badges[0].imageUrl).toContain("/api/badges/")
    expect(store.allBadges).toHaveLength(2)
  })

  it("keeps the library order for the admin list", async () => {
    api.getBadges.mockResolvedValue([dto(BADGE_A, "First"), dto(BADGE_B, "Second")])
    api.getBadgeAssignments.mockResolvedValue({ assignments: {} })
    const store = useBadgesStore()
    await store.load()
    expect(store.allBadges.map((b) => b.name)).toEqual(["First", "Second"])
  })

  it("skips unknown badge ids and tolerates a user with no badges", async () => {
    api.getBadges.mockResolvedValue([dto(BADGE_A, "Night Owl")])
    api.getBadgeAssignments.mockResolvedValue({
      assignments: { [USER]: [{ badge_id: "deleted-badge", assigned_at: "2026-01-01T00:00:00Z" }] },
    })
    const store = useBadgesStore()
    await store.load()
    expect(store.badgesOf(USER)).toEqual([])
    expect(store.badgesOf("someone-else")).toEqual([])
  })

  it("patches one user from user_badges_updated", async () => {
    api.getBadges.mockResolvedValue([dto(BADGE_A, "Night Owl")])
    api.getBadgeAssignments.mockResolvedValue({ assignments: {} })
    const store = useBadgesStore()
    await store.load()
    expect(store.badgesOf(USER)).toEqual([])

    store.applyUserBadges(USER, [{ badge_id: BADGE_A, assigned_at: "2026-11-20T12:00:00Z" }])
    expect(store.badgesOf(USER).map((b) => b.name)).toEqual(["Night Owl"])
    expect(store.holderIDs(BADGE_A)).toEqual([USER])
  })

  it("uses the on-device media cache when the shell provides it", async () => {
    native.available = true
    api.getBadges.mockResolvedValue([dto(BADGE_A, "Night Owl")])
    api.getBadgeAssignments.mockResolvedValue({
      assignments: { [USER]: [{ badge_id: BADGE_A, assigned_at: "2026-11-20T12:00:00Z" }] },
    })
    const store = useBadgesStore()
    await store.load()

    const badge = store.badgesOf(USER)[0]
    expect(badge.imageUrl).toContain("orbital-media://cache/badge-")
    expect(badge.imageUrl).toContain("_badge")
    // The plain backend URL stays available as the error fallback.
    expect(badge.sourceUrl).toBe(
      `http://backend/api/badges/${BADGE_A}/image?v=${BADGE_A.slice(0, 8)}`,
    )
  })

  it("drops a deleted badge from definitions and assignments", async () => {
    api.getBadges.mockResolvedValue([dto(BADGE_A, "Night Owl")])
    api.getBadgeAssignments.mockResolvedValue({
      assignments: {
        [USER]: [{ badge_id: BADGE_A, assigned_at: "2026-11-20T12:00:00Z" }],
      },
    })
    api.deleteBadge.mockResolvedValue(undefined)
    const store = useBadgesStore()
    await store.load()

    await store.remove(BADGE_A)
    expect(store.definitions).toHaveLength(0)
    expect(store.badgesOf(USER)).toEqual([])
  })

  it("applies a saved badge set returned by the API", async () => {
    api.getBadges.mockResolvedValue([dto(BADGE_A, "Night Owl")])
    api.getBadgeAssignments.mockResolvedValue({ assignments: {} })
    api.setUserBadges.mockResolvedValue({
      user_id: USER,
      badges: [{ badge_id: BADGE_A, assigned_at: "2026-11-20T12:00:00Z" }],
    })
    const store = useBadgesStore()
    await store.load()

    await store.setUserBadges(USER, [BADGE_A])
    expect(store.badgesOf(USER).map((b) => b.id)).toEqual([BADGE_A])
  })

  it("shows the pinned badge next to the name, or the newest award", async () => {
    api.getBadges.mockResolvedValue([dto(BADGE_A, "Old"), dto(BADGE_B, "New")])
    api.getBadgeAssignments.mockResolvedValue({
      assignments: {
        [USER]: [
          { badge_id: BADGE_A, assigned_at: "2026-01-01T00:00:00Z", displayed: true },
          { badge_id: BADGE_B, assigned_at: "2026-06-01T00:00:00Z", displayed: false },
        ],
      },
    })
    const store = useBadgesStore()
    await store.load()

    // The pin wins over the newest award.
    expect(store.displayedBadgeOf(USER)?.name).toBe("Old")

    // Without a pin the newest award is shown.
    store.applyUserBadges(USER, [
      { badge_id: BADGE_A, assigned_at: "2026-01-01T00:00:00Z" },
      { badge_id: BADGE_B, assigned_at: "2026-06-01T00:00:00Z" },
    ])
    expect(store.displayedBadgeOf(USER)?.name).toBe("New")
    expect(store.displayedBadgeOf("someone-else")).toBeNull()
  })

  it("saves the displayed badge and applies the server's set", async () => {
    api.getBadges.mockResolvedValue([dto(BADGE_A, "Night Owl")])
    api.getBadgeAssignments.mockResolvedValue({
      assignments: { [USER]: [{ badge_id: BADGE_A, assigned_at: "2026-01-01T00:00:00Z" }] },
    })
    api.setDisplayedBadge.mockResolvedValue({
      user_id: USER,
      badges: [{ badge_id: BADGE_A, assigned_at: "2026-01-01T00:00:00Z", displayed: true }],
    })
    const store = useBadgesStore()
    await store.load()
    expect(store.badgesOf(USER)[0].displayed).toBe(false)

    await store.setDisplayedBadge(BADGE_A)
    expect(api.setDisplayedBadge).toHaveBeenCalledWith(BADGE_A)
    expect(store.badgesOf(USER)[0].displayed).toBe(true)
    expect(store.displayedBadgeOf(USER)?.id).toBe(BADGE_A)
  })
})
