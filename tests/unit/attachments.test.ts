import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Attachments, verified as far as this environment allows.
 *
 * **What is not covered here, and why.** A real byte-level round trip against
 * Supabase Storage cannot run in this container: the egress gateway answers
 * `403` to `CONNECT phhkhvewcclzjkdbjmqw.supabase.co:443`, so no HTTP request
 * reaches the project, and the Supabase management tooling available here
 * exposes Postgres only — it has no storage transfer at all. The exact manual
 * steps to close that last gap are in `docs/IMPLEMENTATION_STATUS.md`.
 *
 * **What is covered.** Everything either side of the bytes, which is where the
 * defects would actually live: the size and type rules, the boundary exactly
 * at the limit, the metadata row written, the orphan cleanup when the row
 * fails after the object landed, the delete ordering, an honest message when a
 * batch fails halfway, and Row Level Security refusing a write. The storage
 * client is a recording fake, so every call the action makes is asserted
 * rather than assumed.
 */

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const PROFILE = { id: 'user-1', role: 'staff', is_active: true, can_view_giving: true }

vi.mock('@/lib/auth', () => ({
  requireWriteAccess: async () => PROFILE,
  requireAdmin: async () => PROFILE,
  requireProfile: async () => PROFILE,
}))

// --- the recording fake -----------------------------------------------------

interface StorageCall {
  op: 'upload' | 'remove' | 'signedUrl'
  bucket: string
  paths: string[]
  contentType?: string
}

interface TableCall {
  op: 'insert' | 'delete' | 'select'
  table: string
  payload?: Record<string, unknown>
}

const storageCalls: StorageCall[] = []
const tableCalls: TableCall[] = []
/** Every call in the order it happened, so orderings can be asserted. */
const sequence: string[] = []

/** Failures the fake should inject, set per test. */
const fail: {
  upload?: { message: string }
  insert?: { code?: string; message: string }
  remove?: { message: string }
  del?: { code?: string; message: string }
  signedUrl?: { message: string }
} = {}

/** The row `removeAttachment` reads before deleting. */
let existingRow: Record<string, unknown> | null = {
  storage_path: 'contact-1/abc-estate.pdf',
  call_report_id: null,
  proposal_id: null,
}

function makeClient() {
  return {
    storage: {
      from(bucket: string) {
        return {
          async upload(path: string, _file: unknown, options: { contentType?: string }) {
            storageCalls.push({ op: 'upload', bucket, paths: [path], contentType: options?.contentType })
            sequence.push('storage:upload')
            return { error: fail.upload ?? null }
          },
          async remove(paths: string[]) {
            storageCalls.push({ op: 'remove', bucket, paths })
            sequence.push('storage:remove')
            return { error: fail.remove ?? null }
          },
          async createSignedUrl(path: string) {
            storageCalls.push({ op: 'signedUrl', bucket, paths: [path] })
            sequence.push('storage:signedUrl')
            if (fail.signedUrl) return { data: null, error: fail.signedUrl }
            return { data: { signedUrl: `https://example.test/${path}?token=x` }, error: null }
          },
        }
      },
    },
    from(table: string) {
      const builder = {
        async insert(payload: Record<string, unknown>) {
          tableCalls.push({ op: 'insert', table, payload })
          sequence.push('table:insert')
          return { error: fail.insert ?? null }
        },
        select() {
          tableCalls.push({ op: 'select', table })
          sequence.push('table:select')
          return builder
        },
        delete() {
          tableCalls.push({ op: 'delete', table })
          sequence.push('table:delete')
          return builder
        },
        eq() {
          return builder
        },
        async maybeSingle() {
          return { data: existingRow, error: null }
        },
        // `delete().eq()` is awaited directly rather than via maybeSingle.
        then(resolve: (value: { error: unknown }) => unknown) {
          return Promise.resolve({ error: fail.del ?? null }).then(resolve)
        },
      }
      return builder
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => makeClient() }))

const {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  isAllowedFileName,
  rejectionReason,
  storagePathFor,
} = await import('@/lib/attachments')
const { uploadAttachment, removeAttachment } = await import('@/app/(app)/contacts/donor-actions')
const { signedDownloadUrl } = await import('@/lib/queries/attachments')

const CONTACT = '11111111-1111-4111-8111-111111111111'
const ATTACHMENT = '22222222-2222-4222-8222-222222222222'

