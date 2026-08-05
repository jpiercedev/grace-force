import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Exchanges the one-time code from a confirmation or recovery email for a
 * session cookie. Supabase redirects here after the user clicks the link.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next')
  // Reject absolute or protocol-relative targets so the callback cannot be
  // turned into an open redirect.
  const next = rawNext?.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=invalid_code`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
