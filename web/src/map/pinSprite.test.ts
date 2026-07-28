import { describe, expect, it } from 'vitest'
import { pinHeight, pinImage, pinWidth } from './pinSprite'

function pixelAt(image: ReturnType<typeof pinImage>, x: number, y: number) {
  const offset = (y * image.width + x) * 4

  return {
    r: image.data[offset],
    g: image.data[offset + 1],
    b: image.data[offset + 2],
    a: image.data[offset + 3],
  }
}

const pin = pinImage('#2a78d6', '#1b4f8f')
const middle = Math.floor(pinWidth / 2)

describe('pinImage', () => {
  it('produces an image of the size addImage expects', () => {
    expect(pin.width).toBe(pinWidth)
    expect(pin.height).toBe(pinHeight)
    expect(pin.data).toHaveLength(pinWidth * pinHeight * 4)
  })

  /**
   * The silhouette, asserted where it matters: a wide orb, a narrow needle, a point. This is the
   * whole difference from every earlier attempt — a sphere that marked nothing, and a map pin whose
   * fat teardrop was indistinguishable from every other mapping product's.
   */
  it('narrows from a floating orb to a point', () => {
    const widthAt = (y: number) => {
      let count = 0
      for (let x = 0; x < pinWidth; x += 1) {
        if (pixelAt(pin, x, y).a > 128) count += 1
      }
      return count
    }

    const head = widthAt(82)
    const waist = widthAt(210)
    const nearTip = widthAt(295)

    expect(head).toBeGreaterThan(140)
    expect(waist).toBeLessThan(head)
    expect(nearTip).toBeLessThan(waist)
    expect(nearTip).toBeGreaterThan(0)
  })

  /** The tip is on the sprite's vertical centre line, which is what `icon-anchor: bottom` aligns. */
  it('puts the point on the centre line', () => {
    const bottomRow = pinHeight - 12
    const covered: number[] = []

    for (let x = 0; x < pinWidth; x += 1) {
      if (pixelAt(pin, x, bottomRow).a > 0) covered.push(x)
    }

    const centreOfMass = covered.reduce((sum, x) => sum + x, 0) / covered.length

    expect(Math.abs(centreOfMass - middle)).toBeLessThan(2)
  })

  /** Corners are outside the silhouette — a pin must not sit on a visible tile of background. */
  it('leaves the area outside the pin transparent', () => {
    expect(pixelAt(pin, 0, 0).a).toBe(0)
    expect(pixelAt(pin, pinWidth - 1, 0).a).toBe(0)
    expect(pixelAt(pin, 0, pinHeight - 1).a).toBe(0)
  })

  /**
   * The needle is visibly finer than the orb — that ratio is what makes the orb read as floating
   * rather than as the top of a cone.
   */
  it('keeps the needle far finer than the orb', () => {
    const widthAt = (y: number) => {
      let count = 0
      for (let x = 0; x < pinWidth; x += 1) {
        if (pixelAt(pin, x, y).a > 128) count += 1
      }
      return count
    }

    expect(widthAt(230)).toBeLessThan(widthAt(82) / 3)
  })

  /** Bright at the crown, deeper at the base — what a glossy sphere does under an open sky. */
  it('grades the orb from a bright crown to a deeper base', () => {
    const brightness = (p: { r: number; g: number; b: number }) => p.r + p.g + p.b

    expect(brightness(pixelAt(pin, middle, 30))).toBeGreaterThan(
      brightness(pixelAt(pin, middle, 140)),
    )
  })

  /** Lit from the upper left, so the head has a near and a far side rather than one flat colour. */
  it('shades the orb away from the light', () => {
    const towards = pixelAt(pin, middle - 40, 50)
    const away = pixelAt(pin, middle + 40, 120)

    const brightness = (p: { r: number; g: number; b: number }) => p.r + p.g + p.b

    expect(brightness(towards)).toBeGreaterThan(brightness(away))
  })

  /** Feathered rather than a hard staircase, which is the tail's most visible failure mode. */
  it('feathers the tapering edge', () => {
    const row = 240
    const partials: number[] = []

    for (let x = 0; x < pinWidth; x += 1) {
      const { a } = pixelAt(pin, x, row)
      if (a > 0 && a < 255) partials.push(a)
    }

    expect(partials.length).toBeGreaterThan(0)
  })

  it('takes its colour from the fill it was given', () => {
    const red = pinImage('#d03b3b', '#8f2020')

    expect(pixelAt(red, middle, 60).r).toBeGreaterThan(pixelAt(pin, middle, 60).r)
  })

  it('is deterministic', () => {
    expect(pinImage('#2a78d6', '#1b4f8f').data).toEqual(pin.data)
  })
})
