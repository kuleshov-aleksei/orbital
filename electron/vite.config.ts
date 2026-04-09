import fs from "node:fs"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import electron from "vite-plugin-electron/simple"
import Icons from "unplugin-icons/vite"
import compression from "vite-plugin-compression"
import tailwindcss from "@tailwindcss/vite"
import autoprefixer from "autoprefixer"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:8080"
const backendWsUrl = backendUrl.replace("http://", "ws://").replace("https://", "wss://")
const appVersion = process.env.VITE_APP_VERSION || "dev-unknown"

const frontendPath = resolve(__dirname, "../frontend")
const electronPath = resolve(__dirname)

function shimEventsPlugin() {
  return {
    name: "shim-events-plugin",
    resolveId(id: string) {
      if (id === "events" || id === "buffer" || id === "process") {
        return id
      }
      return null
    },
    load(id: string) {
      if (id === "events") {
        return `export default { EventEmitter: class EventEmitter { constructor() {} on() {} off() {} emit() {} } }`
      }
      if (id === "buffer") {
        return `export default { Buffer: class Buffer {} }`
      }
      if (id === "process") {
        return `export default {}`
      }
      return null
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const isServe = command === "serve"
  const isBuild = command === "build"
  const sourcemap = isServe

  const defineValues: Record<string, string> = {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BACKEND_URL__: JSON.stringify(backendUrl),
    __BACKEND_WS_URL__: JSON.stringify(backendWsUrl),
    __VITE_DEV_SERVER_URL__: JSON.stringify(process.env.VITE_DEV_SERVER_URL || ""),
  }

  if (isBuild && process.env.VITE_BACKEND_URL) {
    // These are already set above, keeping for clarity
  }

  return {
    define: defineValues,
    plugins: [
      vue(),
      shimEventsPlugin(),
      Icons({
        compiler: "vue3",
        autoInstall: true,
      }),
      tailwindcss(),
      compression({
        algorithm: "gzip",
        ext: ".gz",
      }),
      compression({
        algorithm: "brotliCompress",
        ext: ".br",
      }),
      electron({
        main: {
          entry: resolve(electronPath, "main/index.ts"),
          onstart({ startup }) {
            startup()
          },
          vite: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: resolve(electronPath, "dist-electron/main"),
              rollupOptions: {
                external: [],
              },
            },
            define: {
              "import.meta.url": isServe
                ? JSON.stringify(`file://${resolve(electronPath, "dist-electron/main/index.js")}`)
                : "process.resourcesUrl ? `file://${process.resourcesUrl}/app.asar/dist-electron/main/index.js` : undefined",
            },
          },
        },
        preload: {
          input: resolve(electronPath, "preload/index.ts"),
          vite: {
            build: {
              sourcemap: sourcemap ? "inline" : undefined,
              minify: isBuild,
              outDir: resolve(electronPath, "dist-electron/preload"),
            },
            define: {
              "import.meta.url": isServe
                ? JSON.stringify(`file://${resolve(electronPath, "dist-electron/preload/index.js")}`)
                : "process.resourcesUrl ? `file://${process.resourcesUrl}/app.asar/dist-electron/preload/index.js` : undefined",
            },
          },
        },
        renderer: {
          nodePolyfills: true,
        },
      }),
    ],
    root: resolve(frontendPath),
    base: "./",
    resolve: {
      alias: {
        "@": resolve(frontendPath, "src"),
      },
    },
    build: {
      outDir: resolve(electronPath, "dist"),
      emptyOutDir: true,
      rollupOptions: {
        external: [],
        output: {
          manualChunks: (id) => {
            if (id.includes("livekit-client")) {
              return "vendor-livekit"
            }
            if (id.includes("vue-advanced-cropper") || id.includes("vue-boring-avatars")) {
              return "vendor-avatar"
            }
          },
        },
      },
    },
    server: {
      port: 3001,
      optimizeDeps: {
        include: ["events", "buffer", "process"],
      },
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
  }
})
