import { defineConfig, mergeConfig, type PluginOption } from "vite"
import { resolve } from "path"
import baseConfig from "./vite.config"

// Android (Capacitor) build of the same frontend. Like electron/vite.config.ts it
// bakes in the absolute backend URLs, because the WebView origin is
// https://localhost and relative /api paths would hit the bundled assets.
const backendUrl = process.env.VITE_BACKEND_URL || "http://localhost:8080"
const backendWsUrl = backendUrl.replace("http://", "ws://").replace("https://", "wss://")

// The .gz/.br copies are for nginx; inside the APK they only add size.
const isCompression = (p: PluginOption) =>
  !!p && typeof p === "object" && "name" in p && p.name === "vite:compression"

export default mergeConfig(
  { ...baseConfig, plugins: (baseConfig.plugins ?? []).flat().filter((p) => !isCompression(p)) },
  defineConfig({
    define: {
      __BACKEND_URL__: JSON.stringify(backendUrl),
      __BACKEND_WS_URL__: JSON.stringify(backendWsUrl),
    },
    base: "./",
    build: {
      outDir: resolve(__dirname, "../mobile/dist"),
      emptyOutDir: true,
    },
  }),
)
