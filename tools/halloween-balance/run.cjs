// Bootstrap: loads the TS harness through jiti (a frontend devDependency).
// Resolves jiti from the frontend's node_modules so this tool needs no
// installs of its own.
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
  .import("./run.ts")
  .then((m) => m.main())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