/** A File of an exact byte length, without allocating a real 20MB buffer. */
function file(name: string, size: number, type = 'application/pdf'): File {
  const blob = new Blob([new Uint8Array(Math.min(size, 1024))], { type })
  const handle = new File([blob], name, { type })
  // `size` is a getter on File; override it so boundary cases stay cheap.
  Object.defineProperty(handle, 'size', { value: size })
  return handle
}

function uploadForm(files: File[], extra: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.set('contact_id', CONTACT)
  for (const [key, value] of Object.entries(extra)) form.set(key, value)
  for (const entry of files) form.append('files', entry)
  return form
}

beforeEach(() => {
  storageCalls.length = 0
  tableCalls.length = 0
  sequence.length = 0
  for (const key of Object.keys(fail)) delete (fail as Record<string, unknown>)[key]
  existingRow = {
    storage_path: 'contact-1/abc-estate.pdf',
    call_report_id: null,
    proposal_id: null,
  }
})

// --- the rules --------------------------------------------------------------

describe('what may be attached', () => {
  it('accepts the kinds of file the requirement names', () => {
    for (const name of [
      'estate-plan.pdf',
      'Proposal.docx',
      'illustration.xlsx',
      'board deck.pptx',
      'scan.jpeg',
      'photo.HEIC',
      'notes.txt',
    ]) {
      expect(isAllowedFileName(name), name).toBe(true)
    }
  })

  it('refuses executables, scripts and envelopes', () => {
    // A zip is an envelope: allowing one allows whatever is inside it. SVG and
    // HTML can carry script.
    for (const name of ['payload.exe', 'run.sh', 'macro.js', 'bundle.zip', 'logo.svg', 'page.html']) {
      expect(isAllowedFileName(name), name).toBe(false)
    }
  })

  it('refuses a file with no extension at all', () => {
    expect(isAllowedFileName('README')).toBe(false)
  })

  it('accepts a file of exactly the limit, and refuses one byte more', () => {
    expect(rejectionReason([{ name: 'a.pdf', size: MAX_FILE_BYTES }])).toBeNull()
    const over = rejectionReason([{ name: 'a.pdf', size: MAX_FILE_BYTES + 1 }])
    expect(over).toMatch(/over the .* limit/)
    expect(over).toContain('a.pdf')
  })

  it('refuses a batch that is legal file-by-file but too large together', () => {
    // This is the case that would otherwise fail at the framework body limit
    // with no usable message.
    const half = Math.ceil(MAX_TOTAL_BYTES / 2)
    const reason = rejectionReason([
      { name: 'a.pdf', size: half },
      { name: 'b.pdf', size: half },
      { name: 'c.pdf', size: half },
    ])
    expect(reason).toMatch(/together/)
  })

  it('accepts a batch that exactly fills the total', () => {
    const half = MAX_TOTAL_BYTES / 2
    expect(
      rejectionReason([
        { name: 'a.pdf', size: half },
        { name: 'b.pdf', size: half },
      ]),
    ).toBeNull()
  })

  it('ignores empty file slots, which browsers submit for untouched inputs', () => {
    expect(rejectionReason([{ name: '', size: 0 }])).toBe('Choose a file to attach.')
    expect(
      rejectionReason([
        { name: '', size: 0 },
        { name: 'real.pdf', size: 10 },
      ]),
    ).toBeNull()
  })

  it('builds a contact-scoped key that leaks no name and cannot collide', () => {
    const path = storagePathFor(CONTACT, 'Ginny Pierce — will (final).pdf', 'rand-1')
    expect(path.startsWith(`${CONTACT}/rand-1-`)).toBe(true)
    expect(path).not.toContain(' ')
    expect(path).not.toContain('—')
    expect(path.endsWith('.pdf')).toBe(true)

    // Same name, different random id — different object.
    expect(storagePathFor(CONTACT, 'proposal.pdf', 'a')).not.toBe(
      storagePathFor(CONTACT, 'proposal.pdf', 'b'),
    )
  })
})

// --- the upload action ------------------------------------------------------

