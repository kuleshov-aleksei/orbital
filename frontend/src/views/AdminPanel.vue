<template>
  <div class="admin-panel p-4 lg:p-8 overflow-y-auto h-full">
    <div class="max-w-4xl mx-auto">
      <!-- Header -->
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold text-white">Admin Panel</h1>

          <p class="text-gray-400 mt-1">Manage users and system settings</p>
        </div>

        <div class="flex items-center gap-2">
          <span class="px-3 py-1 bg-indigo-600 text-white text-sm rounded-full">
            {{ currentUserRole === "super_admin" ? "Super Admin" : "Admin" }}
          </span>
        </div>
      </div>

      <!-- Tabs -->
      <div class="flex border-b border-gray-700 mb-6">
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'users'
              ? 'text-white border-b-2 border-indigo-500'
              : 'text-gray-400 hover:text-gray-200'
          "
          @click="activeTab = 'users'">
          Users
        </button>
        <button
          v-if="isSuperAdmin"
          type="button"
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'logs'
              ? 'text-white border-b-2 border-indigo-500'
              : 'text-gray-400 hover:text-gray-200'
          "
          @click="activeTab = 'logs'">
          Debug Logs
        </button>
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'audio'
              ? 'text-white border-b-2 border-indigo-500'
              : 'text-gray-400 hover:text-gray-200'
          "
          @click="activeTab = 'audio'">
          Audio
        </button>
        <button
          v-if="isSuperAdmin"
          type="button"
          class="px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'stats'
              ? 'text-white border-b-2 border-indigo-500'
              : 'text-gray-400 hover:text-gray-200'
          "
          @click="activateStatsTab">
          Stats
        </button>
      </div>

      <!-- Users Section -->
      <div v-if="activeTab === 'users'" class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-white">Users</h2>

          <div class="flex items-center gap-4">
            <span class="text-sm text-gray-400">{{ users.length }} total</span>

            <button
              v-if="isSuperAdmin"
              type="button"
              class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
              :disabled="deletingGuests"
              @click="deleteAllGuests">
              <span v-if="deletingGuests">Deleting...</span>
              <span v-else>Delete All Guests</span>
            </button>
          </div>
        </div>

        <div class="divide-y divide-gray-700">
          <div
            v-for="user in users"
            :key="user.id"
            class="p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors">
            <div class="flex items-center gap-4">
              <!-- Avatar -->
              <div
                class="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center overflow-hidden flex-shrink-0">
                <img
                  v-if="user.avatar_url && !avatarErrors.has(user.id)"
                  :src="user.avatar_url"
                  :alt="user.nickname"
                  class="w-full h-full object-cover"
                  @error="avatarErrors.add(user.id)" />

                <Avatar
                  v-else
                  :name="user.nickname"
                  :colors="['#E8F5E9', '#C8E6C9', '#A5D6A7', '#81C784', '#66BB6A']"
                  variant="beam"
                  :size="40" />
              </div>

              <!-- User Info -->
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-medium text-white">{{ user.nickname }}</span>

                  <span
                    v-if="user.original_nickname && user.original_nickname !== user.nickname"
                    class="text-sm text-gray-500">
                    ({{ user.original_nickname }})
                  </span>

                  <span
                    v-if="user.id === currentUserId"
                    class="text-xs px-2 py-0.5 bg-gray-600 text-gray-300 rounded">
                    You
                  </span>
                </div>

                <div class="text-sm text-gray-400 flex items-center gap-2">
                  <span>{{ user.auth_provider }}</span>

                  <span class="text-gray-600">•</span>

                  <span :class="getRoleColor(user.role)">{{ formatRole(user.role) }}</span>
                </div>
              </div>
            </div>

            <!-- Actions - Only for super_admin -->
            <div v-if="isSuperAdmin && user.id !== currentUserId" class="flex items-center gap-2">
              <!-- Promote/Demote buttons - not shown for super_admin users -->
              <template v-if="user.role !== 'super_admin'">
                <button
                  v-if="user.role === 'user'"
                  type="button"
                  class="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
                  :disabled="promotingUserId === user.id"
                  @click="promoteUser(user.id)">
                  <span v-if="promotingUserId === user.id">Promoting...</span>

                  <span v-else>Make Admin</span>
                </button>

                <button
                  v-if="user.role === 'admin'"
                  type="button"
                  class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                  :disabled="demotingUserId === user.id"
                  @click="demoteUser(user.id)">
                  <span v-if="demotingUserId === user.id">Demoting...</span>

                  <span v-else>Remove Admin</span>
                </button>

                <button
                  type="button"
                  class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                  :disabled="deletingUserId === user.id"
                  @click="confirmDeleteUser(user)">
                  <span v-if="deletingUserId === user.id">Deleting...</span>

                  <span v-else>Delete</span>
                </button>
              </template>

              <!-- Super admin indicator -->
              <span v-else class="text-xs px-2 py-1 bg-purple-600/20 text-purple-400 rounded">
                Super Admin
              </span>
            </div>

            <!-- Non-super_admin view or self view -->
            <div v-else class="text-sm text-gray-500">
              {{ formatRole(user.role) }}
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="users.length === 0" class="p-8 text-center">
          <PhUsers class="w-12 h-12 text-gray-600 mx-auto mb-4" />

          <p class="text-gray-400">No users found</p>
        </div>
      </div>

      <!-- Logs Section (Super Admin Only) -->
      <div
        v-if="activeTab === 'logs' && isSuperAdmin"
        class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-white">Debug Logs</h2>

          <div class="flex items-center gap-4">
            <span class="text-sm text-gray-400">{{ logs.length }} logs</span>

            <button
              type="button"
              class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
              :disabled="loadingLogs"
              @click="loadLogs">
              <span v-if="loadingLogs">Loading...</span>
              <span v-else>Refresh</span>
            </button>
          </div>
        </div>

        <div class="divide-y divide-gray-700">
          <div
            v-for="log in logs"
            :key="log.id"
            class="p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-medium text-white">{{ log.username }}</span>

                <span class="text-xs px-2 py-0.5 bg-gray-600 text-gray-300 rounded">
                  ID: {{ log.user_id.slice(0, 8) }}...
                </span>

                <span
                  v-if="log.version"
                  class="text-xs px-2 py-0.5 bg-indigo-600/20 text-indigo-400 rounded">
                  {{ log.version }}
                </span>
              </div>

              <div class="text-sm text-gray-400">
                {{ formatDate(log.created_at) }} • {{ log.log_filename }}
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
                @click="viewLog(log.id)">
                View
              </button>

              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                @click="downloadLog(log)">
                Download
              </button>

              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                :disabled="deletingLogId === log.id"
                @click="confirmDeleteLog(log.id)">
                <span v-if="deletingLogId === log.id">Deleting...</span>
                <span v-else>Delete</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="logs.length === 0 && !loadingLogs" class="p-8 text-center">
          <PhFileText class="w-12 h-12 text-gray-600 mx-auto mb-4" />

          <p class="text-gray-400">No debug logs found</p>
        </div>
      </div>

      <!-- Audio Section -->
      <div v-if="activeTab === 'audio'" class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-white">Audio Files</h2>

          <div class="flex items-center gap-4">
            <span class="text-sm text-gray-400">{{ audioFiles.length }} files</span>

            <button
              type="button"
              class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
              :disabled="loadingAudio"
              @click="loadAudio">
              <span v-if="loadingAudio">Loading...</span>
              <span v-else>Refresh</span>
            </button>
          </div>
        </div>

        <div class="divide-y divide-gray-700">
          <div
            v-for="file in audioFiles"
            :key="file.id"
            class="p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <!-- Inline rename -->
                <template v-if="renamingAudioId === file.id">
                  <input
                    v-model="renameValue"
                    type="text"
                    class="bg-gray-700 text-white px-2 py-1 rounded text-sm border border-gray-600 focus:border-indigo-500 outline-none w-48"
                    @keyup.enter="doRenameAudio(file.id)"
                    @keyup.escape="renamingAudioId = null"
                    @blur="doRenameAudio(file.id)" />
                </template>
                <span v-else class="font-medium text-white truncate">{{ file.display_name }}</span>

                <span
                  v-if="file.is_system"
                  class="text-xs px-2 py-0.5 bg-indigo-600/20 text-indigo-400 rounded">
                  System
                </span>
              </div>

              <div class="text-sm text-gray-400 flex items-center gap-2 mt-0.5">
                <span>{{ formatFileSize(file.file_size) }}</span>

                <span class="text-gray-600">•</span>

                <span>{{ formatDate(file.created_at) }}</span>
              </div>
            </div>

            <div class="flex items-center gap-2 ml-4 flex-shrink-0">
              <button
                v-if="!file.is_system && !renamingAudioId && deletingAudioId !== file.id"
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                @click="startRename(file)">
                Rename
              </button>

              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50"
                :disabled="deletingAudioId === file.id"
                @click="confirmDeleteAudio(file.id)">
                <span v-if="deletingAudioId === file.id">Deleting...</span>
                <span v-else>Delete</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="audioFiles.length === 0 && !loadingAudio" class="p-8 text-center">
          <PhMusicNote class="w-12 h-12 text-gray-600 mx-auto mb-4" />

          <p class="text-gray-400">No audio files found</p>
        </div>
      </div>

      <!-- Stats Section (Super Admin Only) -->
      <div v-if="activeTab === 'stats' && isSuperAdmin" class="space-y-4">
        <!-- Room Selector & Controls -->
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-lg font-semibold text-white">Stats Map</h2>
            <span class="text-sm text-gray-400">
              {{ enabledRoomsCount }} room{{ enabledRoomsCount !== 1 ? "s" : "" }} collecting
            </span>
          </div>
          <p class="text-sm text-gray-400 mb-4">
            Hover over an avatar to see per-pair connection metrics.
          </p>

          <div class="flex items-center gap-4">
            <div class="flex-1">
              <select
                v-model="statsRoomId"
                class="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-indigo-500 outline-none"
                @change="onStatsRoomChange">
                <option value="" disabled>Select a room...</option>
                <option v-for="room in adminStats.rooms.value" :key="room.id" :value="room.id">
                  {{ room.name }} ({{ room.user_count }} user{{ room.user_count !== 1 ? "s" : "" }})
                </option>
              </select>
            </div>

            <button
              type="button"
              class="px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
              :class="
                adminStats.statsEnabled.value
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              "
              :disabled="!statsRoomId || adminStats.toggling.value"
              @click="onStatsToggle(statsRoomId)">
              <span v-if="adminStats.toggling.value">Processing...</span>
              <span v-else-if="adminStats.statsEnabled.value">Disable Stats</span>
              <span v-else>Enable Stats</span>
            </button>
          </div>
        </div>

        <!-- Stats Map -->
        <div v-if="adminStats.statsEnabled.value && statsRoomId">
          <StatsMap :reports="adminStats.reports.value" :get-latest-rtt="adminStats.getLatestRtt" />
        </div>

        <!-- Stats disabled state -->
        <div
          v-else-if="statsRoomId && !adminStats.statsEnabled.value"
          class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
          <div class="text-gray-400">Stats collection is disabled for this room</div>
          <div class="text-gray-500 text-sm mt-1">
            Click "Enable Stats" above to start receiving connection metrics from participants.
          </div>
        </div>

        <!-- No room selected -->
        <div
          v-if="!statsRoomId"
          class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
          <div class="text-gray-400">Select a room to get started</div>
        </div>
      </div>

      <!-- Info Section -->
      <div v-if="activeTab === 'users'" class="mt-6 bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h3 class="text-sm font-medium text-gray-300 mb-2">Role Information</h3>

        <div class="space-y-2 text-sm text-gray-400">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-gray-500"></span>

            <span><strong>Guest:</strong> Can join rooms but cannot create or manage anything</span>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-blue-500"></span>

            <span><strong>User:</strong> Authenticated user who can join rooms</span>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-indigo-500"></span>

            <span><strong>Admin:</strong> Can create, edit, and delete rooms and categories</span>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-purple-500"></span>

            <span
              ><strong>Super Admin:</strong> Can promote/demote other users to admin (only one can
              exist)</span
            >
          </div>
        </div>
      </div>
    </div>

    <!-- Delete User Confirmation Modal -->
    <div
      v-if="showDeleteModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="showDeleteModal = false">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
        <h3 class="text-lg font-semibold text-white mb-4">Delete User</h3>

        <p class="text-gray-300 mb-6">
          Are you sure you want to delete <strong>{{ userToDelete?.nickname }}</strong
          >? This action cannot be undone.
        </p>

        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
            @click="showDeleteModal = false">
            Cancel
          </button>

          <button
            type="button"
            class="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
            @click="deleteUser">
            Delete
          </button>
        </div>
      </div>
    </div>

    <!-- View Log Modal -->
    <div
      v-if="showLogModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="showLogModal = false">
      <div
        class="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-lg font-semibold text-white">Debug Log</h3>
            <p class="text-sm text-gray-400">
              {{ selectedLog?.username }} ({{ selectedLog?.user_id }}) •
              {{ formatDate(selectedLog?.created_at || "") }}
            </p>
          </div>

          <button
            type="button"
            class="text-gray-400 hover:text-white"
            @click="showLogModal = false">
            <PhX class="w-6 h-6" />
          </button>
        </div>

        <div class="flex-1 overflow-auto bg-gray-900 rounded p-4">
          <pre class="text-sm text-green-400 font-mono whitespace-pre-wrap">{{ logContent }}</pre>
        </div>
      </div>
    </div>

    <!-- Delete Log Confirmation Modal -->
    <div
      v-if="showDeleteLogModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="showDeleteLogModal = false">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
        <h3 class="text-lg font-semibold text-white mb-4">Delete Log</h3>

        <p class="text-gray-300 mb-6">
          Are you sure you want to delete this debug log? This action cannot be undone.
        </p>

        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
            @click="showDeleteLogModal = false">
            Cancel
          </button>

          <button
            type="button"
            class="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
            @click="deleteLog">
            Delete
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Audio Confirmation Modal -->
    <div
      v-if="showDeleteAudioModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      @click.self="showDeleteAudioModal = false">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 max-w-md w-full mx-4">
        <h3 class="text-lg font-semibold text-white mb-4">Delete Audio File</h3>

        <p class="text-gray-300 mb-6">
          Are you sure you want to delete this audio file? This action cannot be undone.
        </p>

        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
            @click="showDeleteAudioModal = false">
            Cancel
          </button>

          <button
            type="button"
            class="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
            @click="deleteAudioFile">
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import { storeToRefs } from "pinia"
import Avatar from "vue-boring-avatars"
import { useUserStore } from "@/stores"
import { apiService } from "@/services/api"
import { useAdminStats } from "@/composables/useAdminStats"
import StatsMap from "@/components/admin/StatsMap.vue"
import { wsService } from "@/services/websocket"
import type { RoomStatsMessage } from "@/types"
import type { User, DebugLog, AudioFile } from "@/types"
import { PhUsers, PhFileText, PhMusicNote, PhX } from "@phosphor-icons/vue"

