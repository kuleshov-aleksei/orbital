// Bootstrap: loads the TS sweeper through jiti (a frontend devDependency).
const path = require("path")

function loadJiti() {
  try {
    return require("jiti")
  } catch {
    return require(path.join(__dirname, "..", "..", "frontend", "node_modules", "jiti"))
  }
}

const { createJiti } = loadJiti()
const jiti = createJiti(__filename)

jiti
  .import("./sweep.ts")
  .then((m) => m.main())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
