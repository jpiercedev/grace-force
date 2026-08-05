import { notFound } from 'next/navigation'
import { IntakePanel } from '@/app/intake/intake-panel'
import { isValidFormKey } from '@/lib/leads/form'

/**
 * A campaign- or page-specific variant of the enquiry form. The key is carried
 * through to `leads.form_key`, and from there onto the contact as
 * `source_detail`, so the team can see which invitation someone answered.
 *
 * Keys are not registered anywhere: any slug works, which is what makes a new
 * campaign a link rather than a deployment. Anything that is not a slug is a
 * 404, so a malformed key cannot end up labelling the queue.
 */
export default async function IntakeFormKeyPage({
  params,
}: {
  params: Promise<{ formKey: string }>
}) {
  const { formKey } = await params
  const normalized = decodeURIComponent(formKey).trim().toLowerCase()
  if (!isValidFormKey(normalized)) notFound()

  return <IntakePanel formKey={normalized} />
}
