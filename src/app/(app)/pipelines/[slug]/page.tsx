import { redirect } from 'next/navigation'

type RouteParams = Promise<{ slug: string }>

/** Boards moved under Sales; old board links keep working. */
export default async function PipelineBoardRedirect({ params }: { params: RouteParams }) {
  const { slug } = await params
  redirect(`/sales/pipelines/${slug}`)
}
