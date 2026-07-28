import { describe, expect, it } from 'vitest'
import { sphereImage, spriteSize } from './sphereSprite'

/** The RGBA of one pixel. */
function pixelAt(image: ReturnType<typeof sphereImage>, x: number, y: number) {
  const offset = (y * image.width + x) * 4

  return {
    r: image.data[offset],
    g: image.data[offset + 1],
    b: image.data[offset + 2],
    a: image.data[offset + 3],
  }
}

const centre = spriteSize / 2

describe('sphereImage', () => {
  const sphere = sphereImage('#2a78d6', '#1b4f8f')

  it('produces an image of the size addImage expects', () => {
    expect(sphere.width).toBe(spriteSize)
    expect(sphere.height).toBe(spriteSize)
    expect(sphere.data).toHaveLength(spriteSize * spriteSize * 4)
  })

  /**
   * The corners are outside the sphere and must be fully transparent — a sprite that filled its
   * square would draw every pin on a visible tile of background.
   */
  it('leaves the area outside the sphere transparent', () => {
    expect(pixelAt(sphere, 0, 0).a).toBe(0)
    expect(pixelAt(sphere, spriteSize - 1, spriteSize - 1).a).toBe(0)
  })

  it('is opaque at the centre', () => {
    expect(pixelAt(sphere, centre, centre).a).toBe(255)
  })

  /**
   * The property that makes it read as a sphere rather than as a disc: it is lit from above and to
   * the left, so the upper-left of the surface is brighter than the lower-right. A flat circle has
   * the same colour in both places, which is exactly what this replaced.
   */
  it('is brighter towards the light than away from it', () => {
    const towards = pixelAt(sphere, centre - 12, centre - 12)
    const away = pixelAt(sphere, centre + 12, centre + 12)

    const brightness = (p: { r: number; g: number; b: number }) => p.r + p.g + p.b

    expect(brightness(towards)).toBeGreaterThan(brightness(away))
  })

  /** The shading has to vary across the surface. Two identical samples would mean a flat disc. */
  it('varies across the surface rather than filling one colour', () => {
    const samples = new Set(
      [
        [centre - 10, centre - 10],
        [centre, centre],
        [centre + 10, centre + 10],
        [centre + 4, centre - 14],
      ].map(([x, y]) => {
        const p = pixelAt(sphere, x, y)
        return `${p.r},${p.g},${p.b}`
      }),
    )

    expect(samples.size).toBe(4)
  })

  /**
   * The edge is feathered rather than a hard staircase, which is the most obvious way a computed
   * sprite announces itself as computed. The pixel just inside the silhouette is partly transparent.
   */
  it('feathers the silhouette', () => {
    // The topmost pixel on the vertical centre line sits just inside the circle — partly covered by
    // it, which is exactly what a feathered edge means. Fully outside and fully inside are asserted
    // above and below it.
    const onTheEdge = pixelAt(sphere, centre, 0)

    expect(onTheEdge.a).toBeGreaterThan(0)
    expect(onTheEdge.a).toBeLessThan(255)

    // Two pixels in, the surface is solid.
    expect(pixelAt(sphere, centre, 2).a).toBe(255)
  })

  /** Each state gets its own sphere, so the colour has to reach the pixels. */
  it('takes its colour from the fill it was given', () => {
    const red = sphereImage('#d03b3b', '#8f2020')
    const blue = sphereImage('#2a78d6', '#1b4f8f')

    expect(pixelAt(red, centre, centre).r).toBeGreaterThan(pixelAt(blue, centre, centre).r)
    expect(pixelAt(blue, centre, centre).b).toBeGreaterThan(pixelAt(red, centre, centre).b)
  })

  /**
   * The silhouette darkens towards the stroke colour, which is what keeps a pale pin legible against
   * a pale basemap — the never-inspected pin is white on near-white.
   */
  it('darkens towards the rim colour at the edge', () => {
    const white = sphereImage('#ffffff', '#898781')

    const middle = pixelAt(white, centre, centre)
    const nearEdge = pixelAt(white, centre + 29, centre)

    expect(nearEdge.r).toBeLessThan(middle.r)
  })

  /** Deterministic: the same input must produce the same bytes, or a re-register would flicker. */
  it('is deterministic', () => {
    expect(sphereImage('#2a78d6', '#1b4f8f').data).toEqual(sphere.data)
  })
})
