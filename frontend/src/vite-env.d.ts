/// <reference types="vite/client" />

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
