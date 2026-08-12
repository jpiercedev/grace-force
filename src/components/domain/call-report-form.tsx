'use client'

import { useActionState, useState } from 'react'
import { FormError, SubmitButton } from '@/components/domain/contact-form-controls'
import { MEETING_KINDS, MEETING_KIND_LABELS } from '@/components/domain/development-badges'
import { PersonPicker } from '@/components/domain/person-picker'
import { Button, LinkButton } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { TeamMember } from '@/lib/queries/contacts'
import type { ContactActionState } from '@/lib/validation/contact'
import type { CallReportRow, ProposalStatus } from '@/types/database'

/**
 * The call report.
 *
 * "The form should feel like writing a structured meeting summary, not filling
 * out a tax return." That is the whole design brief for this screen, and it
 * produces three rules:
 *
 * 1. **Five sections in the order a person recalls a meeting** — where and
 *    who, what was said, what they care about, what was agreed, what happens
 *    next. Not an alphabetical list of columns.
 * 2. **Nothing is required except the date.** A rough report filed today beats
 *    a perfect one that never gets written.
 * 3. **Prose fields are big.** A four-line box says "one line will do"; a
 *    ten-line box says "tell the story".
 *
 * Draft and File are two separate forms sharing the fields via `form=`,
 * because a submit button's `name`/`value` does not survive a real-browser
 * server-action POST — a fault this codebase has already been bitten by. Two
 * actions, no `intent` field, nothing to lose in transit.
 */
