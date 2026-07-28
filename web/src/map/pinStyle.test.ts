import { describe, expect, it } from 'vitest'
import { inspectionOutcomes } from '../api/contract'
import { circleColour } from './layers'
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
  // The legend and the layer are generated from one table so they cannot disagree. This asserts the
  // generation, which is the only place they could.
  it('names every state with the colour the legend shows', () => {
    for (const state of pinStates) {
      const index = circleColour.indexOf(state)

      expect(index).toBeGreaterThan(-1)
      expect(circleColour[index + 1]).toBe(pinStyles[state].fill)
    }
  })

  it('falls back to a colour that is obviously wrong rather than a plausible one', () => {
    const fallback = circleColour[circleColour.length - 1]

    expect(pinStates.map((state) => pinStyles[state].fill)).not.toContain(fallback)
  })
})
