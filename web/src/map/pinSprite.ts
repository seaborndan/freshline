/**
 * Map pins, computed as pixels.
 *
 * ## What this replaced, and why
 *
 * Two attempts came before it. A flat circle with a blurred dark copy offset underneath, which read
 * as a sticker rather than an object. Then a shaded sphere, which was lit correctly and still looked
 * like a ball sitting on a street — the shading was fine and the *shape* was wrong, because a
 * sphere has no relationship to the place it marks.
 *
 * A pin does. The head carries the colour and sits above the map; the tail narrows to a point, and
 * that point is the establishment. Anchored at the tip, so the thing being marked is marked exactly
 * rather than approximately — which a circle centred on the coordinate never quite manages, because
 * half of it covers what it is pointing at.
 *
 * ## The silhouette
 *
 * A circle, and the triangle formed by the tip and the two points where the circle's tangents from
 * the tip touch it. That union is the classic teardrop, and it is exact rather than approximated by
 * a curve: with the head centred at the origin and the tip at `(0, d)`, a tangent point `P` satisfies
 * `|P| = r` and `(P − T) · P = 0`, which gives `P = (±(r/d)√(d² − r²), r²/d)`.
 *
 * ## Why pixels rather than a canvas or an SVG
 *
 * `addImage` takes `{ width, height, data }` as RGBA bytes, so the sprite can be computed directly.
 * jsdom has no 2D canvas context, so anything drawn with `getContext('2d')` could only ever be
 * verified by looking at it. This is a pure function from two colours to bytes, and its shape and
 * shading are asserted.
 */

/** Sprite dimensions before `icon-size` scales them. Taller than wide, because a pin is. */
export const pinWidth = 64
export const pinHeight = 88

const headCentre = { x: pinWidth / 2, y: 29 }
const headRadius = 26

/** One pixel short of the bottom edge, so the tip is not clipped by the sprite's own boundary. */
const tip = { x: pinWidth / 2, y: pinHeight - 3 }

/** Distance from head centre to tip, and the tangent points derived from it. */
const tipDistance = tip.y - headCentre.y
const tangentY = headCentre.y + (headRadius * headRadius) / tipDistance
const tangentHalfWidth =
  (headRadius / tipDistance) * Math.sqrt(tipDistance * tipDistance - headRadius * headRadius)

/** The hole in the middle, which is what makes the shape read as a pin rather than a balloon. */
const holeRadius = 10.5

/** Above and to the left, the direction light comes from in nearly every rendered object. */
const light = { x: -0.45, y: -0.6 }

export interface PinImage {
  width: number
  height: number

  /** RGBA, row-major — the shape `map.addImage` takes. */
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

/** Whether a point is inside the triangle joining the tip to the two tangent points. */
function inTail(x: number, y: number): boolean {
  if (y < tangentY || y > tip.y) {
    return false
  }

  // The tail narrows linearly from the tangent width down to nothing at the tip.
  const progress = (y - tangentY) / (tip.y - tangentY)
  const halfWidth = tangentHalfWidth * (1 - progress)

  return Math.abs(x - tip.x) <= halfWidth
}

function inHead(x: number, y: number): boolean {
  const dx = x - headCentre.x
  const dy = y - headCentre.y

  return dx * dx + dy * dy <= headRadius * headRadius
}

/**
 * A pin in one colour.
 *
 * @param fill the head's colour, from `pinStyle.ts`
 * @param rim the colour the outline and the shaded side move towards — the state's own stroke, or
 *   the closure colour, so a closed establishment stays distinguishable
 */
export function pinImage(fill: string, rim: string): PinImage {
  const base = parseHex(fill)
  const edge = parseHex(rim)
  const data = new Uint8Array(pinWidth * pinHeight * 4)

  // Three samples per axis. Coverage is computed rather than approximated, because the silhouette is
  // mostly diagonal and a hard edge on a tapering tail is the most obvious way a sprite looks cheap.
  const samples = 3

  for (let py = 0; py < pinHeight; py += 1) {
    for (let px = 0; px < pinWidth; px += 1) {
      let covered = 0
      let hole = 0

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = px + (sx + 0.5) / samples
          const y = py + (sy + 0.5) / samples

          if (inHead(x, y) || inTail(x, y)) {
            covered += 1

            const dx = x - headCentre.x
            const dy = y - headCentre.y

            if (dx * dx + dy * dy <= holeRadius * holeRadius) {
              hole += 1
            }
          }
        }
      }

      if (covered === 0) {
        continue
      }

      const total = samples * samples
      const alpha = covered / total
      const holeAmount = hole / total
      const offset = (py * pinWidth + px) * 4

      // Direction from the head's centre, normalised over the head's radius. Used for shading on the
      // head and, below it, for a gentle darkening down the tail.
      const nx = (px + 0.5 - headCentre.x) / headRadius
      const ny = (py + 0.5 - headCentre.y) / headRadius

      // Lit towards the light, shaded away from it. Kept well above zero so the dark side stays a
      // darker version of the colour rather than becoming a hole.
      const facing = Math.max(-1, Math.min(1, nx * light.x + ny * light.y))
      const shade = 0.78 + 0.32 * facing

      // The outline. Strongest at the silhouette, which is where a pin needs it most: the
      // never-inspected pin is near-white and would otherwise dissolve into a pale basemap.
      const outline = 1 - alpha

      let r = base.r * shade
      let g = base.g * shade
      let b = base.b * shade

      r += (edge.r - r) * outline
      g += (edge.g - g) * outline
      b += (edge.b - b) * outline

      // The hole, filled with the page's own background rather than pure white, so a pin looks like
      // a pin punched out of the map rather than a badge with a light in it.
      if (holeAmount > 0) {
        r += (249 - r) * holeAmount
        g += (249 - g) * holeAmount
        b += (247 - b) * holeAmount
      }

      data[offset] = clampByte(r)
      data[offset + 1] = clampByte(g)
      data[offset + 2] = clampByte(b)
      data[offset + 3] = clampByte(alpha * 255)
    }
  }

  return { width: pinWidth, height: pinHeight, data }
}
