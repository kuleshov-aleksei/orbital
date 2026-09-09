import { rmSync } from "node:fs";
import { join } from "node:path";

// Removes stale Linux venmic binaries from dist/ so they can never
// leak into the Windows installer (e.g. when build:win and
// build:linux share the same workdir, as in Dockerfile.electron).
// Runs on every platform — no process.platform guard by design.
async function cleanVenmic() {
    for (const file of ["venmic-x64.node", "venmic-arm64.node"]) {
        try {
            rmSync(join("./dist", file), { force: true });
        } catch (e) {
            console.warn(`Failed to remove dist/${file}:`, e);
        }
    }
}

await cleanVenmic();
