/**
 * The task store's WRITE BOUNDARY, on the real storage-domain machinery.
 *
 * Why this file exists (round-1 review P1): the storage layer parses records
 * only when it OPENS a domain (`KvTable.put` never does), and `openTaskStore` is
 * the first statement of the plugin's `apply` — so ONE record the zod schema
 * rejects makes every later start fail with `invalid-record`, taking the tool,
 * the approval gate, the skill and all eight RPC routes down with it, with no UI
 * path able to repair the stored data. `invalidRecords: 'backup-and-skip'` is
 * NOT a stopgap here: this spec has no `layout: 'per-record'`, and the `single`
 * unit has no `backupRecord`, so the domain layer falls back to rejecting.
 *
 * These tests therefore pin the two halves of the fix:
 * - a bad `type`/`scope` is rejected BEFORE the put (nothing lands on the medium,
 *   and the medium stays openable);
 * - a record that is already bad on the medium still fails `open` — the reason
 *   the write boundary, not the read policy, is where the fix belongs.
 *
 * The host is a fake in-memory storage hub/unit (`@deepseek-ai/dsh-storage` is a
 * transitive dependency, not a declared one), while the spec, the facility, the
 * domain projection and `TaskStore` are the production implementations.
 */
import { Context } from '@deepseek-ai/cordis'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import { TASK_STORE_SPEC, TaskStore } from '../src/host/tasks.ts'

/** The raw medium, shared by every open so a reopen observes earlier writes. */
interface FakeMedium {
  tables: Record<string, Record<string, unknown>>
  global: unknown
}

/** A fresh, empty medium with the spec's one declared table. */
function fakeMedium(): FakeMedium {
  return { tables: { tasks: {} }, global: null }
}

/** The `KvUnit` subset the domain layer uses (no `backupRecord`: single layout). */
interface FakeUnit {
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>; global: unknown }>
  putRecord(table: string, key: string, value: unknown): Promise<void>
  deleteRecord(table: string, key: string): Promise<void>
  setGlobal(value: unknown): Promise<void>
  close(): Promise<void>
}

/** One opened unit over `medium` (values are opaque JSON at this layer). */
function fakeUnit(medium: FakeMedium): FakeUnit {
  return {
    loadAll: async () => ({ tables: medium.tables, global: medium.global }),
    putRecord: async (table, key, value) => {
      medium.tables[table] = { ...medium.tables[table], [key]: value }
    },
    deleteRecord: async (table, key) => {
      const records = { ...medium.tables[table] }
      delete records[key]
      medium.tables[table] = records
    },
    setGlobal: async (value) => {
      medium.global = value
    },
    close: async () => {},
  }
}

/** Open the production spec + `TaskStore` over a fake storage hub. */
async function openStore(medium: FakeMedium): Promise<TaskStore> {
  const ctx = new Context()
  ctx.provide('storage', {
    backend: {
      get: () => ({
        kv: { open: async () => fakeUnit(medium) },
        close: async () => {},
      }),
    },
  })
  const facility = new DomainFacility(ctx, { backend: 'fake', routes: {} })
  const domain = await facility.open(TASK_STORE_SPEC)
  return new TaskStore(domain)
}

/** One legal record for the paths that need an existing task. */
async function seedCommandTask(store: TaskStore): Promise<string> {
  const created = await store.create({
    name: '发布检查',
    type: 'command',
    scope: 'global',
    command: 'echo ok',
  })
  return created.id
}

describe('task write boundary (bad type/scope never reaches the medium)', () => {
  it('rejects an out-of-set type at create and writes nothing', async () => {
    const medium = fakeMedium()
    const store = await openStore(medium)
    await expect(
      store.create({ name: 'bad', type: 'shell' as never, scope: 'global' }),
    ).rejects.toThrow('task type must be one of llm, command')
    expect(Object.keys(medium.tables.tasks ?? {})).toEqual([])
  })

  it('rejects an out-of-set scope at create and writes nothing', async () => {
    const medium = fakeMedium()
    const store = await openStore(medium)
    await expect(
      store.create({ name: 'bad', type: 'llm', scope: 'everywhere' as never }),
    ).rejects.toThrow('task scope must be one of global, workspace')
    expect(Object.keys(medium.tables.tasks ?? {})).toEqual([])
  })

  it('rejects an out-of-set type in an update patch and keeps the stored record intact', async () => {
    const medium = fakeMedium()
    const store = await openStore(medium)
    const id = await seedCommandTask(store)
    await expect(store.update(id, { type: 5 as never })).rejects.toThrow(
      'task type must be one of llm, command',
    )
    // The record on the medium is still the legal one (the review's probe 2
    // turned a healthy task into an unopenable domain with exactly this call).
    expect(medium.tables.tasks?.[id]).toMatchObject({ type: 'command', scope: 'global' })
  })

  it('rejects an out-of-set scope in an update patch', async () => {
    const medium = fakeMedium()
    const store = await openStore(medium)
    const id = await seedCommandTask(store)
    // A non-null bad value, so the merge (`patch.scope ?? current.scope`) cannot
    // quietly read it as "unchanged" the way JSON `null` is read.
    await expect(store.update(id, { scope: 'everywhere' as never })).rejects.toThrow(
      'task scope must be one of global, workspace',
    )
    expect(medium.tables.tasks?.[id]).toMatchObject({ scope: 'global' })
  })

  it('leaves the medium openable after a legal create (reopen parses cleanly)', async () => {
    const medium = fakeMedium()
    const store = await openStore(medium)
    await seedCommandTask(store)
    const reopened = await openStore(medium)
    expect(reopened.list()).toHaveLength(1)
    expect(reopened.list()[0]).toMatchObject({ type: 'command', scope: 'global' })
  })

  it('still fails OPEN on a record that is already bad on the medium (no stopgap exists)', async () => {
    // `invalidRecords: 'backup-and-skip'` is not declared, there is no
    // per-record layout and the single unit has no backupRecord: the domain
    // layer's documented fallback is to reject. This pins the reason P1 is fixed
    // at the write, not at the read policy.
    expect('invalidRecords' in TASK_STORE_SPEC).toBe(false)
    const medium = fakeMedium()
    medium.tables.tasks = {
      'bad-id': {
        id: 'bad-id',
        name: 'legacy-bad',
        type: 'shell',
        scope: 'global',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }
    const error = await openStore(medium).catch((reason: unknown) => reason)
    expect((error as { code?: string }).code).toBe('invalid-record')
    expect(String((error as Error).message)).toMatch(/does not match its schema/)
  })
})
