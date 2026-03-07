import { readFileSync, writeFileSync } from "fs"
import { resolve, dirname, basename } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

function toCamelCase(str) {
  return str
    .replace(/[-_]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (c) => c.toLowerCase())
}

function toPascalCase(str) {
  const camel = toCamelCase(str)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

function convertSpriteJson(jsonPath) {
  const json = JSON.parse(readFileSync(jsonPath, "utf-8"))
  const fileName = basename(jsonPath, ".json")

  const constName = toCamelCase(fileName) + "Sprites"
  const sprites = {}

  for (const [name, data] of Object.entries(json.spritemap)) {
    const start = Math.round(data.start * 1000)
    const end = Math.round(data.end * 1000)
    const duration = end - start
    sprites[name] = { name, start, duration }
  }

  const output = `import type { SoundPackSprite } from "@/types/audio"

const ${constName}: Record<string, SoundPackSprite> = ${JSON.stringify(
    sprites,
    null,
    2
  )}

export { ${constName} }
`

  const outputPath = resolve(__dirname, "../src/services/sprites/", `${fileName}.ts`)
  writeFileSync(outputPath, output)
  console.log(`Generated: ${outputPath}`)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("Usage: node convert-soundsprite.js <json-file>")
  process.exit(1)
}

const rootDir = resolve(__dirname, "../..")

for (const arg of args) {
  const jsonPath = resolve(arg.startsWith("/") ? arg : resolve(rootDir, arg))
  convertSpriteJson(jsonPath)
}
