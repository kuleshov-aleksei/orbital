import { useSound } from '@vueuse/sound'
import { Howl } from 'howler'

const SPRITE_URL = '/assets/sounds/sprite/01/audioSprite.mp3'

const spriteMap = {
  toggle_on: [42000, 100],
  toggle_off: [40000, 100],
  transition_up: [46000, 100],
  transition_down: [44000, 100],
  tap: [30000, 10],
}

let sound: Howl | null = null

function getSound(): Howl {
  if (!sound) {
    sound = new Howl({
      src: [SPRITE_URL],
      sprite: spriteMap,
      html5: true,
    })
  }
  return sound
}

export function useSounds() {
  const { play } = useSound(SPRITE_URL, {
    sprite: spriteMap,
    html5: true,
  })

  const toggleOn = () => play({ id: 'toggle_on' })
  const toggleOff = () => play({ id: 'toggle_off' })
  const transitionOpen = () => play({ id: 'transition_up' })
  const transitionClose = () => play({ id: 'transition_down' })
  const tap = () => play({ id: 'tap' })

  return {
    toggleOn,
    toggleOff,
    transitionOpen,
    transitionClose,
    tap,
  }
}

export function toggleOn(): void {
  getSound().play('toggle_on')
}

export function toggleOff(): void {
  getSound().play('toggle_off')
}

export function transitionOpen(): void {
  getSound().play('transition_up')
}

export function transitionClose(): void {
  getSound().play('transition_down')
}

export function tap(): void {
  getSound().play('tap')
}
