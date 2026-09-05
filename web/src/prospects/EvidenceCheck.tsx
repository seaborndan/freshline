import { useEffect, useRef, useState } from 'react'
import { fetchEstablishment } from '../api/client'
import { formatPlainDate } from '../api/plainDate'
import type { InspectionDetail } from '../api/contract'
import type { Prospect } from './model'

export function EvidenceCheck({ prospect }: { prospect: Prospect }) {
  const [latest, setLatest] = useState<InspectionDetail | null>(null)
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function check() {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true); setError(''); setChecked(false)
    try {
      const record = await fetchEstablishment(prospect.id, request.signal)
      if (!request.signal.aborted) { setLatest(record.inspections[0] ?? null); setChecked(true) }
    } catch { if (!request.signal.aborted) setError('Could not check the latest record. Try again.') }
    finally { if (!request.signal.aborted) setLoading(false) }
  }
  const newer = latest !== null && latest.inspectedOn > prospect.inspectedOn
  const repeated = latest ? prospect.evidence.filter(e => latest.violations.some(v => v.code === e.code)).map(e => e.code) : []
  return <div className="evidence-check">
    <button type="button" onClick={check} disabled={loading}>{loading ? 'Checking inspection history…' : 'Check for newer inspection'}</button>
    {error ? <p role="alert">{error}</p> : null}
    {checked ? <div role="status">
      <strong>{newer && latest ? `Newer inspection · ${formatPlainDate(latest.inspectedOn)}` : latest ? 'No later inspection date in this dataset.' : 'No inspection history is currently available.'}</strong>
      {newer ? <p>{repeated.length ? `Saved citation codes repeated: ${repeated.join(', ')}.` : 'None of your saved citation codes appear in the newer inspection.'} Read the full history before acting; absence of a citation does not prove the issue was resolved.</p> : <p>This checks Freshline’s current dataset, not a live city feed. Your saved evidence is unchanged.</p>}
    </div> : null}
  </div>
}
