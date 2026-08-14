'use client'

import { ArrowDown, ArrowUp } from 'lucide-react'
import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { PipelineEditorState } from '@/app/(app)/sales/pipelines/actions'
import { Button, type ButtonProps } from '@/components/ui/button'
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  badgeTone,
  type BadgeTone,
} from '@/components/ui/display'
import { Dialog, useDialog } from '@/components/ui/dialog'
import { Disclosure } from '@/components/ui/disclosure'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import type { ManagedPipeline, ManagedStage } from '@/lib/queries/pipelines'
import { cn, pluralize } from '@/lib/utils'
import {
  CARD_STATUS_TONES,
  STAGE_COLORS,
  STAGE_OUTCOMES,
  STAGE_OUTCOME_CHOICES,
  stageOutcomeLabel,
} from '@/lib/validation/pipeline'

export interface PipelineEditorProps {
  pipeline: ManagedPipeline
  canEdit: boolean
  action: (prev: PipelineEditorState, formData: FormData) => Promise<PipelineEditorState>
}

/**
 * Stage identity dots, mirroring the Badge dot colors. Written out literally
 * because Tailwind's compiler only keeps classes it can see.
 */
const STAGE_DOTS: Record<BadgeTone, string> = {
  slate: 'bg-slate-400',
  zinc: 'bg-slate-400',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  red: 'bg-red-600',
  brand: 'bg-brand-500',
}

function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button {...props} type="submit" disabled={props.disabled || pending}>
      {children}
    </Button>
  )
}

/** Capitalises a color token for its select option — 'slate' reads as 'Slate'. */
function colorLabel(color: string): string {
  return color.charAt(0).toUpperCase() + color.slice(1)
}

/**
 * The whole pipeline edit screen shares one action state, exactly like the
 * board: whichever of its many small forms submits, the outcome lands in one
 * focused Callout instead of vanishing with a row that re-rendered.
 */
