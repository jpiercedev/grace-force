'use client'

import { ArrowDown, ArrowUp } from 'lucide-react'
import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { ManageActionState } from '@/app/(app)/sales/manage/actions'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { Checkbox, Field, Input, Label, Select, Textarea } from '@/components/ui/form'
import type { ManagedStage, PipelineForManage } from '@/lib/queries/pipelines'
import { pluralize } from '@/lib/utils'

type ManageAction = (prev: ManageActionState, formData: FormData) => Promise<ManageActionState>

function SubmitButton({ children, disabled, ...props }: ButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button {...props} type="submit" disabled={pending || disabled}>
      {children}
    </Button>
  )
}

/** Shared status region: errors interrupt, notices confirm, focus lands on it. */
function StatusCallout({ state }: { state: ManageActionState }) {
  const ref = useRef<HTMLDivElement>(null)
  const message = state.error ?? state.notice

  useEffect(() => {
    if (message) ref.current?.focus()
  }, [state, message])

  if (!message) return null
  return (
    <div ref={ref} tabIndex={-1}>
      <Callout tone={state.error ? 'danger' : 'success'} role={state.error ? 'alert' : 'status'}>
        {message}
      </Callout>
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* Create                                                                    */
/* ------------------------------------------------------------------------- */

export function CreatePipelineForm({ action }: { action: ManageAction }) {
  const [state, formAction] = useActionState<ManageActionState, FormData>(action, {})
  const fieldErrors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <StatusCallout state={state} />

      <Field label="Name" required error={fieldErrors.name}>
        {(props) => (
          <Input
            {...props}
            name="name"
            required
            maxLength={80}
            placeholder="e.g. Partnerships"
            invalid={!!fieldErrors.name}
          />
        )}
      </Field>

      <Field
        label="Description"
        hint="Optional — one sentence on what this pipeline is for."
        error={fieldErrors.description}
      >
        {(props) => (
          <Textarea
            {...props}
            name="description"
            rows={2}
            maxLength={300}
            invalid={!!fieldErrors.description}
          />
        )}
      </Field>

      <Checkbox name="tracks_value" label="Track dollar values on this pipeline" />

      <div className="pt-1">
        <SubmitButton>Create pipeline</SubmitButton>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------------- */
/* Settings: rename, describe, archive, delete                               */
/* ------------------------------------------------------------------------- */

export function PipelineSettingsForm({
  pipeline,
  action,
}: {
  pipeline: PipelineForManage
  action: ManageAction
}) {
  const [state, formAction] = useActionState<ManageActionState, FormData>(action, {})
  const fieldErrors = state.fieldErrors ?? {}

  return (
    <div className="space-y-5">
      <StatusCallout state={state} />

      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="id" value={pipeline.id} />
        <input type="hidden" name="intent" value="update" />

        <Field label="Name" required error={fieldErrors.name}>
          {(props) => (
            <Input
              {...props}
              name="name"
              required
              maxLength={80}
              defaultValue={pipeline.name}
              invalid={!!fieldErrors.name}
            />
          )}
        </Field>

        <Field label="Description" hint="Optional." error={fieldErrors.description}>
          {(props) => (
            <Textarea
              {...props}
              name="description"
              rows={2}
              maxLength={300}
              defaultValue={pipeline.description ?? ''}
              invalid={!!fieldErrors.description}
            />
          )}
        </Field>

        <Checkbox
          name="tracks_value"
          label="Track dollar values on this pipeline"
          defaultChecked={pipeline.tracks_value}
        />

        <div className="pt-1">
          <SubmitButton>Save changes</SubmitButton>
        </div>
      </form>

      <ArchiveAndDelete pipeline={pipeline} formAction={formAction} />
    </div>
  )
}

/**
 * Archiving is the safe default and always available; deletion only appears
 * for a pipeline with no opportunities at all, and still asks the person to
 * acknowledge it. The database refuses either way if anything slipped in
 * between render and submit.
 */
function ArchiveAndDelete({
  pipeline,
  formAction,
}: {
  pipeline: PipelineForManage
  formAction: (formData: FormData) => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const confirmId = useId()
  const deletable = pipeline.card_count === 0

  return (
    <div className="space-y-4 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {pipeline.is_active ? 'Archive this pipeline' : 'This pipeline is archived'}
          </p>
          <p className="text-[13px] text-slate-600">
            {pipeline.is_active
              ? 'The board becomes read-only and leaves the Sales overview. Nothing is deleted.'
              : 'Restore it to make the board live again.'}
          </p>
        </div>
        <form action={formAction}>
          <input type="hidden" name="id" value={pipeline.id} />
          <input type="hidden" name="intent" value={pipeline.is_active ? 'archive' : 'restore'} />
          <SubmitButton variant="secondary">
            {pipeline.is_active ? 'Archive pipeline' : 'Restore pipeline'}
          </SubmitButton>
        </form>
      </div>

      {deletable ? (
        <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/50 p-3.5">
          <div>
            <p className="text-sm font-medium text-slate-900">Delete this pipeline</p>
            <p className="text-[13px] text-slate-600">
              It holds no opportunities, so it can be removed permanently — stages included.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={confirmId}
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              className="h-5 w-5 rounded border-slate-400 text-brand-600 focus:ring-brand-500"
            />
            <Label htmlFor={confirmId} className="text-[13px] font-normal text-slate-700">
              I understand “{pipeline.name}” will be permanently deleted.
            </Label>
          </div>
          <form action={formAction}>
            <input type="hidden" name="id" value={pipeline.id} />
            <input type="hidden" name="intent" value="delete" />
            <SubmitButton variant="danger" disabled={!confirmed}>
              Delete pipeline
            </SubmitButton>
          </form>
        </div>
      ) : (
        <p className="text-[13px] text-slate-500">
          This pipeline holds {pluralize(pipeline.card_count, 'opportunity', 'opportunities')}
          {' '}(open or closed), so it cannot be deleted — archive it instead.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* Stages                                                                    */
/* ------------------------------------------------------------------------- */

export function StageEditor({
  pipeline,
  addAction,
  updateAction,
}: {
  pipeline: PipelineForManage
  addAction: ManageAction
  updateAction: ManageAction
}) {
  const [addState, addFormAction] = useActionState<ManageActionState, FormData>(addAction, {})
  const [rowState, rowFormAction] = useActionState<ManageActionState, FormData>(updateAction, {})
  const addErrors = addState.fieldErrors ?? {}
  const nameId = useId()
  const outcomeId = useId()

  return (
    <div className="space-y-5">
      <StatusCallout state={rowState} />

      {pipeline.stages.length === 0 ? (
        <p className="text-sm leading-relaxed text-slate-600">
          No stages yet. A pipeline needs at least one before it can hold opportunities.
        </p>
      ) : (
        <ol className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-card">
          {pipeline.stages.map((stage, index) => (
            <StageRow
              key={stage.id}
              stage={stage}
              first={index === 0}
              last={index === pipeline.stages.length - 1}
              formAction={rowFormAction}
            />
          ))}
        </ol>
      )}

      {pipeline.archived_stages.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">Archived stages</p>
          <ul className="divide-y divide-slate-200/70 rounded-lg border border-slate-200 bg-slate-50/60">
            {pipeline.archived_stages.map((stage) => (
              <li key={stage.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1 text-sm text-slate-600">{stage.name}</span>
                <span className="text-xs text-slate-500">
                  {pluralize(stage.card_count, 'opportunity', 'opportunities')}
                </span>
                <div className="flex gap-2">
                  <form action={rowFormAction}>
                    <input type="hidden" name="id" value={stage.id} />
                    <input type="hidden" name="intent" value="restore" />
                    <SubmitButton variant="secondary" size="sm">
                      Restore<span className="sr-only">: {stage.name}</span>
                    </SubmitButton>
                  </form>
                  {stage.card_count === 0 ? (
                    <form action={rowFormAction}>
                      <input type="hidden" name="id" value={stage.id} />
                      <input type="hidden" name="intent" value="delete" />
                      <SubmitButton variant="ghost" size="sm" className="text-red-700">
                        Delete<span className="sr-only">: {stage.name}</span>
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Add a stage */}
      <form
        action={addFormAction}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-card"
        noValidate
      >
        <input type="hidden" name="pipeline_id" value={pipeline.id} />
        <StatusCallout state={addState} />
        <p className="text-sm font-medium text-slate-900">Add a stage</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-48 space-y-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              name="name"
              maxLength={60}
              placeholder="e.g. Qualified"
              invalid={!!addErrors.name}
            />
          </div>
          <div className="w-44 space-y-1.5">
            <Label htmlFor={outcomeId}>Kind</Label>
            <Select id={outcomeId} name="outcome" defaultValue="none">
              <option value="none">In progress</option>
              <option value="won">Won — a success ending</option>
              <option value="lost">Lost — a closed ending</option>
            </Select>
          </div>
          <SubmitButton variant="secondary">Add stage</SubmitButton>
        </div>
        {addErrors.name ? <p className="text-sm text-red-700">{addErrors.name}</p> : null}
      </form>
    </div>
  )
}

/**
 * One stage: rename in place, reorder with explicit buttons (keyboard-first,
 * like the board's stage move), archive when its open work is gone.
 */
function StageRow({
  stage,
  first,
  last,
  formAction,
}: {
  stage: ManagedStage
  first: boolean
  last: boolean
  formAction: (formData: FormData) => void
}) {
  const inputId = useId()

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-2.5">
      <div className="flex shrink-0 flex-col gap-0.5">
        <form action={formAction}>
          <input type="hidden" name="id" value={stage.id} />
          <input type="hidden" name="intent" value="move_up" />
          <SubmitButton
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-slate-500"
            disabled={first}
            aria-label={`Move ${stage.name} earlier`}
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </SubmitButton>
        </form>
        <form action={formAction}>
          <input type="hidden" name="id" value={stage.id} />
          <input type="hidden" name="intent" value="move_down" />
          <SubmitButton
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-slate-500"
            disabled={last}
            aria-label={`Move ${stage.name} later`}
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </SubmitButton>
        </form>
      </div>

      <form action={formAction} className="flex min-w-0 flex-1 basis-56 items-center gap-2">
        <input type="hidden" name="id" value={stage.id} />
        <input type="hidden" name="intent" value="rename" />
        <label htmlFor={inputId} className="sr-only">
          Rename stage {stage.name}
        </label>
        <Input id={inputId} name="name" defaultValue={stage.name} maxLength={60} className="flex-1" />
        <SubmitButton variant="secondary" size="sm">
          Rename<span className="sr-only">: {stage.name}</span>
        </SubmitButton>
      </form>

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs text-slate-500">
          {stage.is_won ? 'Won stage · ' : stage.is_lost ? 'Lost stage · ' : ''}
          {pluralize(stage.open_count, 'open opportunity', 'open opportunities')}
        </span>
        <form action={formAction}>
          <input type="hidden" name="id" value={stage.id} />
          <input type="hidden" name="intent" value="archive" />
          <SubmitButton
            variant="ghost"
            size="sm"
            className="text-slate-500 hover:text-slate-800"
            title={
              stage.open_count > 0
                ? 'Move its open opportunities to another stage first.'
                : undefined
            }
          >
            Archive<span className="sr-only">: {stage.name}</span>
          </SubmitButton>
        </form>
      </div>
    </li>
  )
}
