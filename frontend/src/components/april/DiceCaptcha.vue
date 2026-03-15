<template>
  <div class="text-center">
    <h2 class="text-2xl font-bold mb-2 text-red-500">Roll for Doubles</h2>
    
    <p class="text-sm text-gray-400 mb-4">
      Roll both dice and get the same number on both to verify
    </p>

    <div v-if="!isCompleted" class="flex flex-col items-center">
      <!-- Three.js Canvas -->
      <div ref="canvasContainer" class="w-64 h-64 mb-4 rounded-lg overflow-hidden bg-gray-900">
        <canvas ref="canvas" class="w-full h-full"></canvas>
      </div>

      <!-- Result display -->
      <div class="flex items-center justify-center gap-4 mb-4">
        <div class="text-2xl font-bold">
          <span class="text-gray-400">Dice 1: </span>
          <span :class="dice1Result ? 'text-white' : 'text-gray-600'">{{ dice1Result || '?' }}</span>
        </div>
        <div class="text-2xl font-bold">
          <span class="text-gray-400">Dice 2: </span>
          <span :class="dice2Result ? 'text-white' : 'text-gray-600'">{{ dice2Result || '?' }}</span>
        </div>
      </div>

      <!-- Status message -->
      <div v-if="statusMessage" class="mb-4 text-sm font-bold" :class="isSuccess ? 'text-green-400' : 'text-red-400'">
        {{ statusMessage }}
      </div>

      <!-- Roll button -->
      <button
        v-if="!isRolling"
        type="button"
        class="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-colors duration-200"
        @click="rollDice"
      >
        Roll Dice!
      </button>

      <button
        v-else
        type="button"
        class="px-8 py-3 bg-gray-600 text-gray-300 font-bold rounded-lg cursor-not-allowed"
        disabled
      >
        Rolling...
      </button>
    </div>

    <!-- Completion checkmark -->
    <Transition name="fade">
      <div v-if="isCompleted" class="py-8">
        <svg
          class="w-16 h-16 text-green-500 mx-auto mb-4 animate-bounce"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
        </svg>
        <p class="text-green-400 font-bold">Verification Complete!</p>
      </div>
    </Transition>

    <div class="text-sm text-gray-400 mt-2">
      {{ getTypeLabel() }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import * as CANNON from "cannon-es"
import { useAprilStore } from "@/stores/april"

const aprilStore = useAprilStore()

const canvasContainer = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)

const isCompleted = ref(false)
const isRolling = ref(false)
const dice1Result = ref<number | null>(null)
const dice2Result = ref<number | null>(null)
const statusMessage = ref("")
const isSuccess = ref(false)
const debugDice1Up = ref("")
const debugDice2Up = ref("")

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let dice1Mesh: THREE.Mesh | null = null
let dice2Mesh: THREE.Mesh | null = null

let world: CANNON.World
let dice1Body: CANNON.Body | null = null
let dice2Body: CANNON.Body | null = null

let animationId: number | null = null
let physicsIntervalId: number | null = null
let isInitialized = false

const diceSize = 1
const diceHalfSize = diceSize / 2
const modelScale = 0.005

function getTypeLabel(): string {
  switch (aprilStore.currentType) {
    case "join":
      return "Join attempt blocked"
    case "theme":
      return "Theme change intercepted"
    case "settings":
      return "Settings access denied"
    case "mute":
      return "Mute action stopped"
    case "leave":
      return "Leave prevented"
    case "volume":
      return "Volume adjustment halted"
    case "video":
      return "Camera sharing blocked"
    case "screenshare":
      return "Screensharing blocked"
    default:
      return "Captcha required"
  }
}

function initScene() {
  if (!canvas.value || !canvasContainer.value) return

  const width = canvasContainer.value.clientWidth
  const height = canvasContainer.value.clientHeight

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)

  camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000)
  camera.position.set(3, 2.5, 3)
  camera.lookAt(0, 1, 0)

  renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true })
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true

  const ambientLight = new THREE.AmbientLight(0xffffff, 2.5)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2)
  directionalLight.position.set(5, 10, -5)
  directionalLight.castShadow = true
  scene.add(directionalLight)

  const planeGeometry = new THREE.PlaneGeometry(50, 50)
  const planeMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a4e })
  const plane = new THREE.Mesh(planeGeometry, planeMaterial)
  plane.rotation.x = -Math.PI / 2
  plane.receiveShadow = true
  scene.add(plane)

  animate()
}

