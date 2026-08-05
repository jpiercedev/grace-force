/**
 * An in-memory stand-in for the service-role Supabase client.
 *
 * It exists to make one claim testable: running a sync twice must not create a
 * second row. A fake that simply records calls could not prove that, so this
 * one enforces the same unique indexes the migrations declare — including the
 * partial ones on `activities.dedupe_key` and on live engagements — and
 * resolves an upsert against the conflict target the caller declared.
 *
 * It is a test double, not a database. It supports exactly the query surface
 * the Mailchimp sync uses.
 */

export type Row = Record<string, any>

interface UniqueIndex {
  columns: string[]
  /** Partial index predicate, matching `create unique index ... where ...`. */
  where?: (row: Row) => boolean
}

interface TableSpec {
  unique?: UniqueIndex[]
  /** Columns Postgres computes; the fake recomputes them on every write. */
  generated?: Record<string, (row: Row) => unknown>
  defaults?: Row
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

const TABLE_SPECS: Record<string, TableSpec> = {
  profiles: {},
  engagement_types: {},
  contacts: {
    unique: [
      { columns: ['external_source', 'external_id'], where: (row) => row.external_id != null },
    ],
    generated: {
      email_normalized: (row) => normalizeEmail(row.email),
      full_name: (row) => [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
    },
    defaults: {
      deleted_at: null,
      secondary_email: null,
      external_source: null,
      external_id: null,
      lifecycle_stage: 'prospect',
      status: 'active',
    },
  },
  engagements: {
    unique: [
      {
        columns: ['contact_id', 'engagement_type_id'],
        where: (row) => row.status !== 'ended',
      },
    ],
    defaults: { status: 'prospect', ended_on: null },
  },
  activities: {
    unique: [{ columns: ['dedupe_key'], where: (row) => row.dedupe_key != null }],
    defaults: { dedupe_key: null, is_pinned: false },
  },
  mailchimp_audiences: {
    unique: [{ columns: ['mailchimp_list_id'] }],
    defaults: { last_synced_at: null, is_active: true, member_count: 0 },
  },
  mailchimp_members: {
    unique: [
      { columns: ['audience_id', 'mailchimp_member_id'] },
      { columns: ['audience_id', 'email_normalized'] },
    ],
    generated: { email_normalized: (row) => normalizeEmail(row.email_address) },
    defaults: { contact_id: null, match_method: null, matched_at: null, last_changed_at: null },
  },
  mailchimp_campaigns: {
    unique: [{ columns: ['mailchimp_campaign_id'] }],
    defaults: { send_time: null, audience_id: null },
  },
  mailchimp_campaign_activity: {
    unique: [{ columns: ['dedupe_key'] }],
    generated: { email_normalized: (row) => normalizeEmail(row.email_address) },
    defaults: { contact_id: null, member_id: null, url: null, event_count: 1 },
  },
  integration_sync_runs: {
    defaults: { status: 'running', finished_at: null, stats: {}, error: null },
  },
}

export interface UpsertCall {
  table: string
  onConflict: string | null
  rows: number
}

type Filter = (row: Row) => boolean

interface OrderKey {
  column: string
  ascending: boolean
}

const UNIQUE_VIOLATION = {
  code: '23505',
  message: 'duplicate key value violates unique constraint',
  details: '',
  hint: '',
}

export class FakeSupabase {
  private readonly tables = new Map<string, Row[]>()
  private sequence = 0
  private clock = Date.parse('2026-01-01T00:00:00.000Z')

  /** Every upsert performed, with the conflict target it declared. */
  readonly upserts: UpsertCall[] = []

  rows(table: string): Row[] {
    return this.tables.get(table) ?? []
  }

  count(table: string): number {
    return this.rows(table).length
  }

  /** Seeds rows exactly as given, plus generated columns and an id. */
  seed(table: string, rows: Row[]): Row[] {
    const stored = rows.map((row) => this.materialise(table, row))
    this.tables.set(table, [...this.rows(table), ...stored])
    return stored
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table)
  }

  /** A stable, sortable snapshot for comparing one run against the next. */
  snapshot(table: string, columns: string[]): string[] {
    return this.rows(table)
      .map((row) => columns.map((column) => JSON.stringify(row[column] ?? null)).join('|'))
      .sort()
  }

  // --- Internals used by FakeQuery -------------------------------------------

  materialise(table: string, row: Row): Row {
    const spec = TABLE_SPECS[table] ?? {}
    this.sequence += 1
    this.clock += 1000
    const stored: Row = {
      ...spec.defaults,
      id: `${table}-${this.sequence}`,
      created_at: new Date(this.clock).toISOString(),
      ...row,
    }
    for (const [column, compute] of Object.entries(spec.generated ?? {})) {
      stored[column] = compute(stored)
    }
    return stored
  }

  applyGenerated(table: string, row: Row): void {
    for (const [column, compute] of Object.entries(TABLE_SPECS[table]?.generated ?? {})) {
      row[column] = compute(row)
    }
  }

  uniqueIndexes(table: string): UniqueIndex[] {
    return TABLE_SPECS[table]?.unique ?? []
  }

  /** The stored row a candidate would collide with, if any. */
  conflicting(table: string, candidate: Row, exclude?: Row): Row | null {
    for (const index of this.uniqueIndexes(table)) {
      if (index.where && !index.where(candidate)) continue
      const match = this.rows(table).find(
        (row) =>
          row !== exclude &&
          (!index.where || index.where(row)) &&
          index.columns.every((column) => row[column] === candidate[column]),
      )
      if (match) return match
    }
    return null
  }

  matchOnConflict(table: string, candidate: Row, columns: string[]): Row | undefined {
    return this.rows(table).find((row) =>
      columns.every((column) => row[column] === candidate[column]),
    )
  }

  push(table: string, row: Row): void {
    this.tables.set(table, [...this.rows(table), row])
  }
}

type Mode = 'select' | 'insert' | 'upsert' | 'update'

interface Outcome {
  data: unknown
  error: typeof UNIQUE_VIOLATION | { code: string; message: string } | null
  count: number | null
}

export class FakeQuery implements PromiseLike<Outcome> {
  private mode: Mode = 'select'
  private readonly filters: Filter[] = []
  private readonly orderKeys: OrderKey[] = []
  private payload: Row[] = []
  private patch: Row = {}
  private onConflict: string | null = null
  private limitTo: number | null = null
  private singleRow = false
  private allowEmpty = false
  private headOnly = false
  private wantCount = false

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }): this {
    if (options?.head) this.headOnly = true
    if (options?.count) this.wantCount = true
    return this
  }

  insert(rows: Row | Row[]): this {
    this.mode = 'insert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    return this
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string }): this {
    this.mode = 'upsert'
    this.payload = Array.isArray(rows) ? rows : [rows]
    this.onConflict = options?.onConflict ?? null
    return this
  }

  update(patch: Row): this {
    this.mode = 'update'
    this.patch = patch
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value)
    return this
  }

  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value)
    return this
  }

  is(column: string, value: unknown): this {
    this.filters.push((row) => (row[column] ?? null) === value)
    return this
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator !== 'is') throw new Error(`FakeSupabase: unsupported not(${operator})`)
    this.filters.push((row) => (row[column] ?? null) !== value)
    return this
  }

  in(column: string, values: readonly unknown[]): this {
    const set = new Set(values)
    this.filters.push((row) => set.has(row[column]))
    return this
  }

  gte(column: string, value: string): this {
    this.filters.push((row) => typeof row[column] === 'string' && row[column] >= value)
    return this
  }

  lte(column: string, value: string): this {
    this.filters.push((row) => typeof row[column] === 'string' && row[column] <= value)
    return this
  }

  /** Supports the `col.op.value,col.op.value` form PostgREST accepts. */
  or(expression: string): this {
    const terms = expression.split(',').map(parseOrTerm)
    this.filters.push((row) => terms.some((term) => term(row)))
    return this
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderKeys.push({ column, ascending: options?.ascending ?? true })
    return this
  }

  limit(value: number): this {
    this.limitTo = value
    return this
  }

  single(): this {
    this.singleRow = true
    return this
  }

  maybeSingle(): this {
    this.singleRow = true
    this.allowEmpty = true
    return this
  }

  /** Mirrors the runtime no-op that `overrideTypes` is on a real builder. */
  overrideTypes(): this {
    return this
  }

  then<TResult1 = Outcome, TResult2 = never>(
    onfulfilled?: ((value: Outcome) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }

  private run(): Outcome {
    switch (this.mode) {
      case 'insert':
        return this.runInsert()
      case 'upsert':
        return this.runUpsert()
      case 'update':
        return this.runUpdate()
      default:
        return this.runSelect()
    }
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((row) => this.filters.every((filter) => filter(row)))
  }

  private runSelect(): Outcome {
    let rows = this.matching()

    for (const key of [...this.orderKeys].reverse()) {
      rows = [...rows].sort((a, b) => compare(a[key.column], b[key.column]) * (key.ascending ? 1 : -1))
    }

    const total = rows.length
    if (this.limitTo !== null) rows = rows.slice(0, this.limitTo)

    if (this.headOnly) return { data: null, error: null, count: total }
    return this.shape(rows, this.wantCount ? total : null)
  }

  private runInsert(): Outcome {
    const inserted: Row[] = []

    for (const candidate of this.payload) {
      const row = this.db.materialise(this.table, candidate)
      if (this.db.conflicting(this.table, row)) {
        return { data: null, error: { ...UNIQUE_VIOLATION }, count: null }
      }
      this.db.push(this.table, row)
      inserted.push(row)
    }

    return this.shape(inserted, null)
  }

  private runUpsert(): Outcome {
    const conflictColumns = this.onConflict?.split(',').map((column) => column.trim()) ?? []
    this.db.upserts.push({
      table: this.table,
      onConflict: this.onConflict,
      rows: this.payload.length,
    })

    const written: Row[] = []

    for (const candidate of this.payload) {
      const prepared = { ...candidate }
      this.db.applyGenerated(this.table, prepared)

      const existing =
        conflictColumns.length > 0
          ? this.db.matchOnConflict(this.table, prepared, conflictColumns)
          : undefined

      if (existing) {
        // `on conflict do update` touches only the columns in the payload.
        Object.assign(existing, prepared)
        this.db.applyGenerated(this.table, existing)
        if (this.db.conflicting(this.table, existing, existing)) {
          return { data: null, error: { ...UNIQUE_VIOLATION }, count: null }
        }
        written.push(existing)
        continue
      }

      const row = this.db.materialise(this.table, candidate)
      if (this.db.conflicting(this.table, row)) {
        return { data: null, error: { ...UNIQUE_VIOLATION }, count: null }
      }
      this.db.push(this.table, row)
      written.push(row)
    }

    return this.shape(written, null)
  }

  private runUpdate(): Outcome {
    const rows = this.matching()
    for (const row of rows) {
      Object.assign(row, this.patch)
      this.db.applyGenerated(this.table, row)
    }
    return this.shape(rows, null)
  }

  private shape(rows: Row[], count: number | null): Outcome {
    if (!this.singleRow) return { data: rows, error: null, count }
    if (rows.length === 0) {
      return this.allowEmpty
        ? { data: null, error: null, count }
        : { data: null, error: { code: 'PGRST116', message: 'no rows returned' }, count }
    }
    return { data: rows[0], error: null, count }
  }
}

function parseOrTerm(term: string): Filter {
  const [column, operator, ...rest] = term.split('.')
  const value = rest.join('.')
  if (!column || !operator) throw new Error(`FakeSupabase: unparseable or() term "${term}"`)

  if (operator === 'eq') return (row) => row[column] === value
  if (operator === 'ilike') {
    const pattern = new RegExp(
      `^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`,
      'i',
    )
    return (row) => typeof row[column] === 'string' && pattern.test(row[column])
  }
  throw new Error(`FakeSupabase: unsupported or() operator "${operator}"`)
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  return a < b ? -1 : 1
}
