import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const packageJsonPath = path.join(__dirname, "..", "package.json")
const configPath = path.join(__dirname, "licenses-config.json")
const outputPath = path.join(__dirname, "..", "public", "licenses.json")

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, "utf-8"))
  : { custom: {}, unused: {} }

const dependencies = { ...packageJson.dependencies }

function getPackageInfo(name) {
  try {
    const result = execSync(`npm info ${name} --json`, { encoding: "utf-8", timeout: 10000 })
    const data = JSON.parse(result)

    let license = "Unknown"
    if (data.license) {
      license = typeof data.license === "string" ? data.license : data.license.type || "Unknown"
    }

    let repoUrl = ""
    if (data.repository) {
      const repo = typeof data.repository === "string" ? data.repository : data.repository.url || ""
      repoUrl = repo
        .replace(/^git\+/, "")
        .replace(/\.git$/, "")
        .replace("git://", "https://")
    }

    return {
      license,
      url: repoUrl,
      description: data.description || "",
    }
  } catch (e) {
    return null
  }
}

function generateLicenses() {
  const licenses = []

  for (const [name, version] of Object.entries(dependencies)) {
    const info = getPackageInfo(name)

    const customText = config.custom[name] || null

    licenses.push({
      name,
      version,
      license: info?.license || "Unknown",
      url: info?.url || "",
      description: info?.description || "",
      custom: customText,
    })
  }

  for (const [name, description] of Object.entries(config.unused || {})) {
    const info = getPackageInfo(name)
    licenses.push({
      name,
      version: null,
      license: info?.license || "Unknown",
      url: info?.url || "",
      description: info?.description || "",
      custom: description,
    })
  }

  const withCustom = licenses.filter((l) => l.custom !== null)
  const withoutCustom = licenses.filter((l) => l.custom === null)

  const sorted = [...withCustom, ...withoutCustom]

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(sorted, null, 2))

  console.log(`Generated ${sorted.length} licenses to ${outputPath}`)
}

generateLicenses()