describe('uploadAttachment', () => {
  it('writes the object and then the metadata row', async () => {
    const state = await uploadAttachment({}, uploadForm([file('estate-plan.pdf', 2048)]))
    expect(state.ok).toBe(true)

    const upload = storageCalls.find((call) => call.op === 'upload')
    expect(upload?.bucket).toBe('attachments')
    expect(upload?.paths[0]).toMatch(new RegExp(`^${CONTACT}/`))
    expect(upload?.contentType).toBe('application/pdf')

    const insert = tableCalls.find((call) => call.op === 'insert')
    expect(insert?.table).toBe('attachments')
    expect(insert?.payload).toMatchObject({
      contact_id: CONTACT,
      file_name: 'estate-plan.pdf',
      mime_type: 'application/pdf',
      size_bytes: 2048,
      uploaded_by: PROFILE.id,
      call_report_id: null,
      proposal_id: null,
    })
    // The row points at the object that was actually written.
    expect(insert?.payload?.storage_path).toBe(upload?.paths[0])
  })

  it('anchors a report or proposal file to the contact as well', async () => {
    await uploadAttachment(
      {},
      uploadForm([file('notes.pdf', 512)], { call_report_id: ATTACHMENT }),
    )
    const insert = tableCalls.find((call) => call.op === 'insert')
    expect(insert?.payload).toMatchObject({ contact_id: CONTACT, call_report_id: ATTACHMENT })
  })

  it('refuses an oversized file without touching storage', async () => {
    const state = await uploadAttachment({}, uploadForm([file('huge.pdf', MAX_FILE_BYTES + 1)]))
    expect(state.ok).toBeUndefined()
    expect(state.error).toContain('huge.pdf')
    expect(storageCalls).toHaveLength(0)
    expect(tableCalls).toHaveLength(0)
  })

  it('refuses a disallowed type without touching storage', async () => {
    const state = await uploadAttachment(
      {},
      // A believable attack: an executable renamed with a PDF-ish mime.
      uploadForm([file('invoice.exe', 1024, 'application/pdf')]),
    )
    expect(state.error).toContain('invoice.exe')
    expect(storageCalls).toHaveLength(0)
  })

  it('refuses an over-cap batch without touching storage', async () => {
    const state = await uploadAttachment(
      {},
      uploadForm([file('a.pdf', MAX_TOTAL_BYTES), file('b.pdf', 1024)]),
    )
    expect(state.error).toMatch(/together/)
    expect(storageCalls).toHaveLength(0)
  })

  it('removes the object when the metadata row cannot be written', async () => {
    // The one case where bytes can outlive a failure. Leaving them would grow
    // a bucket of objects nothing points at.
    fail.insert = { code: '23505', message: 'duplicate key' }
    const state = await uploadAttachment({}, uploadForm([file('estate-plan.pdf', 1024)]))

    expect(state.ok).toBeUndefined()
    const upload = storageCalls.find((call) => call.op === 'upload')
    const remove = storageCalls.find((call) => call.op === 'remove')
    expect(remove, 'the orphaned object must be removed').toBeDefined()
    expect(remove?.paths).toEqual(upload?.paths)
    // Upload, then the failed insert, then the cleanup — in that order.
    expect(sequence).toEqual(['storage:upload', 'table:insert', 'storage:remove'])
  })

  it('reports a Row Level Security refusal as a permission problem', async () => {
    fail.insert = { code: '42501', message: 'new row violates row-level security policy' }
    const state = await uploadAttachment({}, uploadForm([file('estate-plan.pdf', 1024)]))
    expect(state.error).toContain('permission')
    // And still cleans up.
    expect(storageCalls.some((call) => call.op === 'remove')).toBe(true)
  })

  it('says which files survived when a batch fails halfway', async () => {
    let uploads = 0
    const original = fail.upload
    Object.defineProperty(fail, 'upload', {
      configurable: true,
      get() {
        uploads += 1
        // First file succeeds, second fails.
        return uploads > 1 ? { message: 'network reset' } : original
      },
    })

    const state = await uploadAttachment(
      {},
      uploadForm([file('first.pdf', 1024), file('second.pdf', 1024)]),
    )
    delete (fail as Record<string, unknown>).upload

    expect(state.error).toContain('second.pdf')
    expect(state.error).toMatch(/earlier file was attached and is safe/)
  })

  it('surfaces a storage failure verbatim rather than swallowing it', async () => {
    fail.upload = { message: 'bucket not found' }
    const state = await uploadAttachment({}, uploadForm([file('estate-plan.pdf', 1024)]))
    expect(state.error).toContain('bucket not found')
    // Nothing was recorded for an object that never landed.
    expect(tableCalls.some((call) => call.op === 'insert')).toBe(false)
  })
})