export function PipelineEditor({ pipeline, canEdit, action }: PipelineEditorProps) {
  const [state, formAction] = useActionState<PipelineEditorState, FormData>(action, {})
  const statusRef = useRef<HTMLDivElement>(null)
  const message = state.error ?? state.notice
  const fieldErrors = state.fieldErrors ?? {}

  useEffect(() => {
    if (message) statusRef.current?.focus()
  }, [state, message])

  const liveStages = pipeline.stages.filter((stage) => stage.archived_at === null)
  const archivedStages = pipeline.stages.filter((stage) => stage.archived_at !== null)

  return (
    <div className="space-y-5">
      {message ? (
        <div ref={statusRef} tabIndex={-1}>
          <Callout tone={state.error ? 'danger' : 'success'} role={state.error ? 'alert' : 'status'}>
            {message}
          </Callout>
        </div>
      ) : null}

      <Card>
        <CardHeader title="Details" />
        <CardBody className="py-5">
          {canEdit ? (
            <form action={formAction} className="space-y-4" noValidate>
              <input type="hidden" name="id" value={pipeline.id} />
              <input type="hidden" name="intent" value="rename" />

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

              <Field label="Description" error={fieldErrors.description}>
                {(props) => (
                  <Textarea
                    {...props}
                    name="description"
                    rows={2}
                    maxLength={500}
                    defaultValue={pipeline.description ?? ''}
                    invalid={!!fieldErrors.description}
                  />
                )}
              </Field>

              <Checkbox
                name="tracks_value"
                label="Track a money value on its opportunities"
                defaultChecked={pipeline.tracks_value}
              />

              <SubmitButton variant="secondary">Save</SubmitButton>
            </form>
          ) : (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium text-slate-500">Name</dt>
                <dd className="font-medium text-slate-900">{pipeline.name}</dd>
              </div>
              {pipeline.description ? (
                <div>
                  <dt className="text-xs font-medium text-slate-500">Description</dt>
                  <dd className="text-slate-700">{pipeline.description}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-medium text-slate-500">Value tracking</dt>
                <dd className="text-slate-700">
                  {pipeline.tracks_value
                    ? 'Opportunities carry a money value.'
                    : 'Opportunities carry no money value.'}
                </dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Stages"
          description="The order here is the board's column order, left to right."
        />
        <CardBody>
          {liveStages.length === 0 ? (
            <p className="py-2 text-sm text-slate-500">
              No live stages — the board cannot hold opportunities until one exists.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200/70">
              {liveStages.map((stage) => (
                <StageRow key={stage.id} stage={stage} canEdit={canEdit} formAction={formAction} />
              ))}
            </ul>
          )}

          {archivedStages.length > 0 ? (
            canEdit ? (
              <Disclosure
                label="Archived stages"
                summary={pluralize(archivedStages.length, 'stage')}
                className="mt-4"
              >
                <ul className="divide-y divide-slate-200/70">
                  {archivedStages.map((stage) => (
                    <ArchivedStageRow key={stage.id} stage={stage} formAction={formAction} />
                  ))}
                </ul>
              </Disclosure>
            ) : (
              <div className="mt-4 border-t border-slate-200 pt-3">
                <h3 className="text-xs font-medium text-slate-500">Archived stages</h3>
                <ul className="mt-1.5 space-y-1 text-sm text-slate-600">
                  {archivedStages.map((stage) => (
                    <li key={stage.id}>{stage.name}</li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </CardBody>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader title="Add a stage" />
          <CardBody className="py-5">
            <form action={formAction} className="space-y-4" noValidate>
              <input type="hidden" name="pipeline_id" value={pipeline.id} />
              <input type="hidden" name="intent" value="add_stage" />

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Name" required error={fieldErrors.name}>
                  {(props) => (
                    <Input
                      {...props}
                      name="name"
                      required
                      maxLength={60}
                      placeholder="e.g. Proposal sent"
                      invalid={!!fieldErrors.name}
                    />
                  )}
                </Field>

                <Field label="Color" error={fieldErrors.color}>
                  {(props) => (
                    <Select {...props} name="color" defaultValue="slate">
                      {STAGE_COLORS.map((color) => (
                        <option key={color} value={color}>
                          {colorLabel(color)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Outcome" error={fieldErrors.outcome}>
                  {(props) => (
                    <Select {...props} name="outcome" defaultValue="none">
                      {STAGE_OUTCOMES.map((outcome) => (
                        <option key={outcome} value={outcome}>
                          {STAGE_OUTCOME_CHOICES[outcome]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>

              <SubmitButton variant="secondary">Add stage</SubmitButton>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {canEdit ? <DangerZone pipeline={pipeline} formAction={formAction} /> : null}
    </div>
  )
}

/**
 * One live stage: identity on the left, its controls on the right — every
 * mutating control a dedicated form carrying hidden id + intent, because a
 * submit button's own name/value is dropped by real browsers.
 */
function StageRow({
  stage,
  canEdit,
  formAction,
}: {
  stage: ManagedStage
  canEdit: boolean
  formAction: (formData: FormData) => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const editPanelId = useId()

  useEffect(() => {
    if (!editing && !confirmingDelete) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setEditing(false)
        setConfirmingDelete(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editing, confirmingDelete])

  const outcome = stageOutcomeLabel(stage)
  const canArchive = stage.open_count === 0
  const canDelete = stage.total_count === 0

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          aria-hidden="true"
          className={cn('h-2 w-2 shrink-0 rounded-full', STAGE_DOTS[badgeTone(stage.color)])}
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-slate-900">{stage.name}</span>
          {outcome ? (
            <Badge tone={CARD_STATUS_TONES[stage.is_won ? 'won' : 'lost']}>{outcome}</Badge>
          ) : null}
          <span className="text-xs tabular-nums text-slate-500">
            {stage.open_count} open · {stage.total_count} total
          </span>
        </span>

        {canEdit ? (
          <span className="flex flex-wrap items-center gap-1">
            <form action={formAction} className="flex">
              <input type="hidden" name="id" value={stage.id} />
              <input type="hidden" name="intent" value="stage_up" />
              <SubmitButton
                variant="ghost"
                size="sm"
                className="px-1.5"
                aria-label={`Move the “${stage.name}” stage earlier`}
              >
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </SubmitButton>
            </form>
            <form action={formAction} className="flex">
              <input type="hidden" name="id" value={stage.id} />
              <input type="hidden" name="intent" value="stage_down" />
              <SubmitButton
                variant="ghost"
                size="sm"
                className="px-1.5"
                aria-label={`Move the “${stage.name}” stage later`}
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </SubmitButton>
            </form>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={editing}
              aria-controls={editing ? editPanelId : undefined}
              aria-label={`Edit the “${stage.name}” stage`}
              onClick={() => setEditing((open) => !open)}
            >
              Edit
            </Button>

            <form action={formAction} className="flex">
              <input type="hidden" name="id" value={stage.id} />
              <input type="hidden" name="intent" value="archive_stage" />
              {/* Disabled mirrors the DB guard so the refusal is explained
                  before the round trip; the server still refuses regardless. */}
              <SubmitButton
                variant="ghost"
                size="sm"
                disabled={!canArchive}
                aria-label={`Archive the “${stage.name}” stage`}
                title={
                  canArchive
                    ? undefined
                    : 'A stage still holding open opportunities cannot be archived. Move them first.'
                }
              >
                Archive
              </SubmitButton>
            </form>

            {canDelete && !confirmingDelete ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                aria-label={`Delete the “${stage.name}” stage`}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </Button>
            ) : null}
            {canDelete && confirmingDelete ? (
              <span className="flex items-center gap-1">
                <form action={formAction} className="flex">
                  <input type="hidden" name="id" value={stage.id} />
                  <input type="hidden" name="intent" value="delete_stage" />
                  <SubmitButton
                    variant="danger"
                    size="sm"
                    aria-label={`Confirm deleting the “${stage.name}” stage`}
                  >
                    Confirm delete
                  </SubmitButton>
                </form>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </Button>
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {canEdit && editing ? (
        <form
          action={formAction}
          id={editPanelId}
          className="mt-3 space-y-4 rounded-md bg-slate-100/80 p-3"
          noValidate
        >
          <input type="hidden" name="id" value={stage.id} />
          <input type="hidden" name="intent" value="edit_stage" />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" required>
              {(props) => (
                <Input {...props} name="name" required maxLength={60} defaultValue={stage.name} />
              )}
            </Field>

            <Field label="Color">
              {(props) => (
                <Select {...props} name="color" defaultValue={badgeTone(stage.color)}>
                  {STAGE_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {colorLabel(color)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Outcome">
              {(props) => (
                <Select
                  {...props}
                  name="outcome"
                  defaultValue={stage.is_won ? 'won' : stage.is_lost ? 'lost' : 'none'}
                >
                  {STAGE_OUTCOMES.map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {STAGE_OUTCOME_CHOICES[outcome]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="secondary" size="sm" aria-label={`Save the “${stage.name}” stage`}>
              Save
            </SubmitButton>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  )
}

function ArchivedStageRow({
  stage,
  formAction,
}: {
  stage: ManagedStage
  formAction: (formData: FormData) => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (!confirmingDelete) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setConfirmingDelete(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [confirmingDelete])

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0">
      <span className="min-w-0 flex-1 text-sm text-slate-600">
        {stage.name}
        {stage.total_count > 0 ? (
          <span className="ml-2 text-xs tabular-nums text-slate-500">
            still holds {pluralize(stage.total_count, 'opportunity', 'opportunities')}
          </span>
        ) : null}
      </span>

      <span className="flex items-center gap-1">
        <form action={formAction} className="flex">
          <input type="hidden" name="id" value={stage.id} />
          <input type="hidden" name="intent" value="restore_stage" />
          <SubmitButton
            variant="secondary"
            size="sm"
            aria-label={`Restore the “${stage.name}” stage`}
          >
            Restore
          </SubmitButton>
        </form>

        {stage.total_count === 0 && !confirmingDelete ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            aria-label={`Delete the “${stage.name}” stage`}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </Button>
        ) : null}
        {stage.total_count === 0 && confirmingDelete ? (
          <span className="flex items-center gap-1">
            <form action={formAction} className="flex">
              <input type="hidden" name="id" value={stage.id} />
              <input type="hidden" name="intent" value="delete_stage" />
              <SubmitButton
                variant="danger"
                size="sm"
                aria-label={`Confirm deleting the “${stage.name}” stage`}
              >
                Confirm delete
              </SubmitButton>
            </form>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </span>
        ) : null}
      </span>
    </li>
  )
}

function DangerZone({
  pipeline,
  formAction,
}: {
  pipeline: ManagedPipeline
  formAction: (formData: FormData) => void
}) {
  const deleteDialog = useDialog()
  const canDelete = pipeline.total_count === 0

  return (
    <Card className="border-red-200">
      <CardHeader title="Danger zone" />
      <CardBody className="divide-y divide-slate-200/70">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <p className="min-w-0 flex-1 text-sm text-slate-600">
            {pipeline.is_active
              ? 'Archiving keeps every opportunity but takes the board out of daily use.'
              : 'This pipeline is archived — its board is read-only until restored.'}
          </p>
          <form action={formAction} className="flex shrink-0">
            <input type="hidden" name="id" value={pipeline.id} />
            <input type="hidden" name="intent" value={pipeline.is_active ? 'archive' : 'restore'} />
            <SubmitButton variant="secondary">
              {pipeline.is_active ? 'Archive pipeline' : 'Restore pipeline'}
            </SubmitButton>
          </form>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1 text-sm text-slate-600">
            <p>Deleting removes the pipeline and its stages entirely. Only an empty one can go.</p>
            {!canDelete ? (
              <p className="mt-1 font-medium text-slate-700">
                Move or archive its {pluralize(pipeline.total_count, 'opportunity', 'opportunities')}{' '}
                first.
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="danger"
            ref={deleteDialog.triggerRef}
            disabled={!canDelete}
            title={canDelete ? undefined : 'This pipeline still holds opportunities.'}
            onClick={deleteDialog.openDialog}
            className="shrink-0"
          >
            Delete pipeline
          </Button>
        </div>
      </CardBody>

      <Dialog
        controller={deleteDialog}
        title="Delete this empty pipeline?"
        description="This cannot be undone. The board address stops working immediately."
        formAction={formAction}
        footer={
          <>
            <SubmitButton variant="danger">Delete it</SubmitButton>
            <Button type="button" variant="ghost" onClick={deleteDialog.close}>
              Cancel
            </Button>
          </>
        }
      >
        <input type="hidden" name="id" value={pipeline.id} />
        <input type="hidden" name="intent" value="delete" />
        <p className="text-sm text-slate-600">
          “{pipeline.name}” holds no opportunities, so nothing else is lost.
        </p>
      </Dialog>
    </Card>
  )
}
