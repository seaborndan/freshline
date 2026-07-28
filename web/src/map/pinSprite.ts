/**
 * The map markers, computed as pixels.
 *
 * ## What this is, and what it deliberately is not
 *
 * A **glossy orb floating above the map, on a fine needle that comes to a point at the
 * establishment.** Not a map pin: no fat teardrop, no hole punched through the middle, nothing that
 * looks like the marker every mapping product has shipped since 2005.
 *
 * That distinction is the requirement rather than a preference. Four attempts came before this:
 *
 * 1. A flat circle with a blurred dark copy offset beneath — a sticker, not an object.
 * 2. A shaded sphere centred on the coordinate — lit correctly, and a ball lying in a street, with
 *    no relationship to the place it marked.
 * 3. A classic map pin — the right idea about pointing at something, and entirely generic.
 * 4. The same pin at six times the resolution — crisp, and still the same generic shape.
 *
 * The lesson across all four: the shading was never the problem. **Silhouette is what an eye reads
 * first**, and three of those four had the wrong one.
 *
 * ## The silhouette
 *
 * A circle, and a needle whose half-width falls away as `(1 − t)^1.7` — concave rather than
 * straight-sided, which is what separates an elegant taper from a triangle. The orb sits clear of
 * the needle's widest point, so it reads as suspended rather than balanced on top of a spike.
 *
 * Edges come from a signed distance field, smoothstepped over one pixel: exact, and crisp at any
 * size. Supersampling was the previous version's other source of softness and is gone.
 *
 * ## What makes it pop
 *
 * - **A white collar** around the whole silhouette. A coloured shape on a coloured map has no edge
 *   of its own, and this is the single largest contributor to looking crisp.
 * - **A vertical gradient** through the orb, bright at the top and deep at the bottom, which is what
 *   a glossy sphere does under a sky.
 * - **A hard specular highlight**, small and high and offset left — the wet spot that says polished.
 * - **A bounce light** along the lower-right rim, dimmer and warmer, as though the ground were
 *   throwing a little light back up. This is the detail that makes a rendered ball stop looking flat.
 * - **A needle darker than the orb**, because it is below it and turned away from the light.
 */

/**
 * Device pixels per logical pixel of the source image.
 *
 * Six, because a marker is drawn at up to 3.1× its base size — 2.3× for a crowded point, 1.35× while
 * hovered — on a display that may itself be 2×. Everything the map asks for is then a downsample,
 * which is the difference between crisp and soft.
 */
export const pinPixelRatio = 6

export const pinWidth = 216
export const pinHeight = 312

const orb = { x: 108, y: 82, radius: 76 }

/** Where the needle begins and ends. It starts inside the orb so there is no visible joint. */
const needleTop = 128
const needleTopHalfWidth = 30
const tipY = pinHeight - 4

/** The white collar, in source pixels — about 1.7 logical pixels at the base size. */
const collar = 10

/** Above, to the left, and towards the viewer. Normalised. */
const light = { x: -0.48, y: -0.66, z: 0.58 }

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

/**
 * Coverage from a signed distance, over one pixel.
 *
 * `smoothstep` rather than a linear ramp, so there is no visible corner where the edge reaches full
 * opacity — the difference between antialiased and cleanly antialiased.
 */
function coverage(distance: number): number {
  const t = clamp01(0.5 - distance)

  return t * t * (3 - 2 * t)
}

function distanceToOrb(x: number, y: number): number {
  return Math.hypot(x - orb.x, y - orb.y) - orb.radius
}

/**
 * Distance to the needle.
 *
 * Its half-width falls as `(1 − t)^1.7`, which gives a concave taper — sides that curve inwards
 * rather than running straight to the tip. A straight-sided triangle is what makes a marker look
 * like clip art.
 */
