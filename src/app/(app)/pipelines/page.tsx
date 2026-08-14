import { redirect } from 'next/navigation'

export const metadata = { title: 'Sales' }

/**
 * The pipeline index folded into the Sales overview; boards keep their
 * `/pipelines/[slug]` addresses so shared board links stay good.
 */
export default function PipelinesPage(): never {
  redirect('/sales')
}
