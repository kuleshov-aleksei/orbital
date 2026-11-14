import { describe, expect, it } from "vitest"
import { compareVersions, parseVersion } from "./appVersion"

describe("app versions", () => {
  it("parses release versions with optional prefix and build suffix", () => {
    expect(parseVersion("1.5.2")).toEqual([1, 5, 2])
    expect(parseVersion("v1.5.2")).toEqual([1, 5, 2])
    expect(parseVersion("1.5.2-816skays")).toEqual([1, 5, 2])
    expect(parseVersion("dev-unknown")).toBeNull()
    expect(parseVersion("1.5")).toBeNull()
    expect(parseVersion("")).toBeNull()
  })

  it("compares numerically and refuses non-versions", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1)
    expect(compareVersions("1.4.9", "1.5.0")).toBe(-1)
    expect(compareVersions("1.5.0-abc", "1.5.0")).toBe(0)
    // Dev builds are never "older" (never blocked, never prompted).
    expect(compareVersions("dev", "1.5.0")).toBeNull()
  })
})