// --- the delete action ------------------------------------------------------

describe('removeAttachment', () => {
  function removeForm(): FormData {
    const form = new FormData()
    form.set('contact_id', CONTACT)
    form.set('attachment_id', ATTACHMENT)
    return form
  }

  it('deletes the row first and the object second', async () => {
    const state = await removeAttachment({}, removeForm())
    expect(state.ok).toBe(true)

    // The ordering is the point, not just that both happened: a row pointing
    // at deleted bytes is a broken download, whereas an unreferenced object is
    // only tidy-up.
    expect(sequence.indexOf('table:delete')).toBeGreaterThanOrEqual(0)
    expect(sequence.indexOf('table:delete')).toBeLessThan(sequence.indexOf('storage:remove'))

    const remove = storageCalls.find((call) => call.op === 'remove')
    expect(remove?.paths).toEqual(['contact-1/abc-estate.pdf'])
  })

  it('still succeeds when the object is already gone', async () => {
    // Row first, bytes second, is the safe ordering: an unreferenced object is
    // tidy-up, a row pointing at deleted bytes is a broken download.
    fail.remove = { message: 'object not found' }
    const state = await removeAttachment({}, removeForm())
    expect(state.ok).toBe(true)
  })

  it('does not touch storage when the row delete is refused', async () => {
    fail.del = { code: '42501', message: 'row-level security' }
    const state = await removeAttachment({}, removeForm())
    expect(state.error).toContain('permission')
    expect(storageCalls.some((call) => call.op === 'remove')).toBe(false)
  })

  it('handles a row that has already been deleted by someone else', async () => {
    existingRow = null
    const state = await removeAttachment({}, removeForm())
    expect(state.ok).toBe(true)
    expect(storageCalls.some((call) => call.op === 'remove')).toBe(false)
  })
})

// --- downloads --------------------------------------------------------------

describe('signedDownloadUrl', () => {
  it('mints a signed URL for the stored object', async () => {
    const url = await signedDownloadUrl('contact-1/abc-estate.pdf')
    expect(url).toContain('contact-1/abc-estate.pdf')
    expect(storageCalls.find((call) => call.op === 'signedUrl')?.bucket).toBe('attachments')
  })

  it('returns null rather than throwing when storage is unreachable', async () => {
    // One broken file must not take down the whole Files tab; the row renders
    // as "unavailable" instead.
    fail.signedUrl = { message: 'connection refused' }
    await expect(signedDownloadUrl('contact-1/abc-estate.pdf')).resolves.toBeNull()
  })
})

// --- the two ceilings -------------------------------------------------------

describe('request-size configuration', () => {
  /**
   * There are two independent body limits, and the smaller one wins silently.
   *
   * `serverActions.bodySizeLimit` is the obvious one. The second —
   * `experimental.middlewareClientMaxBodySize` — defaults to 10MB and applies
   * to every route that passes through middleware, which here is every
   * authenticated route. With it left at the default, a 19MB upload was
   * truncated mid-stream and surfaced as `Unexpected end of form`: a generic
   * error, with the interface still promising 20MB.
   *
   * This asserts both ceilings clear the total the application accepts, so
   * removing either one fails here rather than in production on the first
   * large scan somebody attaches.
   */
  const config = readFileSync(new URL('../../next.config.ts', import.meta.url), 'utf8')

  function megabytes(key: string): number {
    const match = new RegExp(`${key}:\\s*'(\\d+)mb'`).exec(config)
    expect(match, `${key} should be set in next.config.ts`).not.toBeNull()
    return Number(match![1])
  }

  it('allows a server action body larger than the biggest accepted upload', () => {
    expect(megabytes('bodySizeLimit') * 1024 * 1024).toBeGreaterThan(MAX_TOTAL_BYTES)
  })

  it('raises the middleware body limit above it too', () => {
    // The default is 10MB. Leaving it there truncates any upload over ~10MB.
    expect(megabytes('middlewareClientMaxBodySize') * 1024 * 1024).toBeGreaterThan(MAX_TOTAL_BYTES)
  })

  it('keeps the per-file cap at or below the batch cap', () => {
    // A single file larger than the batch total could never be accepted, which
    // would make the per-file message unreachable and confusing.
    expect(MAX_FILE_BYTES).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })
})
