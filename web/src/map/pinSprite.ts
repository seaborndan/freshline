/**
 * Map pins, computed as pixels.
 *
 * ## Three attempts came before this one, and why they failed
 *
 * A flat circle with a blurred dark copy offset underneath — read as a sticker. A shaded sphere —
 * lit correctly and still a ball sitting on a street, because a sphere has no relationship to the
 * place it marks. Then a pin shape that was the right *shape* and visibly soft.
 *
 * The softness had two causes, and both are fixed here rather than argued with:
 *
 * - **The sprite was drawn smaller than it is displayed.** A pin grows with how many establishments
 *   share its point, and again while hovered — up to 3.1× together. A 64×88 source scaled to that is
 *   an upsample, and an upsample is blur. This is drawn at **six device pixels per logical pixel**,
 *   so every size the map asks for is a *down*sample.
 * - **Its edges were supersampled.** Averaging 3×3 samples across a boundary produces a soft ramp
 *   several pixels wide. Edges here come from a **signed distance field** instead: the exact distance
 *   to the silhouette, which yields a one-pixel transition that stays crisp at any scale.
 *
 * ## The silhouette, exactly
 *
 * A circle unioned with the triangle joining the tip to the two points where the circle's tangents
 * from the tip touch it. With the head at the origin and the tip at `(0, d)`, a tangent point `P`
 * satisfies `|P| = r` and `(P − T) · P = 0`, giving `P = (±(r/d)√(d² − r²), r²/d)`.
 *
 * The distance to that union is `min(distance to circle, distance to triangle)`, and the triangle is
 * convex so its distance is the largest of the distances to its three edges. No sampling anywhere.
 *
 * ## What makes it read as an object rather than a drawing
 *
 * Four things, in the order they matter:
 *
 * - **A white collar** around the whole silhouette, so the pin separates from any basemap underneath
 *   it. This is the single largest contributor to "crisp" — a coloured shape on a coloured map has no
 *   edge of its own.
 * - **Spherical shading on the head**, from a surface normal recovered from the distance to the
 *   centre, lit from above and to the left.
 * - **A specular highlight**, tight and offset into the upper left, which is what says "hard,
 *   polished" rather than "matte disc".
 * - **A dark inner shadow where the head meets the tail**, so the head sits *in front of* the tail
 *   rather than being glued to it.
 */

/**
 * Device pixels per logical pixel in the source image.
 *
 * Six, because a pin is drawn at up to 3.1× its base size (2.3× for a crowded point, 1.35× while
 * hovered) on a display that may itself be 2×. Six covers that with room, and everything below it is
 * a downsample.
 */
export const pinPixelRatio = 6

/** Logical size of the base pin. Everything else here is expressed in source pixels. */
export const pinWidth = 204
export const pinHeight = 276

const headCentre = { x: 102, y: 96 }
const headRadius = 84
const tip = { x: 102, y: 264 }

/** The white collar, in source pixels. About 1.7 logical pixels at the base size. */
const collar = 10

/** The hole through the head. */
const holeRadius = 34

/** Above and to the left, normalised. The direction light comes from in almost every rendered object. */
const light = { x: -0.5, y: -0.62, z: 0.6 }

const tipDistance = tip.y - headCentre.y
const tangentY = headCentre.y + (headRadius * headRadius) / tipDistance
const tangentHalfWidth =
  (headRadius / tipDistance) * Math.sqrt(tipDistance * tipDistance - headRadius * headRadius)

