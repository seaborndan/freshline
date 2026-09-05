import { useRef, useState } from 'react'
import { readSaved, type SavedProspect } from './model'
import { localToday, mergeBackup } from './workspace'

export function WorkspaceBackup({ saved, onRestore }: { saved: SavedProspect[]; onRestore: (next: SavedProspect[]) => boolean }) {
  const [incoming, setIncoming] = useState<SavedProspect[] | null>(null)
  const [message, setMessage] = useState('')
  const input = useRef<HTMLInputElement>(null)
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'freshline-workspace', version: 1, saved }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `freshline-workspace-${localToday()}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('Backup download requested. Keep this file to restore your lists in another browser.')
  }
  const merged = incoming ? mergeBackup(saved, incoming) : null
  return <details className="workspace-backup"><summary>Backup & restore</summary>
    <p>Your lists, notes, statuses and follow-up dates live in this browser. Download a backup before clearing browser data, or restore it on another device. CSV is available for spreadsheet use.</p>
    <div className="workspace-actions"><button type="button" disabled={!saved.length} onClick={download}>Download workspace backup</button>
      <label className="backup-upload">Choose backup file<input ref={input} type="file" accept=".json,application/json" onChange={async e => {
        const file = e.target.files?.[0]
        setIncoming(null); setMessage('')
        if (!file) return
        try {
          if (file.size > 5_000_000) throw new Error('Backup is too large; maximum size is 5 MB.')
          const body = JSON.parse(await file.text())
          if (body?.format !== 'freshline-workspace' || body.version !== 1) throw new Error('Choose a Freshline workspace backup (version 1).')
          const records = readSaved(JSON.stringify(body.saved))
          if (records.length > 10000 || records.some(p => !p.list.trim() || p.list.length > 80 || p.notes.length > 2000)) throw new Error('Backup contains invalid list names, notes, or too many records.')
          setIncoming(records)
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read this backup.') }
      }} /></label>
    </div>
    {merged && incoming ? <div className="restore-preview"><p>{merged.length - saved.length} new saved records to add. Existing records, notes and dates will be kept when a restaurant is already in the same list.</p>
      <button type="button" onClick={() => { if (onRestore(merged)) { setIncoming(null); setMessage('Backup restored. Your existing work was preserved.'); if (input.current) input.current.value = '' } }}>Restore new records</button>
      <button type="button" onClick={() => { setIncoming(null); if (input.current) input.current.value = '' }}>Cancel restore</button></div> : null}
    {message ? <p role="status">{message}</p> : null}
  </details>
}
