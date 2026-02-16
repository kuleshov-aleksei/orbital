import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"
import Icons from "unplugin-icons/vite"
import { resolve } from "path"
import { readFileSync } from "fs"

const isHttps = process.env.VITE_HTTPS === "true"
const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:8080"
const backendWsUrl = backendUrl
  .replace("http://", "ws://")
  .replace("https://", "wss://")
const appVersion = process.env.VITE_APP_VERSION || "dev-unknown"

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
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    https: isHttps
      ? {
          key: readFileSync("../certs/key.pem"),
          cert: readFileSync("../certs/cert.pem"),
        }
      : undefined,
    proxy: {
      "/api": {
        target: backendUrl,
        changeOrigin: true,
        secure: !isHttps, // Don't verify SSL when backend is HTTP
      },
      "/ws": {
        target: backendWsUrl,
        ws: true,
        secure: !isHttps,
      },
    },
  },
})
