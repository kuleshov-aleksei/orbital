import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const isHttps = process.env.VITE_HTTPS === 'true'
const backendUrl = process.env.VITE_BACKEND_URL || 'http://localhost:8080'
const backendWsUrl = backendUrl.replace('http://', 'ws://').replace('https://', 'wss://')

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    https: isHttps ? {
      key: readFileSync('../certs/key.pem'),
      cert: readFileSync('../certs/cert.pem'),
    } : undefined,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        secure: !isHttps, // Don't verify SSL when backend is HTTP
      },
      '/ws': {
        target: backendWsUrl,
        ws: true,
        secure: !isHttps,
      },
    },
    headers: {
      // Required for AudioWorklet and WASM
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate WASM-related chunks
          'wasm-noise': ['@sapphi-red/web-noise-suppressor'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@sapphi-red/web-noise-suppressor'],
  },
})
