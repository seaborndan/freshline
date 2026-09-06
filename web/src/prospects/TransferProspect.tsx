import { useState } from 'react'
import type { SavedProspect } from './model'

export function TransferProspect({ prospect, saved, onTransfer }: {
  prospect: SavedProspect
  saved: SavedProspect[]
  onTransfer: (destination: string, move: boolean) => boolean
}) {
  const [open, setOpen] = useState(false)
  const [destination, setDestination] = useState('')
  const [move, setMove] = useState(false)
  const name = destination.trim()
  const exists = saved.some(p => p.id === prospect.id && p.list === name)
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Copy or move to another list</button>
  return <form className="transfer-prospect" onSubmit={e => {
    e.preventDefault()
    if (name && !exists && onTransfer(name, move)) { setOpen(false); setDestination('') }
  }}>
    <label>Destination list<input required maxLength={80} value={destination} onChange={e => setDestination(e.target.value)} /></label>
    <div className="transfer-choices">{[...new Set(saved.map(p => p.list))].filter(list => list !== prospect.list).map(list => <button type="button" key={list} onClick={() => setDestination(list)}>{list}</button>)}</div>
    <label>Action<select value={move ? 'move' : 'copy'} onChange={e => setMove(e.target.value === 'move')}><option value="copy">Copy — keep in both lists</option><option value="move">Move — remove from this list</option></select></label>
    <p>Notes, status, follow-up date and saved evidence go with this restaurant. {move ? `It will leave “${prospect.list}”.` : 'The two copies can be edited independently.'}</p>
    {exists ? <p role="status">This restaurant is already in that list. Its existing record will not be overwritten.</p> : null}
    <button type="submit" disabled={!name || exists}>{move ? 'Move restaurant' : 'Copy restaurant'}</button>
    <button type="button" onClick={() => setOpen(false)}>Cancel transfer</button>
  </form>
}
