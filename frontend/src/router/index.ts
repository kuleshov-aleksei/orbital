import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/components/AppLayout.vue'),
    },
    {
      path: '/admin',
      name: 'admin',
      component: () => import('@/views/AdminPanel.vue'),
      meta: { requiresSuperAdmin: true },
    },
    {
      path: '/auth/callback',
      name: 'auth-callback',
      alias: '/auth/callback/',
      component: () => import('@/views/AuthCallback.vue'),
    },
  ],
})

// Navigation guard to protect admin routes
router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  
  // Check if route requires super admin access
  if (to.meta.requiresSuperAdmin) {
    // Redirect if not authenticated or not a super admin
    if (!userStore.isAuthenticated || !userStore.isSuperAdmin) {
      next('/')
      return
    }
  }
  
  next()
})

export default router