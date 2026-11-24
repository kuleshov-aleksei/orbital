// Build-time constants (electron/vite.config.ts `define` for main and preload).

/** Shell API version (shell-api.json "electron"). */
declare const __SHELL_API__: number
/** Update feed root baked into the build (UPDATE_URL); "" in local builds. */
declare const __UPDATE_URL__: string
/** Backend URL the built-in renderer talks to (VITE_BACKEND_URL). */
declare const __BACKEND_URL__: string
