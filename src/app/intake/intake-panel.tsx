import { IntakeForm } from '@/app/intake/intake-form'

/**
 * The framing around the form, shared by `/intake` and `/intake/[formKey]`.
 * The form key only labels where an enquiry came from, so every variant reads
 * the same to the visitor.
 */
export function IntakePanel({ formKey }: { formKey: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Get in touch
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Tell us how we can help, or how you would like to be involved. Someone from the team
          will reply.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <IntakeForm formKey={formKey} />
      </div>
    </div>
  )
}