const userStore = useUserStore()
const { currentUser, isSuperAdmin } = storeToRefs(userStore)

const users = ref<User[]>([])
const logs = ref<DebugLog[]>([])
const loading = ref(false)
const loadingLogs = ref(false)
const promotingUserId = ref<string | null>(null)
const demotingUserId = ref<string | null>(null)
const deletingUserId = ref<string | null>(null)
const deletingLogId = ref<number | null>(null)
const deletingGuests = ref(false)
const avatarErrors = ref<Set<string>>(new Set())

const activeTab = ref<"users" | "logs" | "audio" | "stats">("users")

const showDeleteModal = ref(false)
const userToDelete = ref<User | null>(null)

const showLogModal = ref(false)
const selectedLog = ref<DebugLog | null>(null)
const logContent = ref("")

const showDeleteLogModal = ref(false)
const logToDelete = ref<number | null>(null)

const audioFiles = ref<AudioFile[]>([])
const loadingAudio = ref(false)
const renamingAudioId = ref<string | null>(null)
const renameValue = ref("")
const deletingAudioId = ref<string | null>(null)
const showDeleteAudioModal = ref(false)
const audioToDelete = ref<string | null>(null)

const currentUserId = computed(() => currentUser.value?.id)
const currentUserRole = computed(() => currentUser.value?.role)

