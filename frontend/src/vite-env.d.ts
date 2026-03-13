/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __BACKEND_URL__: string

declare module 'howler' {
  export const Howl: any
  export const Howler: any
}

declare module "*.wasm?url" {
  const url: string
  export default url
}

declare module "*.wasm?raw" {
  const content: string
  export default content
}

declare module "*?url" {
  const url: string
  export default url
}
