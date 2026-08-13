'use client'

import { useActionState, useState } from 'react'
import {
  FormError,
  SubmitButton,
  ownerOptions,
} from '@/components/domain/contact-form-controls'
import {
  PROPOSAL_FINANCIAL_FIELDS,
  PROPOSAL_KINDS,
  PROPOSAL_KIND_LABELS,
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_HINTS,
  PROPOSAL_STATUS_LABELS,
} from '@/components/domain/development-badges'
import { PersonPicker } from '@/components/domain/person-picker'
import { Button, LinkButton } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { TeamMember } from '@/lib/queries/contacts'
import type { ContactActionState } from '@/lib/validation/contact'
import type { ProposalKind, ProposalRow, ProposalStatus } from '@/types/database'

/**
 * Creating and editing a proposal.
 *
 * The brief's instruction was to keep the workflow approachable despite the
 * sophistication underneath: "Do not expose concepts like fair market value,
 * charitable amount, deduction and expected benefit unless the user is working
 * with those details."
 *
 * So the visible form is six fields — what, for whom, what type, what stage,
 * how much, by when. The planned-giving figures sit behind one disclosure,
 * and *which* of them appear depends on the type: an outright gift has no
 * estimated deduction, so it is never asked for one.
 */
export function ProposalForm({
  proposal,
  contactId,
  contactName,
  jointContactName,
  team,
  defaultOwnerId,
  today,
  action,
  submitLabel,
  cancelHref,
}: {
  proposal?: ProposalRow
  contactId: string
  contactName: string
  jointContactName?: string | null
  team: TeamMember[]
  defaultOwnerId: string
  today: string
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  submitLabel: string
  cancelHref: string
}) {
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  const [kind, setKind] = useState<ProposalKind>(proposal?.kind ?? 'outright_gift')
  const [status, setStatus] = useState<ProposalStatus>(proposal?.status ?? 'exploring')
  const [changeJoint, setChangeJoint] = useState(false)
  const errors = state.fieldErrors ?? {}

  const owners = ownerOptions(team, proposal?.owner_id ?? defaultOwnerId)
  const financialFields = PROPOSAL_FINANCIAL_FIELDS[kind]

  function amountDefault(cents: number | null | undefined): string {
    return cents != null ? (cents / 100).toString() : ''
  }

  const financialSummary = financialFields.length
    ? 'Fair market value, estimated deduction, expected benefit'
    : 'Notes about the gift'

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {proposal ? <input type="hidden" name="proposal_id" value={proposal.id} /> : null}
      <input type="hidden" name="contact_id" value={contactId} />

      <FormError state={state} />

      <div className="space-y-5 rounded-lg bg-white p-5 shadow-card sm:p-6">
        <Field
          label="What is this proposal?"
          hint="A short name you would recognise in a list."
          error={errors.title}
          required
        >
          {(props) => (
            <Input
              {...props}
              name="title"
              defaultValue={proposal?.title ?? ''}
              maxLength={160}
              placeholder="Charitable remainder trust — the farm"
              invalid={!!errors.title}
              autoFocus={!proposal}
            />
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Type" error={errors.kind}>
            {(props) => (
              <Select
                {...props}
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as ProposalKind)}
              >
                {PROPOSAL_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {PROPOSAL_KIND_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Where has it got to?" hint={PROPOSAL_STATUS_HINTS[status]} error={errors.status}>
            {(props) => (
              <Select
                {...props}
                name="status"
                value={status}
                onChange={(event) => setStatus(event.target.value as ProposalStatus)}
              >
                {PROPOSAL_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {PROPOSAL_STATUS_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Gift amount"
            hint="The figure you would quote. Leave blank until it is known."
            error={errors.charitable_amount_cents}
          >
            {(props) => (
              <Input
                {...props}
                name="charitable_amount_cents"
                inputMode="decimal"
                defaultValue={amountDefault(proposal?.charitable_amount_cents)}
                placeholder="250,000"
                invalid={!!errors.charitable_amount_cents}
              />
            )}
          </Field>

          <Field label="Expected by" error={errors.expected_close_on}>
            {(props) => (
              <Input
                {...props}
                type="date"
                name="expected_close_on"
                defaultValue={proposal?.expected_close_on ?? ''}
                invalid={!!errors.expected_close_on}
              />
            )}
          </Field>

          <Field label="What is it for?" hint="The work the gift is intended to support." error={errors.purpose}>
            {(props) => (
              <Input
                {...props}
                name="purpose"
                defaultValue={proposal?.purpose ?? ''}
                maxLength={200}
                placeholder="Life Centre"
                invalid={!!errors.purpose}
              />
            )}
          </Field>

          <Field label="Who is leading it?" error={errors.owner_id}>
            {(props) => (
              <Select
                {...props}
                name="owner_id"
                defaultValue={proposal?.owner_id ?? defaultOwnerId}
              >
                <option value="">Unassigned</option>
                {owners.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <p className="text-sm text-slate-600">
          For <span className="font-medium text-slate-900">{contactName}</span>
          {jointContactName ? (
            <>
              {' '}
              and <span className="font-medium text-slate-900">{jointContactName}</span>
            </>
          ) : null}
          .
        </p>
      </div>

      <Disclosure
        label="Financial details"
        summary={financialSummary}
        defaultOpen={
          // Already filled in? Then someone is working with them and hiding
          // them would look like data loss.
          !!(
            proposal?.fair_market_value_cents ??
            proposal?.estimated_deduction_cents ??
            proposal?.expected_benefit_cents
          )
        }
      >
        <div className="space-y-5">
          {financialFields.length === 0 ? (
            <p className="text-sm leading-relaxed text-slate-600">
              An outright gift needs no illustration — the gift amount above is the whole picture.
              Anything else worth recording can go in the notes.
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-3">
              {financialFields.includes('fair_market_value') ? (
                <Field
                  label="Fair market value"
                  hint="What the asset is worth."
                  error={errors.fair_market_value_cents}
                >
                  {(props) => (
                    <Input
                      {...props}
                      name="fair_market_value_cents"
                      inputMode="decimal"
                      defaultValue={amountDefault(proposal?.fair_market_value_cents)}
                      invalid={!!errors.fair_market_value_cents}
                    />
                  )}
                </Field>
              ) : null}

              {financialFields.includes('estimated_deduction') ? (
                <Field
                  label="Estimated deduction"
                  hint="Their adviser's figure, not ours."
                  error={errors.estimated_deduction_cents}
                >
                  {(props) => (
                    <Input
                      {...props}
                      name="estimated_deduction_cents"
                      inputMode="decimal"
                      defaultValue={amountDefault(proposal?.estimated_deduction_cents)}
                      invalid={!!errors.estimated_deduction_cents}
                    />
                  )}
                </Field>
              ) : null}

              {financialFields.includes('expected_benefit') ? (
                <Field
                  label="Expected benefit to us"
                  hint="What we would eventually receive."
                  error={errors.expected_benefit_cents}
                >
                  {(props) => (
                    <Input
                      {...props}
                      name="expected_benefit_cents"
                      inputMode="decimal"
                      defaultValue={amountDefault(proposal?.expected_benefit_cents)}
                      invalid={!!errors.expected_benefit_cents}
                    />
                  )}
                </Field>
              ) : null}
            </div>
          )}

          <Field label="Opened on" error={errors.opened_on}>
            {(props) => (
              <Input
                {...props}
                type="date"
                name="opened_on"
                defaultValue={proposal?.opened_on ?? today}
                invalid={!!errors.opened_on}
              />
            )}
          </Field>

          <Field label="Notes" error={errors.notes}>
            {(props) => (
              <Textarea {...props} name="notes" rows={5} maxLength={4000} defaultValue={proposal?.notes ?? ''} />
            )}
          </Field>

          {/* A second donor is a real case (a couple giving jointly) and a rare
              edit, so it lives here rather than in the six visible fields. */}
          {changeJoint ? (
            <PersonPicker
              name="joint_contact_id"
              label="Second donor"
              excludeId={contactId}
              hint="For a couple giving jointly."
              error={errors.joint_contact_id}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-slate-600">
                Second donor: {jointContactName ?? 'none'}
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setChangeJoint(true)}>
                {jointContactName ? 'Change' : 'Add one'}
              </Button>
              {proposal?.joint_contact_id ? (
                <input type="hidden" name="joint_contact_id" value={proposal.joint_contact_id} />
              ) : null}
            </div>
          )}
        </div>
      </Disclosure>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg">{submitLabel}</SubmitButton>
        <LinkButton href={cancelHref} variant="ghost" size="lg">
          Cancel
        </LinkButton>
      </div>
    </form>
  )
}