// Admin Stats
const adminStats = useAdminStats()
const statsRoomId = ref("")
const enabledRoomsCount = computed(
  () => adminStats.statsStatuses.value.filter((s) => s.enabled).length,
)

const handleRoomStatsMessage = (message: { type: string; data: unknown }) => {
  if (message.type === "room_stats") {
    const msg = message.data as RoomStatsMessage
    if (msg.room_id === statsRoomId.value) {
      adminStats.reports.value = msg.reports
    }
  }
}

const activateStatsTab = async () => {
  activeTab.value = "stats"
  wsService.onGlobal("room_stats", handleRoomStatsMessage)
  await Promise.all([adminStats.loadRooms(), adminStats.loadStatsStatus()])
}

const onStatsRoomChange = async () => {
  if (statsRoomId.value) {
    await adminStats.selectRoom(statsRoomId.value)
  }
}

const onStatsToggle = async (roomId: string) => {
  await adminStats.toggleStats(roomId)
}

onUnmounted(() => {
  wsService.offGlobal("room_stats", handleRoomStatsMessage)
})

const getRoleColor = (role: string): string => {
  switch (role) {
    case "super_admin":
      return "text-purple-400"
    case "admin":
      return "text-indigo-400"
    case "user":
      return "text-blue-400"
    case "guest":
    default:
      return "text-gray-400"
  }
}