function initPhysics() {
  world = new CANNON.World()
  world.gravity.set(0, -15, 0)
  world.broadphase = new CANNON.NaiveBroadphase()

  const wallMaterial = new CANNON.Material("wall")
  
  const bounds = {
    x: 2.5,
    y: 12,
    z: 2.5,
  }

  const wallThickness = 0.5

  const walls = [
    { pos: new CANNON.Vec3(0, -wallThickness/2, 0), size: new CANNON.Vec3(bounds.x, wallThickness/2, bounds.z), rot: 0 },
    { pos: new CANNON.Vec3(0, bounds.y + wallThickness/2, 0), size: new CANNON.Vec3(bounds.x, wallThickness/2, bounds.z), rot: 0 },
    { pos: new CANNON.Vec3(-bounds.x - wallThickness/2, bounds.y/2, 0), size: new CANNON.Vec3(wallThickness/2, bounds.y, bounds.z), rot: 0 },
    { pos: new CANNON.Vec3(bounds.x + wallThickness/2, bounds.y/2, 0), size: new CANNON.Vec3(wallThickness/2, bounds.y, bounds.z), rot: 0 },
    { pos: new CANNON.Vec3(0, bounds.y/2, -bounds.z - wallThickness/2), size: new CANNON.Vec3(bounds.x, bounds.y, wallThickness/2), rot: 0 },
    { pos: new CANNON.Vec3(0, bounds.y/2, bounds.z + wallThickness/2), size: new CANNON.Vec3(bounds.x, bounds.y, wallThickness/2), rot: 0 },
  ]

  walls.forEach(({ pos, size }) => {
    const wall = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(size),
      material: wallMaterial,
      position: pos,
    })
    world.addBody(wall)
  })

  const diceMaterial = new CANNON.Material("dice")
  
  const diceShape = new CANNON.Box(new CANNON.Vec3(diceHalfSize, diceHalfSize, diceHalfSize))

  dice1Body = new CANNON.Body({
    mass: 0.7,
    shape: diceShape,
    material: diceMaterial,
    linearDamping: 0.3,
    angularDamping: 0.3,
  })

  dice2Body = new CANNON.Body({
    mass: 0.7,
    shape: diceShape,
    material: diceMaterial,
    linearDamping: 0.3,
    angularDamping: 0.3,
  })

  world.addBody(dice1Body)
  world.addBody(dice2Body)
}

async function loadDiceModel(): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.load(
      "/assets/3dmodels/dice/dice.glb",
      (gltf) => {
        const model = gltf.scene
        model.scale.set(modelScale, modelScale, modelScale)
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })
        resolve(model)
      },
      undefined,
      reject,
    )
  })
}

function getDiceNumber(quaternion: THREE.Quaternion): number {
  const faces = [
    { dir: new THREE.Vector3(0, 1, 0), num: 2 },
    { dir: new THREE.Vector3(1, 0, 0), num: 4 },
    { dir: new THREE.Vector3(-1, 0, 0), num: 3 },
    { dir: new THREE.Vector3(0, 0, 1), num: 6 },
    { dir: new THREE.Vector3(0, 0, -1), num: 1 },
    { dir: new THREE.Vector3(0, -1, 0), num: 5 },
  ]

  let maxDot = -Infinity
  let result = 0

  for (const face of faces) {
    const up = face.dir.clone().applyQuaternion(quaternion)
    const dot = up.y
    if (dot > maxDot) {
      maxDot = dot
      result = face.num
    }
  }

  return result
}

function isDiceSettled(body: CANNON.Body): boolean {
  const linearSpeed = body.velocity.length()
  const angularSpeed = body.angularVelocity.length()
  return linearSpeed < 0.1 && angularSpeed < 0.1
}

