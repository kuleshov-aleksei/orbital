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
            {{ currentUserRole === 'super_admin' ? 'Super Admin' : 'Admin' }}
          </span>
        </div>
      </div>

      <!-- Users Section -->
      <div class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-white">Users</h2>

          <span class="text-sm text-gray-400">{{ users.length }} total</span>
        </div>

        <div class="divide-y divide-gray-700">
          <div
            v-for="user in users"
            :key="user.id"
            class="p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors"
          >
            <div class="flex items-center gap-4">
              <!-- Avatar -->
              <div class="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center overflow-hidden flex-shrink-0">
                <img
                  v-if="user.avatar_url && !avatarErrors.has(user.id)"
                  :src="user.avatar_url"
                  :alt="user.nickname"
                  class="w-full h-full object-cover"
                  @error="avatarErrors.add(user.id)"
                />

                <Avatar
                  v-else
                  :name="user.nickname"
                  :colors="['#E8F5E9', '#C8E6C9', '#A5D6A7', '#81C784', '#66BB6A']"
                  variant="beam"
                  :size="40"
                />
              </div>

              <!-- User Info -->
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-medium text-white">{{ user.nickname }}</span>

                  <span
                    v-if="user.oauth_nickname && user.oauth_nickname !== user.nickname"
                    class="text-sm text-gray-500"
                  >
                    ({{ user.oauth_nickname }})
                  </span>

                  <span
                    v-if="user.id === currentUserId"
                    class="text-xs px-2 py-0.5 bg-gray-600 text-gray-300 rounded"
                  >
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
                  @click="promoteUser(user.id)"
                >
                  <span v-if="promotingUserId === user.id">Promoting...</span>

                  <span v-else>Make Admin</span>
                </button>

                <button
                  v-if="user.role === 'admin'"
                  type="button"
                  class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded transition-colors"
                  :disabled="demotingUserId === user.id"
                  @click="demoteUser(user.id)"
                >
                  <span v-if="demotingUserId === user.id">Demoting...</span>

                  <span v-else>Remove Admin</span>
                </button>
              </template>

              <!-- Super admin indicator -->
              <span
                v-else
                class="text-xs px-2 py-1 bg-purple-600/20 text-purple-400 rounded"
              >
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

      <!-- Info Section -->
      <div class="mt-6 bg-gray-800/50 rounded-lg border border-gray-700 p-4">
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

            <span><strong>Super Admin:</strong> Can promote/demote other users to admin (only one can exist)</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import Avatar from 'vue-boring-avatars'
import { useUserStore } from '@/stores'
import { apiService } from '@/services/api'
import type { User } from '@/types'
import { PhUsers } from '@phosphor-icons/vue'

const userStore = useUserStore()
const { currentUser, isSuperAdmin } = storeToRefs(userStore)

const users = ref<User[]>([])
const loading = ref(false)
const promotingUserId = ref<string | null>(null)
const demotingUserId = ref<string | null>(null)
const avatarErrors = ref<Set<string>>(new Set())

const currentUserId = computed(() => currentUser.value?.id)
const currentUserRole = computed(() => currentUser.value?.role)

const getRoleColor = (role: string): string => {
  switch (role) {
    case 'super_admin':
      return 'text-purple-400'
    case 'admin':
      return 'text-indigo-400'
    case 'user':
      return 'text-blue-400'
    case 'guest':
    default:
      return 'text-gray-400'
  }
}

const formatRole = (role: string): string => {
  switch (role) {
    case 'super_admin':
      return 'Super Admin'
    case 'admin':
      return 'Admin'
    case 'user':
      return 'User'
    case 'guest':
      return 'Guest'
    default:
      return role
  }
}

const loadUsers = async () => {
  loading.value = true
  try {
    const response = await apiService.getUsers()
    users.value = response
  } catch (error) {
    console.error('Failed to load users:', error)
  } finally {
    loading.value = false
  }
}

const promoteUser = async (userId: string) => {
  promotingUserId.value = userId
  try {
    await apiService.promoteUser(userId)
    await loadUsers()
  } catch (error) {
    console.error('Failed to promote user:', error)
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
    console.error('Failed to demote user:', error)
  } finally {
    demotingUserId.value = null
  }
}

onMounted(() => {
  void loadUsers()
})
</script>
