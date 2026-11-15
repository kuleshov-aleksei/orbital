import { watch } from "vue"
import {
  useCategoryStore,
  usePermissionsStore,
  useRoomStore,
  useTextChatStore,
  useUserStore,
  useUsersStore,
} from "@/stores"
import type { PermissionsSnapshot } from "@/stores/permissions"
import type { Category, PublicUser, Room } from "@/types"
import { cacheGet, cachePutDebounced, offlineCacheUser } from "@/services/offlineCache"

/**
 * Offline snapshot of the sidebar data: rooms, categories, users and the
 * user's permissions (text channel messages are cached by stores/textChat.ts).
 *
 * hydrate() shows the snapshot when the server hasn't answered yet; the
 * watchers keep it current from both REST loads and WebSocket updates.
 */
export function useOfflinePersistence() {
  const roomStore = useRoomStore()
  const categoryStore = useCategoryStore()
  const usersStore = useUsersStore()
  const permissionsStore = usePermissionsStore()
  const userStore = useUserStore()
  const textChatStore = useTextChatStore()

  async function hydrate() {
    if (!userStore.hasCompletedAuth || !offlineCacheUser()) return
    const [rooms, categories, users, permissions] = await Promise.all([
      cacheGet<Room[]>("kv", "rooms"),
      cacheGet<Category[]>("kv", "categories"),
      cacheGet<PublicUser[]>("kv", "users"),
      cacheGet<PermissionsSnapshot>("kv", "permissions"),
    ])
    // Fresh server data may already be here; never overwrite it.
    if (rooms?.length && !roomStore.rooms.length) roomStore.setRooms(rooms, false)
    if (categories?.length && !categoryStore.categories.length) {
      categoryStore.setCategories(categories)
    }
    if (users?.length) usersStore.hydrateFromCache(users)
    if (permissions) permissionsStore.hydrateFromCache(permissions)
    // Messages written offline in an earlier session show as queued again.
    void textChatStore.restoreOutbox()
  }

  // Voice participants are live state: a stale list offline would be wrong.
  const roomsForCache = () => roomStore.rooms.map((r) => ({ ...r, users: [], user_count: 0 }))

  watch(
    () => roomStore.rooms,
    () => {
      if (roomStore.roomsFromServer && roomStore.rooms.length) {
        cachePutDebounced("kv", "rooms", roomsForCache)
      }
    },
    { deep: true },
  )
  watch(
    () => categoryStore.categories,
    () => {
      if (roomStore.roomsFromServer && categoryStore.categories.length) {
        cachePutDebounced("kv", "categories", () => categoryStore.categories)
      }
    },
    { deep: true },
  )
  watch(
    () => usersStore.allUsers,
    (users) => {
      if (users.length) cachePutDebounced("kv", "users", () => usersStore.allUsers)
    },
    { deep: true },
  )
  watch(
    () => [permissionsStore.me, permissionsStore.roles, permissionsStore.userRoles],
    () => {
      if (permissionsStore.me) {
        cachePutDebounced("kv", "permissions", () => permissionsStore.snapshot())
      }
    },
  )

  return { hydrate }
}
