import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import type { InspectionDetail } from '../api/contract'
import { InspectionComparison } from './InspectionComparison'
const record = (id: number, date: string, codes: string[]): InspectionDetail => ({ id, inspectedOn: date, inspectionType: null, action: null, rawGrade: null, rawScore: null, outcome: 'Ungraded', normalisedSeverity: null, closedByAuthority: false, violations: codes.map(code => ({ code, description: null, isCritical: false })) })
it('separates added, repeated and absent citation codes and changes the comparison record', async () => {
  render(<InspectionComparison inspections={[record(3, '2026-07-22', ['04L','05D']), record(2, '2026-07-17', ['04L','10F']), record(1, '2026-06-01', [])]} />)
  expect(screen.getByText('Only in latest record (1)')).toBeInTheDocument()
  expect(screen.getByText('Cited in both records (1)')).toBeInTheDocument()
  expect(screen.getByText('Only in comparison record (1)')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Compare latest with' }), '1')
  expect(screen.getByText('Only in latest record (2)')).toBeInTheDocument()
  expect(screen.getByText('Cited in both records (0)')).toBeInTheDocument()
})
it('does not imply chronology within one day', () => {
  render(<InspectionComparison inspections={[record(2, '2026-07-22', []), record(1, '2026-07-22', [])]} />)
  expect(screen.getByText(/order within that day is unknown/)).toBeInTheDocument()
})
it('does not offer comparison without an earlier record', () => {
  render(<InspectionComparison inspections={[record(1, '2026-07-22', [])]} />)
  expect(screen.queryByRole('region', { name: 'Compare inspection citations' })).not.toBeInTheDocument()
})
