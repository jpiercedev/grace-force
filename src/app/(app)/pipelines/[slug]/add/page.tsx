import { redirect } from 'next/navigation'

type RouteParams = Promise<{ slug: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** The add form moved under Sales; a mid-flow ?contact= selection survives. */
export default async function AddToPipelineRedirect({
  params,
  searchParams,
}: {
  params: RouteParams
  searchParams: SearchParams
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const passthrough = new URLSearchParams()
  const contact = Array.isArray(query.contact) ? query.contact[0] : query.contact
  const q = Array.isArray(query.q) ? query.q[0] : query.q
  if (contact) passthrough.set('contact', contact)
  if (q) passthrough.set('q', q)
  const suffix = passthrough.size > 0 ? `?${passthrough.toString()}` : ''
  redirect(`/sales/pipelines/${slug}/add${suffix}`)
}
