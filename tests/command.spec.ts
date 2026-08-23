/**
 * Unit tests for the completion-notice template: the official tool-jobs
 * notice shape with the `User-started job` marker.
 */

import type { JobId, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { describe, expect, it } from 'vitest'
import { completionNoticeText } from '../src/host/command.ts'

function snapshot(overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: 'task-1' as JobId,
    kind: 'task',
    label: '每日总结',
    status: 'completed',
    startedAt: 0,
    reported: false,
    ...overrides,
  }
}

describe('completionNoticeText', () => {
  it('renders the English template with the user-started marker', () => {
    const text = completionNoticeText(snapshot())
    expect(text).toBe(
      'User-started job task-1 (task: 每日总结) finished [status: completed]. Read its output with job_output.',
    )
  })

  it('includes the producer detail inside the status bracket', () => {
    const text = completionNoticeText(snapshot({ status: 'failed', detail: 'exit code: 3' }))
    expect(text).toBe(
      'User-started job task-1 (task: 每日总结) finished [status: failed, exit code: 3]. Read its output with job_output.',
    )
  })
})