function rollDice() {
  if (isRolling.value || isCompleted.value) return

  isRolling.value = true
  dice1Result.value = null
  dice2Result.value = null
  statusMessage.value = ""

  if (!dice1Body || !dice2Body) return

  dice1Body.position.set(
    (Math.random() - 0.5) * 1,
    6 + Math.random(),
    (Math.random() - 0.5) * 1
  )
  dice1Body.velocity.set(
    (Math.random() - 0.5) * 2,
    1 + Math.random(),
    (Math.random() - 0.5) * 2
  )
  dice1Body.angularVelocity.set(
    Math.random() * 8,
    Math.random() * 8,
    Math.random() * 8
  )

  dice2Body.position.set(
    (Math.random() - 0.5) * 1,
    6 + Math.random(),
    (Math.random() - 0.5) * 1
  )
  dice2Body.velocity.set(
    (Math.random() - 0.5) * 2,
    1 + Math.random(),
    (Math.random() - 0.5) * 2
  )
  dice2Body.angularVelocity.set(
    Math.random() * 8,
    Math.random() * 8,
    Math.random() * 8
  )

  let settleCount = 0
  const checkSettled = () => {
    if (!dice1Body || !dice2Body) return

    const dice1Settled = isDiceSettled(dice1Body)
    const dice2Settled = isDiceSettled(dice2Body)

    if (dice1Settled && dice2Settled) {
      settleCount++
    } else {
      settleCount = 0
    }

    if (settleCount > 30) {
      finishRoll()
      return
    }

    physicsIntervalId = window.setTimeout(checkSettled, 50)
  }

  physicsIntervalId = window.setTimeout(checkSettled, 50)
}

function finishRoll() {
  if (!dice1Mesh || !dice2Mesh || !dice1Body || !dice2Body) return

  dice1Result.value = getDiceNumber(dice1Mesh.quaternion)
  dice2Result.value = getDiceNumber(dice2Mesh.quaternion)

  isRolling.value = false

  if (dice1Result.value === dice2Result.value) {
    isSuccess.value = true
    statusMessage.value = `Doubles! You rolled ${dice1Result.value}-${dice2Result.value}`
    isCompleted.value = true
    setTimeout(() => {
      aprilStore.completeCaptcha()
    }, 2000)
  } else {
    isSuccess.value = false
    statusMessage.value = `Not doubles. You rolled ${dice1Result.value}-${dice2Result.value}. Try again!`
  }
}

function animate() {
  animationId = requestAnimationFrame(animate)

  if (world && dice1Body && dice2Body && dice1Mesh && dice2Mesh) {
    world.step(1 / 60)

    dice1Mesh.position.copy(dice1Body.position as unknown as THREE.Vector3)
    dice1Mesh.quaternion.copy(dice1Body.quaternion as unknown as THREE.Quaternion)

    dice2Mesh.position.copy(dice2Body.position as unknown as THREE.Vector3)
    dice2Mesh.quaternion.copy(dice2Body.quaternion as unknown as THREE.Quaternion)
  }

  renderer.render(scene, camera)
}

async function initCaptcha() {
  if (isInitialized) return
  isInitialized = true

  initScene()
  initPhysics()

  try {
    const diceModel = await loadDiceModel()

    dice1Mesh = diceModel.clone() as THREE.Mesh
    scene.add(dice1Mesh)

    dice2Mesh = diceModel.clone() as THREE.Mesh
    scene.add(dice2Mesh)
  } catch (error) {
    console.error("Failed to load dice model:", error)

    const diceGeometry = new THREE.BoxGeometry(diceSize, diceSize, diceSize)
    const diceMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff })

    dice1Mesh = new THREE.Mesh(diceGeometry, diceMaterial)
    dice2Mesh = new THREE.Mesh(diceGeometry, diceMaterial)
    scene.add(dice1Mesh)
    scene.add(dice2Mesh)
  }
}

function cleanup() {
  isInitialized = false
  
  if (animationId) {
    cancelAnimationFrame(animationId)
  }
  if (physicsIntervalId) {
    clearTimeout(physicsIntervalId)
  }
  if (renderer) {
    renderer.dispose()
  }
  
  dice1Mesh = null
  dice2Mesh = null
  dice1Body = null
  dice2Body = null
}

watch(() => aprilStore.isCaptchaActive, (active) => {
  if (active) {
    isCompleted.value = false
    dice1Result.value = null
    dice2Result.value = null
    statusMessage.value = ""
    isSuccess.value = false
    isInitialized = false
    
    initCaptcha()
    
    if (dice1Body && dice2Body) {
      dice1Body.position.set(0, 2, 0)
      dice1Body.velocity.set(0, 0, 0)
      dice1Body.angularVelocity.set(0, 0, 0)
      dice1Body.quaternion.set(0, 0, 0, 1)
      
      dice2Body.position.set(0, 2, 0)
      dice2Body.velocity.set(0, 0, 0)
      dice2Body.angularVelocity.set(0, 0, 0)
      dice2Body.quaternion.set(0, 0, 0, 1)
    }
  }
})

onMounted(() => {
  initCaptcha()
})

onUnmounted(() => {
  cleanup()
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