export function CallReportForm({
  report,
  contactId,
  contactName,
  jointContactName,
  team,
  proposals,
  currentUserId,
  today,
  draftAction,
  fileAction,
  cancelHref,
}: {
  report?: CallReportRow
  contactId: string
  contactName: string
  /** Already-linked second donor, if any. */
  jointContactName?: string | null
  team: TeamMember[]
  proposals: ReadonlyArray<{ id: string; title: string; status: ProposalStatus }>
  currentUserId: string
  today: string
  draftAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  fileAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  cancelHref: string
}) {
  const [draftState, draftFormAction] = useActionState<ContactActionState, FormData>(
    draftAction,
    {},
  )
  const [fileState, fileFormAction] = useActionState<ContactActionState, FormData>(fileAction, {})
  // Whichever action last reported something is the one to show.
  const state = fileState.error || fileState.fieldErrors ? fileState : draftState
  const errors = state.fieldErrors ?? {}

  const colleagues = team.filter((member) => member.is_active && member.role !== 'viewer')
  const selectedStaff = new Set(report?.staff_attendee_ids ?? [])
  const [changeJoint, setChangeJoint] = useState(false)

  return (
    <>
      {/* One set of fields, two submit paths. The fields live in the `file`
          form; the draft button reaches them with `form=`, so both carry the
          identical payload. */}
      <form id="call-report-file" action={fileFormAction} className="space-y-6" noValidate>
        <input type="hidden" name="contact_id" value={contactId} />
        {report ? <input type="hidden" name="report_id" value={report.id} /> : null}

        <FormError state={state} />

        <section className="space-y-5 rounded-xl bg-white p-5 shadow-card sm:p-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900">
            The meeting
          </h2>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="When did you meet?" error={errors.met_on} required>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  name="met_on"
                  defaultValue={report?.met_on ?? today}
                  invalid={!!errors.met_on}
                />
              )}
            </Field>

            <Field label="Time" hint="Optional." error={errors.met_at_time}>
              {(props) => (
                <Input
                  {...props}
                  type="time"
                  name="met_at_time"
                  defaultValue={report?.met_at_time?.slice(0, 5) ?? ''}
                  invalid={!!errors.met_at_time}
                />
              )}
            </Field>

            <Field label="How did you meet?" error={errors.meeting_kind}>
              {(props) => (
                <Select
                  {...props}
                  name="meeting_kind"
                  defaultValue={report?.meeting_kind ?? 'in_person'}
                >
                  {MEETING_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {MEETING_KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Where?" error={errors.location}>
              {(props) => (
                <Input
                  {...props}
                  name="location"
                  defaultValue={report?.location ?? ''}
                  maxLength={200}
                  placeholder="Their home"
                  invalid={!!errors.location}
                />
              )}
            </Field>
          </div>

          {colleagues.length > 1 ? (
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">
                Which colleagues were with you?
              </legend>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {colleagues
                  .filter((member) => member.id !== currentUserId)
                  .map((member) => (
                    <label key={member.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="staff_attendee_ids"
                        value={member.id}
                        defaultChecked={selectedStaff.has(member.id)}
                        className="h-5 w-5 rounded border-slate-400 text-brand-600 focus:ring-brand-500"
                      />
                      {member.name}
                    </label>
                  ))}
              </div>
            </fieldset>
          ) : null}

          {/* A spouse who is themselves on the record is not an "external"
              attendee — they are the other half of the conversation, and the
              report belongs on their timeline too. */}
          {changeJoint ? (
            <PersonPicker
              name="joint_contact_id"
              label="Was anyone else we know there?"
              excludeId={contactId}
              hint="Their spouse, for instance. The report appears on their record too."
              error={errors.joint_contact_id}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-slate-600">
                Also with: <span className="font-medium text-slate-900">{jointContactName ?? 'nobody else on our records'}</span>
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setChangeJoint(true)}>
                {jointContactName ? 'Change' : 'Add someone'}
              </Button>
              {report?.joint_contact_id ? (
                <input type="hidden" name="joint_contact_id" value={report.joint_contact_id} />
              ) : null}
            </div>
          )}

          <Field
            label="Anyone from outside?"
            hint="People who are not on our records — an adviser, an attorney."
            error={errors.external_attendees}
          >
            {(props) => (
              <Input
                {...props}
                name="external_attendees"
                defaultValue={report?.external_attendees ?? ''}
                maxLength={500}
                placeholder="Ginny Pierce; Susan Taylor (their attorney)"
              />
            )}
          </Field>

          {proposals.length > 0 ? (
            <Field label="Was this about a proposal?" error={errors.proposal_id}>
              {(props) => (
                <Select {...props} name="proposal_id" defaultValue={report?.proposal_id ?? ''}>
                  <option value="">Not about a proposal</option>
                  {proposals.map((proposal) => (
                    <option key={proposal.id} value={proposal.id}>
                      {proposal.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </section>

        <section className="space-y-5 rounded-xl bg-white p-5 shadow-card sm:p-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900">
            The conversation
          </h2>

          <Field
            label="How did it go?"
            hint={`The short version — what you would tell a colleague about meeting ${contactName}.`}
            error={errors.summary}
          >
            {(props) => (
              <Textarea
                {...props}
                name="summary"
                rows={6}
                maxLength={8000}
                defaultValue={report?.summary ?? ''}
                invalid={!!errors.summary}
              />
            )}
          </Field>

          <Field
            label="What did you talk about?"
            hint="The points worth remembering, one per line."
            error={errors.discussion_points}
          >
            {(props) => (
              <Textarea
                {...props}
                name="discussion_points"
                rows={6}
                maxLength={8000}
                defaultValue={report?.discussion_points ?? ''}
              />
            )}
          </Field>
        </section>

        <section className="space-y-5 rounded-xl bg-white p-5 shadow-card sm:p-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900">
            What matters to them
          </h2>

          <Field
            label="What are they interested in?"
            hint="Anything they lit up about."
            error={errors.interests_expressed}
          >
            {(props) => (
              <Textarea
                {...props}
                name="interests_expressed"
                rows={4}
                maxLength={4000}
                defaultValue={report?.interests_expressed ?? ''}
              />
            )}
          </Field>

          <Field
            label="Anything worrying them?"
            hint="Concerns are as useful as enthusiasm, and easier to forget."
            error={errors.concerns}
          >
            {(props) => (
              <Textarea
                {...props}
                name="concerns"
                rows={4}
                maxLength={4000}
                defaultValue={report?.concerns ?? ''}
              />
            )}
          </Field>
        </section>

        <section className="space-y-5 rounded-xl bg-white p-5 shadow-card sm:p-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900">
            What happens next
          </h2>

          <Field
            label="What did they commit to?"
            hint="Anything they said they would do."
            error={errors.commitments}
          >
            {(props) => (
              <Textarea
                {...props}
                name="commitments"
                rows={4}
                maxLength={4000}
                defaultValue={report?.commitments ?? ''}
              />
            )}
          </Field>

          <Field label="What do we need to do?" error={errors.next_steps}>
            {(props) => (
              <Textarea
                {...props}
                name="next_steps"
                rows={4}
                maxLength={4000}
                defaultValue={report?.next_steps ?? ''}
                placeholder="Send the trust illustration"
              />
            )}
          </Field>

          <Field
            label="By when?"
            hint={
              report?.follow_up_id
                ? 'A follow-up already exists for this report.'
                : 'Setting a date adds a follow-up to your queue.'
            }
            error={errors.follow_up_on}
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                name="follow_up_on"
                defaultValue={report?.follow_up_on ?? ''}
                invalid={!!errors.follow_up_on}
                className="sm:max-w-xs"
              />
            )}
          </Field>
        </section>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton size="lg" pendingLabel="Filing…">
              {report?.status === 'filed' ? 'Save report' : 'File report'}
            </SubmitButton>
            {report?.status !== 'filed' ? (
              // A per-button bound action, not a hidden `intent` field: a
              // submit button's name/value does not survive a real-browser
              // server-action POST, and `formAction` binds the target action
              // to the button itself rather than shipping it in the payload.
              <Button type="submit" formAction={draftFormAction} variant="secondary" size="lg">
                Save as draft
              </Button>
            ) : null}
            <LinkButton href={cancelHref} variant="ghost" size="lg">
              Cancel
            </LinkButton>
          </div>
          {report?.status !== 'filed' ? (
            <p className="text-sm text-slate-500">
              A draft is visible only to you and stays off the timeline until you file it.
            </p>
          ) : null}
        </div>
      </form>
    </>
  )
}
