/**
 * Shaded spheres, computed as pixels.
 *
 * ## Why this exists
 *
 * A MapLibre circle layer draws a flat disc. There is no gradient, no lighting and no depth in it —
 * `circle-blur` softens an edge and `circle-translate` moves a whole layer, and neither makes a dot
 * look like an object. The first attempt at depth was a blurred dark copy offset underneath, which
 * reads as a drop shadow under a sticker rather than as something solid.
 *
 * A sphere needs shading that varies across the surface, so the surface has to be drawn. These are
 * registered with `map.addImage` and drawn by a symbol layer.
 *
 * ## Why pixels rather than a canvas or an SVG
 *
 * `addImage` accepts `{ width, height, data }` with `data` as RGBA bytes, so the image can be
 * computed directly. That matters for two reasons beyond taste:
 *
 * - **It is testable.** jsdom has no 2D canvas context, so anything built with `getContext('2d')`
 *   cannot be asserted in this project's test environment — it would be verified by looking at it and
 *   nothing else. This is a pure function from a colour to bytes.
 * - **It is deterministic.** No decode step, no async load, no dependency on how a browser rasterises
 *   an SVG gradient.
 *
 * ## The shading
 *
 * A sphere lit by one source above and to the left, which is where light comes from in nearly every
 * rendered object a person has seen, and therefore where it has to come from for the shape to read as
 * raised rather than merely mottled.
 *
 * For each pixel, the surface normal of a unit sphere is recovered from its distance to the centre —
 * `z = √(1 − x² − y²)`. Lambert shading (`normal · light`) gives the body of the form, a narrow
 * specular term gives the wet highlight that says "hard surface", and a rim term darkens the edge so
 * the silhouette does not dissolve into the basemap.
 */

/** The sprite's pixel size before `icon-size` scales it. */
export const spriteSize = 64

/**
 * Drawn at 2× and scaled down, so the sprite stays sharp on a high-density display. A 64px sphere
 * displayed at 32 CSS pixels on a 2× screen is exactly one device pixel per sample.
 */
const radius = spriteSize / 2

/** Above, to the left, and towards the viewer. Normalised. */
const light = { x: -0.42, y: -0.55, z: 0.72 }

export interface SphereImage {
  width: number
  height: number

  /** RGBA, row-major, one byte per channel — the shape `map.addImage` takes. */
  data: Uint8Array
}

function parseHex(colour: string): { r: number; g: number; b: number } {
  const hex = colour.replace('#', '')

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/**
 * A lit sphere in one colour.
 *
 * @param fill the colour of the material, as `#rrggbb`
 * @param rim the colour the silhouette darkens towards — the pin's own stroke, so a closed
 *   establishment's ring and a never-inspected pin's outline survive the change to spheres
 */
export function sphereImage(fill: string, rim: string): SphereImage {
  const base = parseHex(fill)
  const edge = parseHex(rim)
  const data = new Uint8Array(spriteSize * spriteSize * 4)

  for (let py = 0; py < spriteSize; py += 1) {
    for (let px = 0; px < spriteSize; px += 1) {
      // Pixel centres, mapped to [-1, 1] across the sprite.
      const x = (px + 0.5 - radius) / radius
      const y = (py + 0.5 - radius) / radius
      const distanceSquared = x * x + y * y
      const offset = (py * spriteSize + px) * 4

      if (distanceSquared >= 1) {
        // Outside the sphere. Left fully transparent rather than filled with a background colour,
        // so the basemap shows through and pins do not sit on visible square tiles.
        continue
      }

      const z = Math.sqrt(1 - distanceSquared)

      // Lambert: how directly this part of the surface faces the light. Floored above zero so the
      // unlit side keeps some of its own colour instead of going black — a fully dark terminator
      // reads as a hole rather than as a curve.
      const lambert = Math.max(0, x * light.x + y * light.y + z * light.z)
      const shade = 0.34 + 0.66 * lambert

      // A narrow specular lobe, the highlight that makes a surface look hard rather than powdery.
      const specular = Math.pow(lambert, 26) * 0.85

      // Darker towards the silhouette, blended to the pin's stroke colour. Without it a bright
      // sphere on a pale basemap loses its own outline and the shape stops being legible.
      const distance = Math.sqrt(distanceSquared)
      const rimAmount = Math.pow(distance, 5) * 0.9

      const litR = base.r * shade
      const litG = base.g * shade
      const litB = base.b * shade

      data[offset] = clampByte(litR + (edge.r - litR) * rimAmount + specular * 255)
      data[offset + 1] = clampByte(litG + (edge.g - litG) * rimAmount + specular * 255)
      data[offset + 2] = clampByte(litB + (edge.b - litB) * rimAmount + specular * 255)

      // One pixel of feathering at the silhouette. Without it the edge is a hard staircase, which is
      // the single most obvious way a computed sprite looks computed.
      data[offset + 3] = clampByte(255 * Math.min(1, (1 - distance) * radius))
    }
  }

  return { width: spriteSize, height: spriteSize, data }
}
