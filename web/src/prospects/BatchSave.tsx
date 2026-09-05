import { useState } from 'react'
import type { Prospect, SavedProspect } from './model'

export function BatchSave({ selected, saved, onSave, onClear }: {
  selected: Prospect[]; saved: SavedProspect[]; onSave: (rows: SavedProspect[], list: string) => boolean; onClear: () => void
}) {
  const [list, setList] = useState('')
  const name = list.trim()
  const additions = selected.filter(p => !saved.some(s => s.id === p.id && s.list === name))
  return <form className="batch-save" aria-label="Save selected prospects" onSubmit={e => {
    e.preventDefault()
    if (!name || !additions.length) return
    onSave(additions.map(p => ({ ...p, list: name, stage: 'To review', notes: '' })), name)
  }}>
    <div><strong>{selected.length} selected across result pages</strong><p>Choose a destination once. Existing notes, status and evidence in that list stay unchanged.</p></div>
    <label>Destination list<input required maxLength={80} list="batch-list-choices" value={list} onChange={e => setList(e.target.value)} placeholder="Choose or name a list" /></label>
    <datalist id="batch-list-choices">{[...new Set(saved.map(p => p.list))].map(value => <option key={value} value={value} />)}</datalist>
    {name ? <p role="status">{additions.length} new · {selected.length - additions.length} already in “{name}”</p> : null}
    <button type="submit" disabled={!name || !additions.length}>Save selected prospects</button>
    <button type="button" onClick={onClear}>Clear selection</button>
  </form>
}
