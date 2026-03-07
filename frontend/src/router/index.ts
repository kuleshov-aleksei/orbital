import { createRouter, createWebHistory, createWebHashHistory } from "vue-router"
import { useUserStore } from "@/stores"

const isElectron = window.location.protocol === "file:"
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
      path: "/admin",
      name: "admin",
      component: () => import("@/views/AdminPanel.vue"),
      meta: { requiresSuperAdmin: true },
    },
    {
      path: "/auth/callback",
      name: "auth-callback",
      alias: "/auth/callback/",
      component: () => import("@/views/AuthCallback.vue"),
    },
  ],
})

// Navigation guard to protect admin routes
router.beforeEach((to, _from, next) => {
  const userStore = useUserStore()

  // Check if route requires super admin access
  if (to.meta.requiresSuperAdmin) {
    // Redirect if not authenticated or not a super admin
    if (!userStore.isAuthenticated || !userStore.isSuperAdmin) {
      next("/")
      return
    }
  }

  next()
})

export default router
