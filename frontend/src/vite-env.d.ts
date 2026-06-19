/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __BACKEND_URL__: string
declare const __VITE_DEV_SERVER_URL__: string

declare module "howler" {
  interface HowlOptions {
    src: string | string[]
    sprite?: Record<string, [number, number]>
    html5?: boolean
    volume?: number
    preload?: boolean
    onloaderror?: (id: number, error: string) => void
    onload?: () => void
    [key: string]: unknown
  }

  class Howl {
    constructor(options: HowlOptions)
    play(spriteId?: string): number
    pause(id?: number): void
    stop(id?: number): void
    volume(volume?: number): number
    state(): string
    once(event: string, callback: (...args: unknown[]) => void, id?: number): void
    on(event: string, callback: (...args: unknown[]) => void, id?: number): void
    off(event: string, callback?: (...args: unknown[]) => void, id?: number): void
    duration(id?: number): number
    seek(seek?: number, id?: number): number
    load(): void
    unload(): void
  }

  namespace Howler {
    function mute(muted: boolean): void
    function volume(volume?: number): number
    const ctx: AudioContext
  }
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
