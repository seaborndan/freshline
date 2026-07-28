import { describe, expect, it } from 'vitest'
import { inspectionOutcomes } from '../api/contract'
import { iconImage, pinImageName } from './layers'
import { closedModifier, pinStates, pinStyles } from './pinStyle'

describe('the pin table', () => {
  // The legend is complete or it is not a legend. If an outcome is ever added to the API, this is
  // the test that says the map has nothing to draw it with — rather than a magenta dot appearing on
  // a stranger's screen.
  it('covers every outcome the API can send, plus never-inspected', () => {
    for (const outcome of inspectionOutcomes) {
      expect(pinStates).toContain(outcome)
    }

    expect(pinStates).toContain('NeverInspected')
    expect(pinStates).toHaveLength(inspectionOutcomes.length + 1)
  })

  it('gives every state a label and an explanation, not just a label', () => {
    for (const state of pinStates) {
      expect(pinStyles[state].label.length).toBeGreaterThan(0)
      expect(pinStyles[state].description.length).toBeGreaterThan(0)
    }
  })

  // Ungraded and never-inspected are 42% of the map between them and are the pair most likely to be
  // collapsed into "no data". They differ by fill and by outline, so shape carries it as well as
  // colour.
  it('distinguishes ungraded from never-inspected by more than a word', () => {
    expect(pinStyles.Ungraded.fill).not.toBe(pinStyles.NeverInspected.fill)
    expect(pinStyles.Ungraded.stroke).not.toBe(pinStyles.NeverInspected.stroke)
  })

  it('gives every state its own colour', () => {
    const fills = pinStates.map((state) => pinStyles[state].fill)

    expect(new Set(fills).size).toBe(fills.length)
  })

  // Severity is on a second channel, so the scale does not depend on colour vision alone — and so
  // that Poor, at 0.4% of the data, is not the smallest thing on screen.
  it('sizes the worse outcomes larger', () => {
    expect(pinStyles.Poor.radius).toBeGreaterThan(pinStyles.Fair.radius)
    expect(pinStyles.Fair.radius).toBeGreaterThan(pinStyles.Good.radius)
  })

  // Closure is orthogonal to the scale: an establishment can be closed at any grade. If it were a
  // colour it would overwrite the grade the establishment actually has.
  it('keeps closure off the colour scale', () => {
    const fills = pinStates.map((state) => pinStyles[state].fill)

    expect(fills).not.toContain(closedModifier.stroke)
    expect(pinStates).not.toContain('Closed')
  })
})

describe('the generated paint expression', () => {
  /**
   * The legend and the layer are generated from one table so they cannot disagree.
   *
   * The pins are sprites now rather than coloured circles, so the expression names an image per
   * state instead of a hex. The colour itself is asserted where it is now decided — the sprite is
   * built from `pinStyles[state].fill`, and `sphereSprite.test.ts` proves the fill reaches the
   * pixels. What can still drift is the *naming*, which is what this covers.
   */
  it('names an image for every state the legend shows', () => {
    // The trailing match is the not-closed branch, which is the one the legend describes.
    const openBranch = iconImage[iconImage.length - 1] as unknown[]

    for (const state of pinStates) {
      const index = openBranch.indexOf(state)

      expect(index).toBeGreaterThan(-1)
      expect(openBranch[index + 1]).toBe(pinImageName(state, false))
    }
  })

  it('falls back to something obviously wrong rather than a plausible image', () => {
    const openBranch = iconImage[iconImage.length - 1] as unknown[]
    const fallback = openBranch[openBranch.length - 1]

    expect(pinStates.map((state) => pinImageName(state, false))).not.toContain(fallback)
  })
})
