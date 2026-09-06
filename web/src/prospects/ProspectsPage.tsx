import { useEffect, useRef, useState } from 'react'
import { fetchProspectCategories, fetchProspects } from '../api/client'
import { formatPlainDate } from '../api/plainDate'
import { useFilterOptions } from '../filters/useFilterOptions'
import { useDatasetSummary } from '../landing/useDatasetSummary'
import { WorkspaceBackup } from './WorkspaceBackup'
import { EvidenceCheck } from './EvidenceCheck'
import { FollowUpAgenda } from './FollowUpAgenda'
import { VisitBrief } from './VisitBrief'
import { BatchSave } from './BatchSave'
import { SavedSearches } from './SavedSearches'
import { ActivityTimeline } from './ActivityTimeline'
import { TransferProspect } from './TransferProspect'
import { transferProspect } from './workspace'
import { isDue, localToday, readDiscovery, savedMatches, workspaceQuery } from './workspace'
import { downloadCsv, toCsv } from '../reports/csv'
import type { Route } from '../routing/route'
import { readSaved, stages, storageKey, type OpportunityCategory, type Prospect, type ProspectResult, type SavedProspect } from './model'

export function ProspectsPage({ onNavigate }: { onNavigate: (route: Route, search?: string) => void }) {
  const options = useFilterOptions()
  const dataset = useDatasetSummary()
  const [filters, setFilters] = useState(() => readDiscovery(location.search))
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
  const [list, setList] = useState(new URLSearchParams(location.search).get('list') ?? initialStorage.saved[0]?.list ?? '')
  const [savingId, setSavingId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [onlyUnsaved, setOnlyUnsaved] = useState(false)
  const [categories, setCategories] = useState<OpportunityCategory[]>([])
  const [categoryError, setCategoryError] = useState('')
  const [mode, setMode] = useState<'discover' | 'saved'>(new URLSearchParams(location.search).has('list') ? 'saved' : 'discover')
  const [announcement, setAnnouncement] = useState('')
  const [removed, setRemoved] = useState<SavedProspect | null>(null)
  const listName = list.trim()
  const [savedSearch, setSavedSearch] = useState('')
  const [agendaId, setAgendaId] = useState<number | null>(null)
  const [stageFilter, setStageFilter] = useState('')
  const [dueOnly, setDueOnly] = useState(false)
  const [rename, setRename] = useState<string | null>(null)
  const [renameError, setRenameError] = useState('')
  const [page, setPage] = useState(1)
  const grid = useRef<HTMLDivElement>(null)
  const [today, setToday] = useState(localToday)
  useEffect(() => {
    const refresh = () => setToday(localToday())
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])

  useEffect(() => {
    history.replaceState(null, '', `/prospects${workspaceQuery(request, mode === 'saved' ? listName : undefined)}`)
  }, [request, mode, listName])

  useEffect(() => { setPage(1) }, [request, mode, listName, savedSearch, stageFilter, dueOnly])
  useEffect(() => { setSelectedIds([]) }, [request, mode])

  useEffect(() => {
    function synchronize(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return
      try { setSaved(readSaved(localStorage.getItem(storageKey))); setStorageError('') }
      catch { setStorageError('Saved work changed in another tab but could not be read. Reload before editing.') }
    }
    window.addEventListener('storage', synchronize)
    return () => window.removeEventListener('storage', synchronize)
  }, [])

  useEffect(() => {
    if (mode !== 'discover') return
    const controller = new AbortController()
    fetchProspectCategories(controller.signal).then(data => {
      if (!controller.signal.aborted) { setCategories(data); setCategoryError('') }
    }).catch(() => {
      if (!controller.signal.aborted) setCategoryError('Category choices are unavailable. Reload to try again.')
    })
    return () => controller.abort()
  }, [mode])

  useEffect(() => {
    if (mode !== 'discover') return
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
  }, [request, mode])

  function persist(next: SavedProspect[]) {
    if (initialStorage.error) return false
    try {
      const current = readSaved(localStorage.getItem(storageKey))
      if (JSON.stringify(current) !== JSON.stringify(saved)) {
        setSaved(current)
        setStorageError('Your saved work changed in another tab. The latest version is loaded; please repeat your edit.')
        return false
      }
    } catch { setStorageError('Existing saved work could not be read. Reload before editing.'); return false }
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(next); setStorageError(''); return true }
    catch { setStorageError('Could not save. Browser storage may be full or blocked; your change was not saved.'); return false }
  }
  function save(p: Prospect) {
    if (!listName || saved.some(s => s.id === p.id && s.list === listName)) return
    if (persist([...saved, { ...p, list: listName, stage: 'To review', notes: '' }])) {
      setSavingId(null)
      setAnnouncement(`Saved ${p.name} to ${listName}.`)
    }
  }
  function update(p: SavedProspect, patch: Partial<Pick<SavedProspect, 'stage' | 'notes' | 'followUpOn' | 'activities'>>) {
    return persist(saved.map(s => s.id === p.id && s.list === p.list ? { ...s, ...patch } : s))
  }
  const currentList = saved.filter(s => s.list === listName)
  const filteredSaved = currentList.filter(p => (agendaId === null || p.id === agendaId) && savedMatches(p, savedSearch, stageFilter, dueOnly, today))
    .sort((a, b) => Number(isDue(b, today)) - Number(isDue(a, today)) ||
      (a.followUpOn || '9999').localeCompare(b.followUpOn || '9999') || a.name.localeCompare(b.name))
  const rows: Prospect[] = mode === 'saved' ? filteredSaved : (result?.items ?? []).filter(p => !onlyUnsaved || !saved.some(s => s.id === p.id))
  const visiblePage = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)))
  const visibleRows = rows.slice((visiblePage - 1) * 20, visiblePage * 20)
  function resetSavedFilters() { setSavedSearch(''); setStageFilter(''); setDueOnly(false); setAgendaId(null) }
  function renameList() {
    const nextName = rename?.trim() ?? ''
    if (!nextName) { setRenameError('Enter a list name.'); return }
    if (nextName !== listName && saved.some(p => p.list === nextName)) { setRenameError('That name already belongs to another list. Choose a different name.'); return }
    if (persist(saved.map(p => p.list === listName ? { ...p, list: nextName } : p))) {
      setList(nextName); setRename(null); setRenameError(''); setRemoved(null); setAnnouncement(`List renamed to ${nextName}.`)
    }
  }
  function exportList() {
    downloadCsv('freshline-prospects.csv', toCsv({
      provenance: ['Freshline — saved prospect evidence; not proof of current need.', 'Source: NYC DOHMH via NYC Open Data. Saved inspection snapshots may be outdated.'],
      header: ['List', 'Name', 'Address', 'Borough', 'Phone', 'Inspection date', 'Evidence', 'Stage', 'Notes', 'Follow-up date', 'Inspection history'],
      rows: currentList.map(p => [p.list, p.name, p.address ?? '', p.locality ?? '', p.phone ?? '', p.inspectedOn,
        p.evidence.map(e => `${e.code}: ${e.description ?? 'No description published'}`).join(' | '), p.stage, p.notes, p.followUpOn ?? '',
        `${location.origin}/map?id=${p.id}`]),
    }))
    setAnnouncement('List exported as CSV.')
  }

  return <div className="prospects reports">
    <header className="prospect-hero">
      <div><p className="eyebrow">{mode === 'saved' ? 'YOUR TERRITORY / YOUR NEXT STEP' : 'FROM PUBLIC RECORDS TO A USEFUL SHORTLIST'}</p><h1>{mode === 'saved' ? 'Make the next conversation count.' : 'Find a reason to reach out.'}</h1>
        <p className="prospect-lede">{mode === 'saved' ? 'Review your shortlist, keep the context, and decide who needs a follow-up.' : 'Choose an opportunity type. Find supporting inspection evidence. Build your own shortlist.'}</p></div>
      <div className="prospect-method"><strong>Evidence, not assumptions.</strong><p>Categories match specific citations at the latest recorded inspection. They suggest something to investigate, not proof of a current problem, equipment failure, or unmet service need.</p></div>
    </header>
    <div className="work-actions"><a href="/work">My day and visit planner</a><a href="/research">Custom discovery rules</a><a href="/research?prePermit=true">Pre-permit research</a><a href="/data">Data health</a></div>
    <div className="prospect-tabs" aria-label="Prospect workspace">
      <button type="button" aria-pressed={mode === 'discover'} onClick={() => setMode('discover')}>Discover prospects</button>
      <button type="button" aria-pressed={mode === 'saved'} onClick={() => setMode('saved')}>Saved lists ({new Set(saved.map(p => p.list)).size})</button>
    </div>
    {mode === 'saved' ? <section className="list-tools" aria-label="Saved list settings">
      <label>Saved list<select value={list} onChange={e => { setList(e.target.value); resetSavedFilters(); setRename(null) }}><option value="">Choose a saved list</option>{[...new Set(saved.map(s => s.list))].map(name => <option key={name}>{name}</option>)}</select></label>
      <p>Saved only in this browser. Export your list to keep a copy. Notes and contact status are personal records; nothing is sent to restaurants.</p>
      <button type="button" onClick={exportList} disabled={currentList.length === 0}>Export list CSV</button>
      {currentList.length > 0 ? <a href={`/prospects/map?list=${encodeURIComponent(listName)}`}>View entire list on map</a> : null}
      <button type="button" disabled={!currentList.length} onClick={() => { setRename(listName); setRenameError('') }}>Rename list</button>
    </section> : null}
    {mode === 'saved' ? <>
      <FollowUpAgenda saved={saved} today={today} onOpen={p => { setList(p.list); resetSavedFilters(); setAgendaId(p.id); setRename(null); setPage(1); grid.current?.scrollIntoView?.({ block: 'start' }) }} />
      {agendaId !== null ? <p className="prospect-count">Showing the restaurant selected from your agenda. <button type="button" onClick={resetSavedFilters}>Show full list</button></p> : null}
      {rename !== null ? <form className="rename-list" onSubmit={e => { e.preventDefault(); renameList() }}><label>New list name<input autoFocus required maxLength={80} value={rename} onChange={e => setRename(e.target.value)} /></label><button type="submit">Save list name</button><button type="button" onClick={() => setRename(null)}>Cancel rename</button>{renameError ? <p role="alert">{renameError}</p> : null}</form> : null}
      <div className="workspace-stats" aria-label="List progress">
        <button type="button" aria-pressed={!dueOnly && !stageFilter} onClick={resetSavedFilters}><strong>{currentList.length}</strong><span>Saved places</span></button>
        <button type="button" aria-pressed={stageFilter === 'To review'} onClick={() => { setStageFilter('To review'); setDueOnly(false) }}><strong>{currentList.filter(p => p.stage === 'To review').length}</strong><span>To review</span></button>
        <button type="button" aria-pressed={dueOnly} onClick={() => { setDueOnly(!dueOnly); setStageFilter('') }}><strong>{currentList.filter(p => isDue(p, today)).length}</strong><span>Due for follow-up</span></button>
      </div>
      <div className="saved-filters"><label>Search saved places<input type="search" value={savedSearch} onChange={e => setSavedSearch(e.target.value)} placeholder="Restaurant, address, borough or notes" /></label><label>Filter contact status<select value={stageFilter} onChange={e => setStageFilter(e.target.value)}><option value="">All statuses</option>{stages.map(s => <option key={s}>{s}</option>)}</select></label><button type="button" onClick={resetSavedFilters}>Clear saved filters</button></div>
      <WorkspaceBackup saved={saved} onRestore={next => { if (!persist(next)) return false; if (!next.some(p => p.list === listName)) setList(next[0]?.list ?? ''); return true }} />
      <VisitBrief rows={filteredSaved} list={listName} />
    </> : null}
    {storageError ? <p role="alert" className="reports-notice">{storageError}</p> : null}
    {removed ? <p className="prospect-count">Removed {removed.name} from {removed.list}. <button type="button" onClick={() => {
      if (persist([...saved.filter(s => s.id !== removed.id || s.list !== removed.list), removed])) setRemoved(null)
    }}>Undo removal</button></p> : null}
    {mode === 'discover' ? <>
      <p className="dataset-freshness">{dataset.summary?.latestInspectionOn ? <>Latest inspection in this dataset: <strong>{formatPlainDate(dataset.summary.latestInspectionOn)}</strong>. Individual records may be older.</> : dataset.failure ? 'Dataset freshness is unavailable.' : 'Checking dataset coverage…'}</p>
      <form className="reports-controls" onSubmit={e => { e.preventDefault(); setRequest({ ...filters }) }}>
        <label>Opportunity type<select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}><option value="all">All opportunity types</option>{categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Borough<select value={filters.locality} onChange={e => setFilters({ ...filters, locality: e.target.value })}><option value="">All boroughs</option>{options?.localities.map(b => <option key={b}>{b}</option>)}</select></label>
        <label>Inspected from<input type="date" required value={filters.from} max={filters.to} onChange={e => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>Inspected to<input type="date" required min={filters.from} value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} /></label>
        <button className="reports-export" disabled={loading}>Find prospects</button>
      </form>
      {categoryError ? <p role="alert">{categoryError}</p> : null}
      <div className="category-explanation"><strong>What matches this category?</strong><p>{filters.category === 'all' ? 'Any of the supported categories below. A restaurant may have evidence relevant to more than one service.' : categories.find(c => c.id === filters.category)?.description}</p>
        <details><summary>See the evidence rules</summary>{categories.filter(c => filters.category === 'all' || c.id === filters.category).map(c => <p key={c.id}><strong>{c.label}</strong> — {c.description} <span>Codes: {c.codes.join(', ')}.</span></p>)}</details>
      </div>
      <p className="eyebrow">Results for: {request.category === 'all' ? 'All opportunity types' : categories.find(c => c.id === request.category)?.label ?? request.category}</p>
      {failure ? <p role="alert">{failure}</p> : <p role="status" className="prospect-count">{loading ? 'Checking the latest inspection evidence…' : result?.isTruncated ? 'Showing the 200 most recently inspected matches. Narrow the borough or dates to see a smaller set.' : `${rows.length} matching places · newest inspections first`}</p>}
      <p className="discovery-continuity">Your submitted search is in the address bar. Bookmark or copy its URL to return to this territory.</p>
      <SavedSearches search={request} categories={categories} onRun={search => { setFilters(search); setRequest({ ...search }); setOnlyUnsaved(false) }} />
      <label className="prospect-select"><input type="checkbox" checked={onlyUnsaved} onChange={e => { setOnlyUnsaved(e.target.checked); setSelectedIds([]); setPage(1) }} />Only unsaved places</label>
      {onlyUnsaved && result ? <p className="prospect-count">{rows.length} of {result.items.length} loaded matches are not in any saved list. This filters the loaded results; narrow your search if the API limit was reached.</p> : null}
    </> : <p className="prospect-count">{rows.length} of {currentList.length} saved in “{listName || 'Choose a list name'}” · due follow-ups first · evidence is a snapshot from when you saved it</p>}
    <p className="sr-announcement" role="status">{announcement}</p>
    {!loading && !failure && rows.length === 0 && mode === 'discover' ? <div className="prospect-empty"><h2>{onlyUnsaved && result?.items.length ? 'These loaded matches are already in your lists.' : 'No matching evidence in this period.'}</h2><p>{onlyUnsaved && result?.items.length ? 'Turn off Only unsaved places to review them, or change your search to explore another territory.' : 'Try a wider date range or another borough. An older citation is excluded if a newer inspection no longer cites these codes.'}</p></div> : null}
    {mode === 'discover' && !loading && rows.length > 0 ? <div className="discovery-selection"><button type="button" onClick={() => setSelectedIds(previous => [...new Set([...previous, ...visibleRows.map(p => p.id)])])}>Select this page ({visibleRows.length})</button><span>Select places to save them together. A new search clears the selection.</span></div> : null}
    {mode === 'discover' && selectedIds.length > 0 ? <BatchSave selected={rows.filter(p => selectedIds.includes(p.id))} saved={saved} onClear={() => setSelectedIds([])} onSave={(additions, destination) => {
      if (!persist([...saved, ...additions])) return false
      setSelectedIds([]); setList(destination); setAnnouncement(`Saved ${additions.length} places to ${destination}.`)
      return true
    }} /> : null}
    {mode === 'saved' && !rows.length ? <div className="prospect-empty"><h2>{currentList.length ? 'Nothing matches these saved filters.' : 'Your next conversation starts here.'}</h2><p>{currentList.length ? 'Clear the filters to see the rest of this list.' : 'Save a place from Discover prospects to begin this list.'}</p></div> : null}
    <div className="prospect-grid" ref={grid}>{visibleRows.map(p => {
      const existing = saved.find(s => s.id === p.id && s.list === listName)
      return <article key={p.id} className="prospect-card">
        {mode === 'discover' ? <label className="prospect-select"><input type="checkbox" checked={selectedIds.includes(p.id)} onChange={e => setSelectedIds(previous => e.target.checked ? [...previous, p.id] : previous.filter(id => id !== p.id))} />Select {p.name}</label> : null}
        <div className="prospect-card-head"><span className="eyebrow">{p.locality ?? 'Borough unavailable'}</span><span>{p.inspectedOn ? formatPlainDate(p.inspectedOn) : 'No inspection recorded'}</span></div>
        <h2>{p.name}</h2><p className="prospect-address">{p.address ?? 'Address not published'}</p>
        <div className="prospect-evidence"><h3>Saved inspection evidence</h3>{p.evidence.length === 0 ? <p>No citations saved. This restaurant was selected for your territory.</p> : null}<ul>{p.evidence.map(e => <li key={e.code}><strong>{e.code}</strong> {e.description ?? 'No description published.'}</li>)}</ul></div>
        <div className="prospect-actions"><a href={`/map?id=${p.id}&focus=1`} onClick={e => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); onNavigate('map', `?id=${p.id}&focus=1`) } }}>View on map</a>
          <a href={`/map?id=${p.id}`} onClick={e => { if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.button === 0) { e.preventDefault(); onNavigate('map', `?id=${p.id}`) } }}>View inspection history ↗</a>
          {p.phone ? <a href={`tel:${p.phone.replace(/[^+\d]/g, '')}`}>{p.phone}</a> : <span>No phone published</span>}
        </div>
        {mode === 'saved' && existing ? <div className="prospect-notes">
          <EvidenceCheck prospect={existing} />
          <ActivityTimeline prospect={existing} onSave={activities => update(existing, { activities })} />
          <TransferProspect prospect={existing} saved={saved} onTransfer={(destination, move) => {
            const next = transferProspect(saved, existing.id, existing.list, destination, move)
            if (!next || !persist(next)) return false
            setAnnouncement(`${move ? 'Moved' : 'Copied'} ${existing.name} to ${destination}.`)
            if (move) { setList(destination); resetSavedFilters(); setRemoved(null) }
            return true
          }} />
          {isDue(existing, today) && existing.followUpOn ? <p className="followup-due">{existing.followUpOn === today ? 'Follow up today' : `Follow-up overdue · ${formatPlainDate(existing.followUpOn)}`}</p> : null}
          <label>Contact status<select value={existing.stage} onChange={e => update(existing, { stage: e.target.value as SavedProspect['stage'] })}>{stages.map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Next follow-up<input type="date" value={existing.followUpOn ?? ''} onChange={e => update(existing, { followUpOn: e.target.value })} /></label>
          {existing.followUpOn ? <button type="button" className="prospect-remove" onClick={() => update(existing, { followUpOn: '' })}>Clear follow-up date</button> : null}
          <label>Notes<textarea maxLength={2000} value={existing.notes} onChange={e => update(existing, { notes: e.target.value })} placeholder="What did you learn? What happens next?" /></label>
          <button type="button" className="prospect-remove" onClick={() => {
            if (persist(saved.filter(s => s.id !== existing.id || s.list !== existing.list))) setRemoved(existing)
          }}>Remove from list</button>
        </div> : savingId === p.id ? <form className="prospect-save-form" onSubmit={e => { e.preventDefault(); save(p) }}>
          <label>List name<input autoFocus required list="save-list-choices" maxLength={80} value={list} placeholder="e.g. Queens sanitation outreach" onChange={e => setList(e.target.value)} /></label>
          <datalist id="save-list-choices">{[...new Set(saved.map(s => s.list))].map(name => <option key={name} value={name} />)}</datalist>
          <p>Choose an existing list or name a new one. This organizes saved places; it does not change discovery.</p>
          {existing ? <p>Already saved in this list. Choose another name to save elsewhere.</p> : null}
          <button type="submit" disabled={!listName || !!existing}>Save prospect</button>
          <button type="button" onClick={() => setSavingId(null)}>Cancel</button>
        </form> : <>
          {saved.some(s => s.id === p.id) ? <p className="saved-membership">Saved in: {saved.filter(s => s.id === p.id).map(s => s.list).join(', ')}</p> : null}
          <button type="button" className="prospect-save" disabled={!!initialStorage.error} onClick={() => setSavingId(p.id)}>Save to list</button>
        </>}
      </article>
    })}</div>
    {rows.length > 20 ? <nav className="prospect-pagination" aria-label="Prospect pages"><button type="button" disabled={visiblePage === 1} onClick={() => { setPage(visiblePage - 1); grid.current?.scrollIntoView?.({ block: 'start' }) }}>Previous prospects</button><span>Page {visiblePage} of {Math.ceil(rows.length / 20)} · {rows.length} loaded places</span><button type="button" disabled={visiblePage * 20 >= rows.length} onClick={() => { setPage(visiblePage + 1); grid.current?.scrollIntoView?.({ block: 'start' }) }}>Next prospects</button></nav> : null}
  </div>
}
