/**
 * Unit tests for the command-completion notification template (fixed zh/en
 * copy per plan §2.6, including the "user-started" marker).
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
  it('renders the zh template with the user-started marker', () => {
    const text = completionNoticeText(snapshot(), 'zh')
    expect(text).toBe('后台任务 task-1「每日总结」已完成（用户手动启动）[status: completed]')
  })

  it('renders the en template with the user-started marker', () => {
    const text = completionNoticeText(snapshot(), 'en')
    expect(text).toBe(
      'Background job task-1 "每日总结" finished (user-started) [status: completed]',
    )
  })

  it('includes the producer detail inside the status bracket', () => {
    const text = completionNoticeText(snapshot({ status: 'failed', detail: 'exit code: 3' }), 'en')
    expect(text).toBe(
      'Background job task-1 "每日总结" finished (user-started) [status: failed, exit code: 3]',
    )
  })

  it('falls back to English for unknown locales', () => {
    const text = completionNoticeText(snapshot(), 'fr')
    expect(text).toContain('Background job')
  })
})
