import { redirect } from 'next/navigation'

/** The app has no marketing surface; land people in the CRM (or at login). */
export default function RootPage() {
  redirect('/dashboard')
}
