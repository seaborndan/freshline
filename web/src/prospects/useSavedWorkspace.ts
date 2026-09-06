import { useEffect, useState } from 'react'
import { readSaved, storageKey, type SavedProspect } from './model'

export function useSavedWorkspace() {
  const [initial] = useState(() => { try { return { rows: readSaved(localStorage.getItem(storageKey)), error: '' } } catch { return { rows: [], error: 'Saved work is unreadable or unavailable. It has not been overwritten.' } } })
  const [saved, setSaved] = useState<SavedProspect[]>(initial.rows)
  const [error, setError] = useState(initial.error)
  useEffect(() => {
    function sync() { try { setSaved(readSaved(localStorage.getItem(storageKey))); setError('') } catch { setError('Saved work changed but could not be read.') } }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  function persist(next: SavedProspect[]) {
    try {
      const current = readSaved(localStorage.getItem(storageKey))
      if (JSON.stringify(current) !== JSON.stringify(saved)) { setSaved(current); setError('Another tab changed your work. Latest records loaded; repeat your edit.'); return false }
      localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); setError(''); return true
    } catch { setError('Could not save. Storage may be full, blocked or unreadable.'); return false }
  }
  return { saved, error, persist }
}