export interface PinImage {
  width: number
  height: number
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Signed distance to the head. Negative inside. */
function distanceToHead(x: number, y: number): number {
  return Math.hypot(x - headCentre.x, y - headCentre.y) - headRadius
}

/**
 * Signed distance to the tail triangle, as the largest distance to any of its three edges.
 *
 * Exact for a convex shape, which a triangle is. The three edges are the flat top joining the two
 * tangent points, and the two sides running down to the tip.
 */
function distanceToTail(x: number, y: number): number {
  const left = { x: tip.x - tangentHalfWidth, y: tangentY }
  const right = { x: tip.x + tangentHalfWidth, y: tangentY }

  // Top edge: outward is upwards, so being above the tangent line is outside.
  const top = tangentY - y

  // Each side, as the distance to its line with the outward normal pointing away from the centre.
  const side = (from: { x: number; y: number }, towards: number) => {
    const dx = tip.x - from.x
    const dy = tip.y - from.y
    const length = Math.hypot(dx, dy)

    // Normal perpendicular to the edge, pointing outwards on the given side.
    const nx = (towards * dy) / length
    const ny = (-towards * dx) / length

    return (x - from.x) * nx + (y - from.y) * ny
  }

  return Math.max(top, side(left, -1), side(right, 1))
}

/** Signed distance to the pin's outline — the union of head and tail. */
function distanceToPin(x: number, y: number): number {
  return Math.min(distanceToHead(x, y), distanceToTail(x, y))
}

/**
 * Coverage from a signed distance, with a one-pixel transition.
 *
 * `smoothstep` rather than a linear ramp, so the edge has no visible corner where it meets full
 * opacity — the difference between "antialiased" and "antialiased and clean".
 */
function coverage(distance: number): number {
  const t = clamp01(0.5 - distance)

  return t * t * (3 - 2 * t)
}

/**
 * A pin in one colour.
 *
 * @param fill the head's colour, from `pinStyle.ts`
 * @param rim the colour the shaded side and the outline move towards — the state's own stroke, or
 *   the closure colour, so a closed establishment stays distinguishable
 */
export function pinImage(fill: string, rim: string): PinImage {
  const base = parseHex(fill)
  const edge = parseHex(rim)
  const data = new Uint8Array(pinWidth * pinHeight * 4)

  for (let py = 0; py < pinHeight; py += 1) {
    for (let px = 0; px < pinWidth; px += 1) {
      const x = px + 0.5
      const y = py + 0.5

      const distance = distanceToPin(x, y)
      const outer = coverage(distance - collar)

      if (outer <= 0) {
        continue
      }

      const offset = (py * pinWidth + px) * 4
      const body = coverage(distance)

      // The collar. White rather than a darker outline, because the basemap is pale and a pin needs
      // to separate from it — a dark outline on a light map merges with every road underneath.
      let r = 255
      let g = 255
      let b = 253

      if (body > 0) {
        // A sphere's normal, recovered from the distance to the head's centre. Used across the whole
        // pin: on the tail it keeps shading continuous rather than stopping at a seam.
        const nx = (x - headCentre.x) / headRadius
        const ny = (y - headCentre.y) / headRadius
        const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny))

        const lambert = clamp01(nx * light.x + ny * light.y + nz * light.z)

        // Ambient well above zero: an unlit side that goes black reads as a hole in the map.
        const shade = 0.62 + 0.58 * lambert

        // Tight and bright. This is the highlight that makes a surface look polished.
        const specular = Math.pow(lambert, 32) * 0.9

        // Where the head overlaps the tail, darken — so the head reads as being in front of it
        // rather than fused to it. Strongest just below the head's widest point.
        const seam =
          clamp01((y - tangentY) / (headRadius * 0.9)) *
          clamp01((headRadius + 6 - Math.abs(x - headCentre.x)) / headRadius)
        const occlusion = 1 - 0.3 * seam

        let litR = base.r * shade * occlusion
        let litG = base.g * shade * occlusion
        let litB = base.b * shade * occlusion

        // A thin inner edge in the stroke colour, just inside the collar. Gives the colour a
        // boundary of its own so it does not float in the white.
        const innerEdge = clamp01(1 - Math.abs(distance + 6) / 7)
        litR += (edge.r - litR) * innerEdge * 0.75
        litG += (edge.g - litG) * innerEdge * 0.75
        litB += (edge.b - litB) * innerEdge * 0.75

        litR += specular * 255
        litG += specular * 255
        litB += specular * 255

        // The hole. Filled with the page's own background so it reads as punched through the pin,
        // with its own soft inner shadow at the top where the head would cast onto it.
        const holeDistance = Math.hypot(x - headCentre.x, y - headCentre.y) - holeRadius
        const hole = coverage(holeDistance)

        if (hole > 0) {
          const insetShadow = clamp01(1 - Math.abs(holeDistance + 5) / 6) * 0.35
          const holeR = 249 - 249 * insetShadow * 0.35
          const holeG = 249 - 249 * insetShadow * 0.35
          const holeB = 247 - 247 * insetShadow * 0.35

          litR += (holeR - litR) * hole
          litG += (holeG - litG) * hole
          litB += (holeB - litB) * hole
        }

        r += (litR - r) * body
        g += (litG - g) * body
        b += (litB - b) * body
      }

      data[offset] = clampByte(r)
      data[offset + 1] = clampByte(g)
      data[offset + 2] = clampByte(b)
      data[offset + 3] = clampByte(outer * 255)
    }
  }

  return { width: pinWidth, height: pinHeight, data }
}
