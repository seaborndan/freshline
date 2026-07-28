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
   * The shape, asserted where it matters: wide at the head, narrow at the tip. This is the whole
   * difference from the sphere that came before it — a pin points at something.
   */
  it('narrows from a round head to a point', () => {
    const widthAt = (y: number) => {
      let count = 0
      for (let x = 0; x < pinWidth; x += 1) {
        if (pixelAt(pin, x, y).a > 128) count += 1
      }
      return count
    }

    const head = widthAt(29)
    const waist = widthAt(60)
    const nearTip = widthAt(82)

    expect(head).toBeGreaterThan(40)
    expect(waist).toBeLessThan(head)
    expect(nearTip).toBeLessThan(waist)
    expect(nearTip).toBeGreaterThan(0)
  })

  /** The tip is on the sprite's vertical centre line, which is what `icon-anchor: bottom` aligns. */
  it('puts the point on the centre line', () => {
    const bottomRow = pinHeight - 4
    const covered: number[] = []

    for (let x = 0; x < pinWidth; x += 1) {
      if (pixelAt(pin, x, bottomRow).a > 0) covered.push(x)
    }

    const centreOfMass = covered.reduce((sum, x) => sum + x, 0) / covered.length

    expect(Math.abs(centreOfMass - middle)).toBeLessThan(1.5)
  })

  /** Corners are outside the silhouette — a pin must not sit on a visible tile of background. */
  it('leaves the area outside the pin transparent', () => {
    expect(pixelAt(pin, 0, 0).a).toBe(0)
    expect(pixelAt(pin, pinWidth - 1, 0).a).toBe(0)
    expect(pixelAt(pin, 0, pinHeight - 1).a).toBe(0)
  })

  /** The hole is what makes it read as a pin rather than a balloon. */
  it('punches a hole through the head', () => {
    const centre = pixelAt(pin, middle, 29)
    const head = pixelAt(pin, middle, 12)

    // The hole is far lighter than the coloured head around it.
    expect(centre.r + centre.g + centre.b).toBeGreaterThan(head.r + head.g + head.b)
    expect(centre.a).toBe(255)
  })

  /** Lit from the upper left, so the head has a near and a far side rather than one flat colour. */
  it('shades the head away from the light', () => {
    const towards = pixelAt(pin, middle - 13, 20)
    const away = pixelAt(pin, middle + 13, 38)

    const brightness = (p: { r: number; g: number; b: number }) => p.r + p.g + p.b

    expect(brightness(towards)).toBeGreaterThan(brightness(away))
  })

  /** Feathered rather than a hard staircase, which is the tail's most visible failure mode. */
  it('feathers the tapering edge', () => {
    const row = 70
    const partials: number[] = []

    for (let x = 0; x < pinWidth; x += 1) {
      const { a } = pixelAt(pin, x, row)
      if (a > 0 && a < 255) partials.push(a)
    }

    expect(partials.length).toBeGreaterThan(0)
  })

  it('takes its colour from the fill it was given', () => {
    const red = pinImage('#d03b3b', '#8f2020')

    expect(pixelAt(red, middle, 12).r).toBeGreaterThan(pixelAt(pin, middle, 12).r)
  })

  it('is deterministic', () => {
    expect(pinImage('#2a78d6', '#1b4f8f').data).toEqual(pin.data)
  })
})
