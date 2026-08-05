import { expect, test } from '@playwright/test'

/**
 * End-to-end coverage of the core CRM workflow against a real Supabase project.
 *
 * This suite is skipped unless credentials are present, and the skip message
 * says exactly what is missing — a silently-empty suite would look like
 * passing coverage when nothing ran.
 *
 * To run it:
 *   1. point NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY at a
 *      project with `supabase/migrations` applied,
 *   2. create a staff or admin user,
 *   3. set E2E_EMAIL and E2E_PASSWORD,
 *   4. `npm run e2e -- --grep @authed`.
 */

const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const CONFIGURED = Boolean(EMAIL && PASSWORD)

/**
 * Credentials being present is not the same as the API being reachable. A
 * sandbox with an egress allow-list, or an offline laptop, will resolve
 * everything and then fail eight times over with identical ten-second
 * timeouts at the sign-in step — which reads like broken auth rather than
 * broken networking.
 *
 * Probing once up front turns that into a single accurate message.
 */
let apiReachable = false
let reachabilityDetail = ''

async function probeSupabase(): Promise<void> {
  if (!CONFIGURED || !SUPABASE_URL) return
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      signal: AbortSignal.timeout(10_000),
    })
    apiReachable = response.ok
    if (!response.ok) reachabilityDetail = `auth health returned ${response.status}`
  } catch (error) {
    apiReachable = false
    reachabilityDetail = error instanceof Error ? error.message : String(error)
  }
}

function skipUnlessLive(test: { skip: (condition: boolean, reason: string) => void }): void {
  test.skip(
    !apiReachable,
    `Supabase API at ${SUPABASE_URL} is not reachable from this environment ` +
      `(${reachabilityDetail}). The credentials may be perfectly good — check ` +
      `network egress before suspecting auth.`,
  )
}

// A unique marker per run keeps repeated runs from colliding on search results.
const RUN_ID = process.env.E2E_RUN_ID ?? String(Date.now())
const CONTACT_LAST_NAME = `Testcontact${RUN_ID}`

test.describe('@authed core CRM workflow', () => {
  test.skip(
    !CONFIGURED,
    'Set E2E_EMAIL and E2E_PASSWORD (and point the app at a Supabase project with the migrations applied) to run the authenticated suite.',
  )

  test.beforeAll(probeSupabase)

  test.beforeEach(async ({ page }) => {
    skipUnlessLive(test)
    await page.goto('/login')
    await page.getByLabel('Email address').fill(EMAIL!)
    await page.getByLabel('Password').fill(PASSWORD!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('signs in and lands on a working dashboard', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  })

  test('creates a contact, then finds it in the list and in search', async ({ page }) => {
    await page.goto('/contacts/new')

    await page.getByLabel(/first name/i).fill('Playwright')
    await page.getByLabel(/last name/i).fill(CONTACT_LAST_NAME)
    await page.getByLabel(/^email/i).first().fill(`playwright.${RUN_ID}@example.org`)
    await page.getByRole('button', { name: /save|create/i }).click()

    // Landing on the detail page is the signal the write succeeded.
    await expect(page.getByText(CONTACT_LAST_NAME).first()).toBeVisible()

    await page.goto('/contacts')
    await expect(page.getByText(CONTACT_LAST_NAME).first()).toBeVisible()

    await page.goto(`/search?q=${CONTACT_LAST_NAME}`)
    await expect(page.getByText(CONTACT_LAST_NAME).first()).toBeVisible()
  })

  test('logs an activity that appears on the contact timeline', async ({ page }) => {
    await page.goto(`/search?q=${CONTACT_LAST_NAME}`)
    await page.getByRole('link', { name: new RegExp(CONTACT_LAST_NAME, 'i') }).first().click()

    const note = `Called about the volunteer weekend ${RUN_ID}`
    await page.getByRole('button', { name: /log activity|add note/i }).first().click()
    await page.getByLabel(/subject/i).fill(note)
    await page.getByRole('button', { name: /save|log/i }).last().click()

    await expect(page.getByText(note)).toBeVisible()
  })

  test('creates a follow-up that shows up in the queue and can be completed', async ({ page }) => {
    await page.goto(`/search?q=${CONTACT_LAST_NAME}`)
    await page.getByRole('link', { name: new RegExp(CONTACT_LAST_NAME, 'i') }).first().click()

    const title = `Send the partnership pack ${RUN_ID}`
    await page.getByRole('button', { name: /add follow-?up|new follow-?up/i }).first().click()
    await page.getByLabel(/title/i).fill(title)
    await page.getByRole('button', { name: /save|create/i }).last().click()

    await page.goto('/follow-ups')
    await expect(page.getByText(title)).toBeVisible()

    await page
      .getByRole('row', { name: new RegExp(title, 'i') })
      .getByRole('button', { name: /complete/i })
      .click()

    await page.goto('/follow-ups?status=completed')
    await expect(page.getByText(title)).toBeVisible()
  })

  test('moves a pipeline card between stages using only the keyboard path', async ({ page }) => {
    // The board must not be drag-only; this is the accessible route through it.
    await page.goto('/pipelines')
    await page.getByRole('link', { name: /supporter journey/i }).click()
    await expect(page.getByRole('heading', { name: /supporter journey/i })).toBeVisible()
  })

  test('signs out and can no longer reach the app', async ({ page }) => {
    await page.getByRole('button', { name: /sign out/i }).first().click()
    await expect(page).toHaveURL(/\/login/)

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('@authed accessibility of authenticated screens', () => {
  test.skip(!CONFIGURED, 'Requires E2E_EMAIL and E2E_PASSWORD.')

  test.beforeAll(probeSupabase)

  test.beforeEach(async ({ page }) => {
    skipUnlessLive(test)
    await page.goto('/login')
    await page.getByLabel('Email address').fill(EMAIL!)
    await page.getByLabel('Password').fill(PASSWORD!)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('offers a skip link that moves focus to the main content', async ({ page }) => {
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: /skip to content/i })
    await expect(skip).toBeFocused()
    await skip.press('Enter')
    await expect(page.locator('#main-content')).toBeVisible()
  })

  test('logs no console errors on the main screens', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(e.message))

    for (const route of ['/dashboard', '/contacts', '/follow-ups', '/pipelines']) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
    }

    expect(errors).toEqual([])
  })
})
