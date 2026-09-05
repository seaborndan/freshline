import { afterEach, describe, expect, it, vi } from 'vitest'
import { basemapRequest } from './basemapRequest'

afterEach(() => vi.unstubAllEnvs())

describe('CARTO request authentication', () => {
  it('authenticates raster and nested vector resources and preserves other parameters', () => {
    vi.stubEnv('VITE_CARTO_BASEMAP_API_KEY', ' test-key ')
    for (const url of [
      'https://basemaps.cartocdn.com/light_nolabels/14/4824/6157@2x.png',
      'https://a.basemaps.cartocdn.com/tiles/v3/14/4824/6157.mvt?existing=1',
    ]) {
      const result = new URL(basemapRequest(url).url)
      expect(result.searchParams.get('key')).toBe('test-key')
      if (url.includes('existing')) expect(result.searchParams.get('existing')).toBe('1')
    }
  })

  it('does not send the key to other hosts', () => {
    vi.stubEnv('VITE_CARTO_BASEMAP_API_KEY', 'test-key')
    for (const url of ['http://localhost:5045/api/v1/establishments',
      'https://basemaps.cartocdn.com.example.org/tile.png']) {
      expect(basemapRequest(url)).toEqual({ url })
    }
  })

  it('leaves requests unchanged when no key is configured', () => {
    vi.stubEnv('VITE_CARTO_BASEMAP_API_KEY', '')
    const url = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
    expect(basemapRequest(url)).toEqual({ url })
  })
})
