import { describe, expect, it } from "vitest"
import { formatBytes } from "./formatBytes"

describe("formatBytes", () => {
  it("formats binary units", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(1024 * 1024)).toBe("1 MB")
    expect(formatBytes(340 * 1024 * 1024)).toBe("340 MB")
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB")
  })
})
