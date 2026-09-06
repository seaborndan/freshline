import { useState } from 'react'
import type { DiscoverySearch } from './workspace'
import { readSearches, resolveSearch, searchStorageKey, type SavedSearch } from './searchBookmarks'
import type { OpportunityCategory } from './model'
import { formatPlainDate } from '../api/plainDate'

export function SavedSearches({ search, categories, onRun }: { search: DiscoverySearch; categories: OpportunityCategory[]; onRun: (search: DiscoverySearch) => void }) {
  const [initial] = useState(() => {
    try { return { rows: readSearches(localStorage.getItem(searchStorageKey)), error: '' } }
    catch { return { rows: [], error: 'Saved searches are unavailable. Existing browser data has not been changed.' } }
  })
  const [rows, setRows] = useState(initial.rows)
  const [name, setName] = useState('')
  const [rollingDays, setRollingDays] = useState(0)
  const [message, setMessage] = useState(initial.error)
  const [removed, setRemoved] = useState<SavedSearch | null>(null)
  function persist(next: SavedSearch[]) {
    try {
      const current = readSearches(localStorage.getItem(searchStorageKey))
      if (JSON.stringify(current) !== JSON.stringify(rows)) { setRows(current); setMessage('Searches changed in another tab. The latest version is loaded; please repeat your action.'); return false }
      localStorage.setItem(searchStorageKey, JSON.stringify(next)); setRows(next); return true
    } catch { setMessage('Could not save searches. Browser storage may be blocked, full or unreadable.'); return false }
  }
  return <details className="saved-searches"><summary>Saved searches ({rows.length})</summary>
    <p>Keep up to 50 searches in this browser. Choose fixed dates or a rolling window ending on the day you run it. Search bookmarks are separate from restaurant-list backups.</p>
    <form onSubmit={e => {
      e.preventDefault()
      const trimmed = name.trim()
      if (!trimmed) return
      if (rows.some(p => p.name === trimmed)) { setMessage('That search name already exists. Choose another name.'); return }
      if (rows.length >= 50) { setMessage('Remove a saved search before adding another.'); return }
      if (persist([...rows, { ...search, name: trimmed, ...(rollingDays ? { rollingDays } : {}) }])) { setName(''); setMessage(`Saved search “${trimmed}”.`) }
    }}><label>Search name<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Queens sanitation" /></label><label>Date behavior<select value={rollingDays} onChange={e => setRollingDays(Number(e.target.value))}><option value={0}>Keep submitted dates</option>{[7, 30, 90, 180].map(days => <option key={days} value={days}>Last {days} days, including today</option>)}</select></label><button disabled={!!initial.error} type="submit">Save submitted search</button></form>
    <p>Uses your submitted category and borough. Rolling windows use inspection dates, not the date records were imported. They run only when you click Run search.</p>
    {message ? <p role="status">{message}</p> : null}
    {removed ? <p>Removed “{removed.name}”. <button type="button" onClick={() => {
      if (rows.some(p => p.name === removed.name) || rows.length >= 50) { setMessage('Cannot restore this search: its name is taken or the limit was reached.'); return }
      if (persist([...rows, removed])) { setRemoved(null); setMessage('Search restored.') }
    }}>Undo search removal</button></p> : null}
    <ul>{rows.map(p => <li key={p.name}><div><strong>{p.name}</strong><p>{p.locality || 'All boroughs'} · {p.category === 'all' ? 'All opportunity types' : categories.find(c => c.id === p.category)?.label ?? p.category}<br />{p.rollingDays ? `Last ${p.rollingDays} days, including the day you run it` : `${formatPlainDate(p.from)} – ${formatPlainDate(p.to)}`}</p></div><button type="button" onClick={() => onRun(resolveSearch(p))}>Run search<span className="visually-hidden"> {p.name}</span></button><button type="button" onClick={() => { if (persist(rows.filter(row => row.name !== p.name))) { setRemoved(p); setMessage('') } }}>Remove search<span className="visually-hidden"> {p.name}</span></button></li>)}</ul>
  </details>
}
