import { IntakeForm } from '@/app/intake/intake-form'

/**
 * The framing around the form, shared by `/intake` and `/intake/[formKey]`.
 * The form key only labels where an enquiry came from, so every variant reads
 * the same to the visitor. This is what a congregant sees, so the voice is
 * the interface voice and the reading sizes are generous.
 */
export function IntakePanel({ formKey }: { formKey: string }) {
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-bold leading-tight text-slate-900">
          Get in touch
        </h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-600">
          Tell us how we can help, or how you would like to be involved. Someone from the team
          will reply.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-card sm:p-8">
        <IntakeForm formKey={formKey} />
      </div>
    </div>
  )
}
