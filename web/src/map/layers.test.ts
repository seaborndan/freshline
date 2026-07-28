import { describe, expect, it } from 'vitest'
import { hoverIconSize, iconImage, iconSize, ordinaryFilter, priorityFilter } from './layers'

/** Every atom in a nested expression, flattened. */
function atoms(expression: unknown): unknown[] {
  return Array.isArray(expression) ? expression.flatMap(atoms) : [expression]
}

describe('the layout expressions', () => {
  /**
   * The constraint that took the map down, encoded so it cannot come back.
   *
   * `icon-size` and `icon-image` are **layout** properties, and MapLibre refuses `feature-state`
   * there outright:
   *
   * > *"feature-state data expressions are not supported with layout properties"*
   *
   * Layout is resolved when a tile is prepared rather than per frame, so it cannot depend on state
   * that changes between frames. The whole layer fails to be added and the map draws nothing, which
   * is a failure no assertion about React output can see — it was found by loading the page, and the
   * mock in `MapView.test.tsx` happily accepts an invalid style.
   *
   * The hover effect is a separate layer over its own source for exactly this reason.
   */
  it('never reach for feature-state, which layout properties cannot carry', () => {
    for (const expression of [iconSize, hoverIconSize, iconImage]) {
      expect(atoms(expression)).not.toContain('feature-state')
    }
  })

  /**
   * The sibling constraint, which cost this project a blank map once already: `['zoom']` is only
   * legal at the top level of a step or interpolate.
   */
  it('use zoom only at the top of an interpolate', () => {
    for (const expression of [iconSize, hoverIconSize]) {
      expect(expression[0]).toBe('interpolate')

      // Once at the top, and nowhere else.
      expect(atoms(expression).filter((atom) => atom === 'zoom')).toHaveLength(1)
    }
  })

  it('grows a hovered point rather than shrinking it', () => {
    // The hover size is the ordinary one times a factor above 1. Asserted on the factor itself
    // rather than on anything derived from it, so a change to the multiplier is what fails.
    const factors = atoms(hoverIconSize).filter(
      (atom): atom is number => typeof atom === 'number' && !atoms(iconSize).includes(atom),
    )

    expect(factors.length).toBeGreaterThan(0)
    expect(Math.max(...factors)).toBeGreaterThan(1)
  })

  /** Complementary, so every point is drawn exactly once across the two layers. */
  it('split the pins into two layers with no overlap and no gap', () => {
    expect(ordinaryFilter).toEqual(['!', priorityFilter])
  })
})
