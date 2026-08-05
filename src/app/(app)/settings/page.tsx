import { redirect } from 'next/navigation'

/** `/settings` has no content of its own; the team roster is where admins start. */
export default function SettingsIndexPage() {
  redirect('/settings/team')
}
