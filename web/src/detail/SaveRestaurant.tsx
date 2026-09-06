import { useState } from 'react'
import type { EstablishmentDetail } from '../api/contract'
import { useSavedWorkspace } from '../prospects/useSavedWorkspace'

export function SaveRestaurant({ detail }: { detail: EstablishmentDetail }) {
  const { saved, error, persist } = useSavedWorkspace()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState('')
  const [message, setMessage] = useState('')
  const name = list.trim()
  const exists = saved.some(p => p.id === detail.id && p.list === name)
  return <section className="save-restaurant"><button type="button" onClick={() => setOpen(!open)}>Save restaurant to list</button>
    {open ? <form onSubmit={e => {
      e.preventDefault()
      if (!name || exists) return
      const inspection = detail.inspections[0]
      if (persist([...saved, { id: detail.id, name: detail.name, address: detail.addressLine, locality: detail.locality, phone: detail.phone, cuisine: detail.cuisine, inspectedOn: inspection?.inspectedOn ?? '', evidence: inspection?.violations.map(v => ({ code: v.code, description: v.description })) ?? [], list: name, stage: 'To review', notes: '', source: 'map' }])) { setMessage(`Saved to ${name}.`); setOpen(false) }
    }}><label>Destination list<input required maxLength={80} value={list} onChange={e => setList(e.target.value)} /></label><div className="transfer-choices">{[...new Set(saved.map(p => p.list))].map(value => <button type="button" key={value} onClick={() => setList(value)}>{value}</button>)}</div><p>Save any restaurant for your territory, with or without citations. Existing records are kept.</p>{exists ? <p>Already in this list.</p> : null}<button disabled={!name || exists} type="submit">Save restaurant</button></form> : null}
    {error ? <p role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </section>
}
