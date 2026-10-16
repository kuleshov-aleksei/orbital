import { describe, expect, it } from "vitest"
import sodium from "libsodium-wrappers"
import {
  buildQRLoginPayload,
  formatQRDeviceName,
  generateLoginKeypair,
  openSealedAuthResponse,
  parseQRLoginPayload,
  renderDotsQR,
} from "./qr"

const TEST_PUB = "nkotje9/qlP7QjgvmpuYgD5S8J29abASkKOruu5SYDE="
const TEST_PRIV = "1b8UAdMCq5f/YXqW3A/Mtnj67HtUh+Eomugn4rp97AA="

// Sealed with Go's nacl/box.SealAnonymous (backend QRLoginService). Pins the
// Go -> libsodium wire-format compatibility the login flow depends on.
const GO_SEALED_FIXTURE =
  "cY74G7hpFNEs0xDWvS2UtvD8tGWds1JLOH9YRt8V5nZqKQf6RGdUXrRgbAPVvOqSsg/orVEsqHJ2OgiKGEP0squVQdXEZj94XauVgltwgB5+"

describe("qr login payload", () => {
  it("round-trips through build and parse", () => {
    const text = buildQRLoginPayload("challenge-123", TEST_PUB)
    const parsed = parseQRLoginPayload(text)
    expect(parsed).toEqual({ version: 1, challengeId: "challenge-123", publicKey: TEST_PUB })
  })

  it("rejects non-Orbital codes", () => {
    expect(() => parseQRLoginPayload("hello")).toThrow()
    expect(() => parseQRLoginPayload('{"v":2,"c":"x","k":"y"}')).toThrow()
    expect(() => parseQRLoginPayload('{"v":1,"c":"","k":"y"}')).toThrow()
    expect(() => parseQRLoginPayload('{"v":1,"c":"x","k":"not-a-key"}')).toThrow()
    expect(() => parseQRLoginPayload("x".repeat(2048))).toThrow()
  })
})

describe("dots renderer", () => {
  it("renders a dots-profile svg with finder eyes", () => {
    const svg = renderDotsQR(buildQRLoginPayload("challenge-123", TEST_PUB))
    expect(svg.startsWith("<svg")).toBe(true)
    expect(svg.endsWith("</svg>")).toBe(true)
    // Intrinsic pixel size so the inline SVG cannot collapse in a shrink-to-fit
    // parent (the "blank white box" bug).
    expect(svg).toMatch(/width="\d+"/)
    expect(svg).toMatch(/height="\d+"/)
    // data modules as dots
    expect(svg).toContain("<circle")
    // three finder eyes x three rects each
    const rects = svg.match(/<rect /g) ?? []
    expect(rects.length).toBe(1 + 3 * 3)
  })
})

describe("sealed pairing payload", () => {
  it("opens a Go-sealed box (interop fixture)", async () => {
    await sodium.ready
    const pub = sodium.from_base64(TEST_PUB, sodium.base64_variants.ORIGINAL)
    const priv = sodium.from_base64(TEST_PRIV, sodium.base64_variants.ORIGINAL)
    const sealed = sodium.from_base64(GO_SEALED_FIXTURE, sodium.base64_variants.ORIGINAL)
    const opened = sodium.crypto_box_seal_open(sealed, pub, priv)
    expect(JSON.parse(sodium.to_string(opened))).toEqual({
      token: "go-sealed-probe-token",
    })
  })

  it("round-trips a sealed auth response", async () => {
    const kp = await generateLoginKeypair()
    expect(kp.publicKeyB64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)

    await sodium.ready
    const user = {
      id: "u1",
      nickname: "Probe",
      status: "online",
      auth_provider: "password",
      is_guest: false,
      role: "user",
    }
    const payload = JSON.stringify({
      token: "tok",
      user,
      expires_at: "2026-10-16T16:00:00Z",
    })
    const pub = sodium.from_base64(kp.publicKeyB64, sodium.base64_variants.ORIGINAL)
    const sealed = sodium.crypto_box_seal(sodium.from_string(payload), pub)

    const opened = await openSealedAuthResponse(
      sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
      kp.publicKeyB64,
      kp.privateKey,
    )
    expect(opened.token).toBe("tok")
    expect(opened.user.nickname).toBe("Probe")
  })

  it("rejects payloads opened with the wrong key", async () => {
    const kp = await generateLoginKeypair()
    const other = await generateLoginKeypair()
    await sodium.ready
    const pub = sodium.from_base64(kp.publicKeyB64, sodium.base64_variants.ORIGINAL)
    const sealed = sodium.crypto_box_seal(sodium.from_string("nope"), pub)
    await expect(
      openSealedAuthResponse(
        sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
        kp.publicKeyB64,
        other.privateKey,
      ),
    ).rejects.toThrow()
  })
})

describe("device naming", () => {
  it("formats desktop and mobile names", () => {
    expect(
      formatQRDeviceName({
        browserName: "Chrome",
        browserVersion: "130",
        platform: "Windows",
        isElectron: false,
        isMobile: false,
      }),
    ).toBe("Chrome 130 · Windows")
    expect(
      formatQRDeviceName({
        browserName: "Safari",
        browserVersion: "",
        platform: "iPhone",
        isElectron: false,
        isMobile: true,
      }),
    ).toBe("Mobile · Safari")
  })
})
