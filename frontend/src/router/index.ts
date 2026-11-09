import { createRouter, createWebHistory, createWebHashHistory } from "vue-router"
import { useUserStore, usePermissionsStore } from "@/stores"
import { Permission } from "@/types/permissions"

const isElectron = window.location.protocol === "orbital:" || window.location.protocol === "file:"
const routerHistory = isElectron ? createWebHashHistory() : createWebHistory()

const router = createRouter({
  history: routerHistory,
  routes: [
    {
      path: "/",
      name: "home",
      component: () => import("@/components/AppLayout.vue"),
    },
    {
      path: "/download",
      name: "download",
      component: () => import("@/views/DownloadView.vue"),
    },
    {
      path: "/admin",
      name: "admin",
      component: () => import("@/views/AdminPanel.vue"),
      // Owner, or anyone with a permission managed there (roles / shared audio).
      // The backend authorizes every admin API call independently.
      meta: { requiresAdminPanel: true },
    },
    {
      path: "/auth/callback",
      name: "auth-callback",
      alias: "/auth/callback/",
      component: () => import("@/views/AuthCallback.vue"),
    },
    // Dev-only balance visualizer: live engine + renderer + bot policies.
    // Never linked in prod UI; the chunk is unreachable outside dev.
    ...(import.meta.env.DEV
      ? [
          {
            path: "/dev/balance",
            name: "dev-balance",
            component: () => import("@/components/halloween/BalanceVisual.vue"),
          },
        ]
      : []),
  ],
})

// Navigation guard to protect admin routes
router.beforeEach(async (to, _from, next) => {
  const userStore = useUserStore()

  if (to.meta.requiresAdminPanel) {
    if (!userStore.isAuthenticated) {
      next("/")
      return
    }
    if (!userStore.isSuperAdmin) {
      const permissionsStore = usePermissionsStore()
      if (!permissionsStore.loaded) {
        await permissionsStore.loadMine()
      }
      if (
        !permissionsStore.can(Permission.ManageRoles) &&
        !permissionsStore.can(Permission.ManageAudio)
      ) {
        next("/")
        return
      }
    }
  }

  next()
})

export default router
