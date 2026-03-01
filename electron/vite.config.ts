import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import Icons from "unplugin-icons/vite"
import compression from "vite-plugin-compression"
import electron from "vite-plugin-electron"
import renderer from "vite-plugin-electron-renderer"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:8080"
const backendWsUrl = backendUrl.replace("http://", "ws://").replace("https://", "wss://")
const appVersion = process.env.VITE_APP_VERSION || "dev-unknown"

const frontendPath = resolve(__dirname, "../frontend")
const electronPath = resolve(__dirname)

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    vue(),
    Icons({
      compiler: "vue3",
      autoInstall: true,
    }),
    compression({
      algorithm: "gzip",
      ext: ".gz",
    }),
    compression({
      algorithm: "brotliCompress",
      ext: ".br",
    }),
    electron([
      {
        entry: resolve(electronPath, "src/main.ts"),
        onstart(args) {
          args.startup()
        },
        vite: {
          build: {
            outDir: resolve(electronPath, "dist-electron"),
            rollupOptions: {
              external: ["electron", "electron-updater", "electron-log"],
            },
          },
        },
      },
      {
        entry: resolve(electronPath, "src/preload.ts"),
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: resolve(electronPath, "dist-electron"),
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  root: resolve(frontendPath),
  base: "./",
  resolve: {
    alias: {
      "@": resolve(frontendPath, "src"),
    },
  },
  build: {
    outDir: resolve(frontendPath, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      external: ["snd-lib"],
      output: {
        manualChunks: {
          "vendor-livekit": ["livekit-client"],
          "vendor-avatar": ["vue-advanced-cropper", "vue-boring-avatars"],
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: backendUrl,
        changeOrigin: true,
      },
      "/ws": {
        target: backendWsUrl,
        ws: true,
      },
    },
  },
})
