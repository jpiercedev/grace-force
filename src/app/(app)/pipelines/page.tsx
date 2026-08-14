import { redirect } from 'next/navigation'

/** Pipelines live under Sales now; old links and bookmarks follow. */
export default function PipelinesRedirect() {
  redirect('/sales')
}
