import { describe, expect, it } from 'vitest'
import { WORKFLOW_LABELS } from '@/features/import-scanner/lib/workflowLabels'
import type { Workflow } from '@/types'

const allWorkflows: Workflow[] = [
  'single-student-upload',
  'single-student-scan',
  'mixed-batch-upload',
  'mixed-batch-scan'
]

describe('WORKFLOW_LABELS', () => {
  it('labels every workflow the page can be in', () => {
    expect(Object.keys(WORKFLOW_LABELS)).toHaveLength(4)
    for (const workflow of allWorkflows) {
      expect(WORKFLOW_LABELS[workflow]).toBeTruthy()
    }
  })

  it('collapses upload/scan variants onto one heading per mode', () => {
    expect(WORKFLOW_LABELS['single-student-upload']).toBe('Single Student Import')
    expect(WORKFLOW_LABELS['single-student-scan']).toBe('Single Student Import')
    expect(WORKFLOW_LABELS['mixed-batch-upload']).toBe('Mixed-Batch Import')
    expect(WORKFLOW_LABELS['mixed-batch-scan']).toBe('Mixed-Batch Import')
  })

  it('keeps the two modes distinguishable', () => {
    expect(WORKFLOW_LABELS['single-student-scan']).not.toBe(WORKFLOW_LABELS['mixed-batch-scan'])
  })

  it('exposes exactly the workflow keys and nothing else', () => {
    expect(Object.keys(WORKFLOW_LABELS).sort()).toEqual([...allWorkflows].sort())
  })
})
