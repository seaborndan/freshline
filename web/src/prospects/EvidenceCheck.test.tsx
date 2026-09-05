import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { fetchEstablishment } from '../api/client'
import type { EstablishmentDetail } from '../api/contract'
import { EvidenceCheck } from './EvidenceCheck'
vi.mock('../api/client', () => ({ fetchEstablishment: vi.fn() }))
const prospect = { id: 1, name: 'Cafe', address: null, locality: null, phone: null, inspectedOn: '2026-06-01', evidence: [{ code: '04L', description: 'Mice' }] }
const record: EstablishmentDetail = { id: 1, name: 'Cafe', addressLine: null, locality: null, phone: null, cuisine: null, postalCode: null, latitude: null, longitude: null, isAwaitingFirstInspection: false,
  inspections: [{ id: 2, inspectedOn: '2026-07-01', inspectionType: null, action: null, rawGrade: 'A', rawScore: 5, outcome: 'Good', normalisedSeverity: 5, closedByAuthority: false, violations: [] }] }
it('shows changed citations without claiming a problem was resolved', async () => {
  vi.mocked(fetchEstablishment).mockResolvedValue(record)
  render(<EvidenceCheck prospect={prospect} />)
  await userEvent.click(screen.getByRole('button', { name: 'Check for newer inspection' }))
  expect(await screen.findByText(/Newer inspection · 1 July 2026/)).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('None of your saved citation codes')
  expect(screen.getByRole('status')).toHaveTextContent('does not prove the issue was resolved')
  expect(prospect.evidence[0].code).toBe('04L')
})
it('shows repeated evidence in the newer inspection', async () => {
  vi.mocked(fetchEstablishment).mockResolvedValue({ ...record, inspections: [{ ...record.inspections[0], violations: [{ code: '04L', description: 'Mice', isCritical: true }] }] })
  render(<EvidenceCheck prospect={prospect} />)
  await userEvent.click(screen.getByRole('button', { name: 'Check for newer inspection' }))
  expect(await screen.findByText(/Saved citation codes repeated: 04L/)).toBeInTheDocument()
})
it('reports failure without claiming that evidence is current', async () => {
  vi.mocked(fetchEstablishment).mockRejectedValue(new Error('offline'))
  render(<EvidenceCheck prospect={prospect} />)
  await userEvent.click(screen.getByRole('button', { name: 'Check for newer inspection' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not check')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
