import { useEffect, useState } from 'react'
import { fetchProspects } from '../api/client'
import { formatPlainDate } from '../api/plainDate'
import { useFilterOptions } from '../filters/useFilterOptions'
import { downloadCsv, toCsv } from '../reports/csv'
import type { Route } from '../routing/route'
import { readSaved, stages, storageKey, type Prospect, type ProspectResult, type SavedProspect } from './model'

function initialDates() {
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 180)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10), locality: '' }
}

export function ProspectsPage({ onNavigate }: { onNavigate: (route: Route, search?: string) => void }) {
  const options = useFilterOptions()
  const [filters, setFilters] = useState(initialDates)
  const [request, setRequest] = useState(filters)
  const [result, setResult] = useState<ProspectResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState('')
  const [initialStorage] = useState(() => {
    try { return { saved: readSaved(localStorage.getItem(storageKey)), error: '' } }
    catch { return { saved: [], error: 'Saved lists are unavailable. Browser storage may be blocked or contain unreadable data.' } }
  })
  const [saved, setSaved] = useState<SavedProspect[]>(initialStorage.saved)
  const [storageError, setStorageError] = useState(initialStorage.error)
  const [list, setList] = useState('Pest-control prospects')
  const [mode, setMode] = useState<'discover' | 'saved'>('discover')
  const [announcement, setAnnouncement] = useState('')
  const [removed, setRemoved] = useState<SavedProspect | null>(null)
  const listName = list.trim()

  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setFailure('')
    setResult(null)
    fetchProspects(request, abort.signal).then(data => {
      if (!abort.signal.aborted) { setResult(data); setLoading(false) }
    }).catch(error => {
      if (!abort.signal.aborted) { setFailure(error instanceof Error ? error.message : 'Could not load prospects.'); setLoading(false) }
    })
    return () => abort.abort()
  }, [request])

  function persist(next: SavedProspect[]) {
    if (initialStorage.error) return false
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); setStorageError(''); return true }
    catch { setStorageError('Could not save. Browser storage may be full or blocked; your change was not saved.'); return false }
  }
  function save(p: Prospect) {
    if (!listName) return
    persist([...saved, { ...p, list: listName, stage: 'To review', notes: '' }])
  }
  function update(p: SavedProspect, patch: Partial<Pick<SavedProspect, 'stage' | 'notes'>>) {
    persist(saved.map(s => s.id === p.id && s.list === p.list ? { ...s, ...patch } : s))
  }
  const currentList = saved.filter(s => s.list === listName)
  const rows: Prospect[] = mode === 'saved' ? currentList : result?.items ?? []
  function exportList() {
    downloadCsv('freshline-prospects.csv', toCsv({
      provenance: ['Freshline — saved prospect evidence; not proof of current need.', 'Source: NYC DOHMH via NYC Open Data. Saved inspection snapshots may be outdated.'],
      header: ['List', 'Name', 'Address', 'Borough', 'Phone', 'Inspection date', 'Evidence', 'Stage', 'Notes', 'Inspection history'],
      rows: currentList.map(p => [p.list, p.name, p.address ?? '', p.locality ?? '', p.phone ?? '', p.inspectedOn,
        p.evidence.map(e => `${e.code}: ${e.description ?? 'No description published'}`).join(' | '), p.stage, p.notes,
        `${location.origin}/map?id=${p.id}`]),
    }))
    setAnnouncement('List exported as CSV.')
  }

  return <div className="prospects reports">
    <header className="prospect-hero">
      <div><p className="eyebrow">FROM PUBLIC RECORDS TO A USEFUL SHORTLIST</p><h1>Find a reason to reach out.</h1>
        <p className="prospect-lede">Pest-related inspection evidence, organized for people who serve restaurants.</p></div>
      <div className="prospect-method"><strong>Evidence, not assumptions.</strong><p>Matches cite mice, nuisance pests, or harborage conditions at the latest recorded inspection. They do not prove a current problem or an unmet service need.</p></div>
    </header>
    <div className="prospect-tabs" aria-label="Prospect workspace">
      <button type="button" aria-pressed={mode === 'discover'} onClick={() => setMode('discover')}>Discover prospects</button>
      <button type="button" aria-pressed={mode === 'saved'} onClick={() => setMode('saved')}>Saved lists ({saved.length})</button>
    </div>
    <section className="list-tools" aria-label="Saved list settings">
      <label>List name<input list="prospect-lists" maxLength={80} value={list} onChange={e => setList(e.target.value)} /></label>
      <datalist id="prospect-lists">{[...new Set(saved.map(s => s.list))].map(name => <option key={name} value={name} />)}</datalist>
      <p>Saved only in this browser. Export your list to keep a copy. Notes and contact status are personal records; nothing is sent to restaurants.</p>
      <button type="button" onClick={exportList} disabled={currentList.length === 0}>Export list CSV</button>
    </section>
    {storageError ? <p role="alert" className="reports-notice">{storageError}</p> : null}
    {removed ? <p className="prospect-count">Removed {removed.name} from {removed.list}. <button type="button" onClick={() => {
      if (persist([...saved.filter(s => s.id !== removed.id || s.list !== removed.list), removed])) setRemoved(null)
    }}>Undo removal</button></p> : null}
    {mode === 'discover' ? <>
      <form className="reports-controls" onSubmit={e => { e.preventDefault(); setRequest({ ...filters }) }}>
        <label>Borough<select value={filters.locality} onChange={e => setFilters({ ...filters, locality: e.target.value })}><option value="">All boroughs</option>{options?.localities.map(b => <option key={b}>{b}</option>)}</select></label>
        <label>Inspected from<input type="date" required value={filters.from} max={filters.to} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>Inspected to<input type="date" required min={filters.from} value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
        <button className="reports-export" disabled={loading}>Find prospects</button>
      </form>
      {failure ? <p role="alert">{failure}</p> : <p role="status" className="prospect-count">{loading ? 'Checking the latest inspection evidence…' : result?.isTruncated ? 'Showing the 200 most recently inspected matches. Narrow the borough or dates to see a smaller set.' : `${rows.length} matching places · newest inspections first`}</p>}
    </> : <p className="prospect-count">{currentList.length} saved in “{listName || 'Choose a list name'}” · evidence is a snapshot from when you saved it</p>}
    <p className="sr-announcement" role="status">{announcement}</p>
    {!loading && !failure && rows.length === 0 && mode === 'discover' ? <div className="prospect-empty"><h2>No matching evidence in this period.</h2><p>Try a wider date range or another borough. An older citation is excluded if a newer inspection no longer cites these codes.</p></div> : null}
    {mode === 'saved' && !rows.length ? <div className="prospect-empty"><h2>Your next conversation starts here.</h2><p>Save a place from Discover prospects to begin this list.</p></div> : null}
    <div className="prospect-grid">{rows.map(p => {
      const existing = saved.find(s => s.id === p.id && s.list === listName)
      return <article key={p.id} className="prospect-card">
        <div className="prospect-card-head"><span className="eyebrow">{p.locality ?? 'Borough unavailable'}</span><span>{formatPlainDate(p.inspectedOn)}</span></div>
        <h2>{p.name}</h2><p className="prospect-address">{p.address ?? 'Address not published'}</p>
        <div className="prospect-evidence"><h3>Why this place?</h3><ul>{p.evidence.map(e => <li key={e.code}><strong>{e.code}</strong> {e.description ?? 'No description published.'}</li>)}</ul></div>
        <div className="prospect-actions"><a href={`/map?id=${p.id}`} onClick={e => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); onNavigate('map', `?id=${p.id}`) } }}>View inspection history ↗</a>
          {p.phone ? <a href={`tel:${p.phone.replace(/[^+\d]/g, '')}`}>{p.phone}</a> : <span>No phone published</span>}
        </div>
        {mode === 'saved' && existing ? <div className="prospect-notes">
          <label>Contact status<select value={existing.stage} onChange={e => update(existing, { stage: e.target.value as SavedProspect['stage'] })}>{stages.map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Notes<textarea maxLength={2000} value={existing.notes} onChange={e => update(existing, { notes: e.target.value })} placeholder="What did you learn? What happens next?" /></label>
          <button type="button" className="prospect-remove" onClick={() => {
            if (persist(saved.filter(s => s.id !== existing.id || s.list !== existing.list))) setRemoved(existing)
          }}>Remove from list</button>
        </div> : <button type="button" className="prospect-save" disabled={!!existing || !listName || !!initialStorage.error} onClick={() => save(p)}>{existing ? 'Saved to this list ✓' : 'Save to list'}</button>}
      </article>
    })}</div>
  </div>
}
