import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/components/AppLayout.vue'),
    },
    {
      path: '/auth/callback',
      name: 'auth-callback',
      alias: '/auth/callback/',
      component: () => import('@/views/AuthCallback.vue'),
    },
  ],
})

export default router