function distanceToNeedle(x: number, y: number): number {
  // Clamped into the needle's own span, so a point above or below it measures to the nearest end
  // rather than to an imaginary continuation. Returning the vertical gap alone — which an earlier
  // version did — made every pixel in the strip below the tip count as inside, and the sprite drew
  // an opaque band across the bottom of its own bounding box. Caught by a test asserting the corners
  // are transparent.
  const clampedY = Math.max(needleTop, Math.min(tipY, y))

  const t = (clampedY - needleTop) / (tipY - needleTop)
  const halfWidth = needleTopHalfWidth * Math.pow(1 - t, 1.7)

  const lateral = Math.abs(x - orb.x) - halfWidth
  const vertical = Math.abs(y - clampedY)

  // Inside the span: the lateral distance is the answer, and it may be negative. Outside it: the two
  // combine, and a point directly beyond the tip is `vertical` away.
  return vertical === 0 ? lateral : Math.hypot(Math.max(lateral, 0), vertical)
}

function distanceToMarker(x: number, y: number): number {
  return Math.min(distanceToOrb(x, y), distanceToNeedle(x, y))
}

/**
 * One marker.
 *
 * @param fill the orb's colour, from `pinStyle.ts`
 * @param rim the colour the shaded side moves towards — the state's own stroke, or the closure
 *   colour, so a closed establishment stays distinguishable
 */
export function pinImage(fill: string, rim: string): PinImage {
  const base = parseHex(fill)
  const edge = parseHex(rim)
  const data = new Uint8Array(pinWidth * pinHeight * 4)

  for (let py = 0; py < pinHeight; py += 1) {
    for (let px = 0; px < pinWidth; px += 1) {
      const x = px + 0.5
      const y = py + 0.5

      const distance = distanceToMarker(x, y)
      const outer = coverage(distance - collar)

      if (outer <= 0) {
        continue
      }

      const offset = (py * pinWidth + px) * 4
      const body = coverage(distance)

      // The collar. White rather than a dark outline: the basemap is pale, and a dark outline merges
      // with every road underneath it.
      let r = 255
      let g = 255
      let b = 253

      if (body > 0) {
        // The orb's surface normal, recovered from the distance to its centre. Used across the whole
        // marker so shading stays continuous into the needle instead of stopping at a seam.
        const nx = (x - orb.x) / orb.radius
        const ny = (y - orb.y) / orb.radius
        const nz = Math.sqrt(Math.max(0.04, 1 - nx * nx - ny * ny))

        const lambert = clamp01(nx * light.x + ny * light.y + nz * light.z)

        // Ambient held well above zero: a dark side that reaches black reads as a hole in the map.
        let shade = 0.58 + 0.62 * lambert

        // A vertical gradient through the orb on top of the lighting — bright at the crown, deeper
        // at the base. This is most of what a glossy sphere looks like under an open sky.
        const height = clamp01((y - (orb.y - orb.radius)) / (orb.radius * 2))
        shade *= 1.12 - 0.3 * height

        // The needle is beneath the orb and turned away from the light, so it is darker throughout.
        // Ramped rather than stepped, so the transition is not a visible band.
        const onNeedle = clamp01((y - (orb.y + orb.radius * 0.35)) / (orb.radius * 0.9))
        shade *= 1 - 0.34 * onNeedle

        // Bounce light along the lower-right rim, as though the ground were throwing a little back
        // up. Small, and the detail that stops a rendered ball looking flat.
        const bounce =
          Math.pow(clamp01(-(nx * light.x + ny * light.y)), 3) *
          clamp01(1 - Math.abs(distanceToOrb(x, y) + 9) / 10) *
          0.42

        // Tight, bright, and high on the left. The wet spot that says hard and polished.
        const specular = Math.pow(lambert, 34) * 1.05

        let litR = base.r * shade
        let litG = base.g * shade
        let litB = base.b * shade

        litR += (edge.r - litR) * bounce
        litG += (edge.g - litG) * bounce
        litB += (edge.b - litB) * bounce

        litR += specular * 255
        litG += specular * 255
        litB += specular * 255

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
