/** Authenticate CARTO resources, including tile URLs discovered inside its style document. */
export function basemapRequest(url: string): { url: string } {
  const key = import.meta.env.VITE_CARTO_BASEMAP_API_KEY?.trim()
  const resource = new URL(url, window.location.href)
  if (key && (resource.hostname === 'basemaps.cartocdn.com' ||
    resource.hostname.endsWith('.basemaps.cartocdn.com'))) {
    resource.searchParams.set('key', key)
    return { url: resource.toString() }
  }
  return { url }
}