const formatRole = (role: string): string => {
  switch (role) {
    case "super_admin":
      return "Super Admin"
    case "admin":
      return "Admin"
    case "user":
      return "User"
    case "guest":
      return "Guest"
    default:
      return role
  }
}

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const formatDate = (dateStr: string): string => {
  if (!dateStr) return ""
  const date = new Date(dateStr)
  return date.toLocaleString()
}

const loadUsers = async () => {
  loading.value = true
  try {
    const response = await apiService.getUsers()
    users.value = response
  } catch (error) {
    console.error("Failed to load users:", error)
  } finally {
    loading.value = false
  }
}

const loadLogs = async () => {
  loadingLogs.value = true
  try {
    const response = await apiService.getLogs()
    logs.value = response
  } catch (error) {
    console.error("Failed to load logs:", error)
  } finally {
    loadingLogs.value = false
  }
}

const promoteUser = async (userId: string) => {
  promotingUserId.value = userId
  try {
    await apiService.promoteUser(userId)
    await loadUsers()
  } catch (error) {
    console.error("Failed to promote user:", error)
  } finally {
    promotingUserId.value = null
  }
}

const demoteUser = async (userId: string) => {
  demotingUserId.value = userId
  try {
    await apiService.demoteUser(userId)
    await loadUsers()
  } catch (error) {
    console.error("Failed to demote user:", error)
  } finally {
    demotingUserId.value = null
  }
}

const confirmDeleteUser = (user: User) => {
  userToDelete.value = user

  if (user.role === "guest") {
    deleteUser()
  } else {
    showDeleteModal.value = true
  }
}

const deleteUser = async () => {
  if (!userToDelete.value) return

  deletingUserId.value = userToDelete.value.id
  showDeleteModal.value = false

  try {
    await apiService.deleteUser(userToDelete.value.id)
    await loadUsers()
  } catch (error) {
    console.error("Failed to delete user:", error)
  } finally {
    deletingUserId.value = null
    userToDelete.value = null
  }
}

const deleteAllGuests = async () => {
  deletingGuests.value = true
  try {
    await apiService.deleteAllGuests()
    await loadUsers()
  } catch (error) {
    console.error("Failed to delete guests:", error)
  } finally {
    deletingGuests.value = false
  }
}

const viewLog = async (logId: number) => {
  try {
    const response = await apiService.getLog(logId)
    selectedLog.value = response.log
    logContent.value = response.content
    showLogModal.value = true
  } catch (error) {
    console.error("Failed to load log:", error)
  }
}

const downloadLog = async (log: DebugLog) => {
  try {
    const response = await apiService.getLog(log.id)
    const blob = new Blob([response.content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = response.log.log_filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error("Failed to download log:", error)
  }
}

const confirmDeleteLog = (logId: number) => {
  logToDelete.value = logId
  showDeleteLogModal.value = true
}

const loadAudio = async () => {
  loadingAudio.value = true
  try {
    audioFiles.value = await apiService.getAudioFiles()
  } catch (error) {
    console.error("Failed to load audio files:", error)
  } finally {
    loadingAudio.value = false
  }
}

const startRename = (file: AudioFile) => {
  renamingAudioId.value = file.id
  renameValue.value = file.display_name
}

const doRenameAudio = async (id: string) => {
  const name = renameValue.value.trim()
  if (!name || renamingAudioId.value !== id) {
    renamingAudioId.value = null
    return
  }

  renamingAudioId.value = null
  try {
    await apiService.renameAudio(id, name)
    await loadAudio()
  } catch (error) {
    console.error("Failed to rename audio:", error)
  }
}

const confirmDeleteAudio = (id: string) => {
  audioToDelete.value = id
  showDeleteAudioModal.value = true
}

const deleteAudioFile = async () => {
  if (!audioToDelete.value) return

  deletingAudioId.value = audioToDelete.value
  showDeleteAudioModal.value = false

  try {
    await apiService.deleteAudio(audioToDelete.value)
    await loadAudio()
  } catch (error) {
    console.error("Failed to delete audio:", error)
  } finally {
    deletingAudioId.value = null
    audioToDelete.value = null
  }
}

const deleteLog = async () => {
  if (!logToDelete.value) return

  deletingLogId.value = logToDelete.value
  showDeleteLogModal.value = false

  try {
    await apiService.deleteLog(logToDelete.value)
    await loadLogs()
  } catch (error) {
    console.error("Failed to delete log:", error)
  } finally {
    deletingLogId.value = null
    logToDelete.value = null
  }
}

onMounted(() => {
  void loadUsers()
  void loadAudio()
  if (isSuperAdmin.value) {
    void loadLogs()
    void adminStats.loadRooms()
    void adminStats.loadStatsStatus()
  }
})
</script>
