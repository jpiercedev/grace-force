import { expect, test } from '@playwright/test'

/**
 * Unauthenticated behaviour, verified in a real browser.
 *
 * These run without a live Supabase project: the middleware rejects a request
 * with no session cookie before it ever calls the auth server, so route
 * protection is genuinely exercised rather than mocked.
 */

const PROTECTED_ROUTES = [
  '/dashboard',
  '/contacts',
  '/follow-ups',
  '/pipelines',
  '/leads',
  '/import',
  '/export',
  '/settings/team',
  '/sales',
]

const UNLISTED_GUIDE = '/guide/grace-lead-manager-4f7c2a9d'

test.describe('@public route protection', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`redirects ${route} to the login page`, async ({ page }) => {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible()
    })
  }

  test('preserves the intended destination so login can return you there', async ({ page }) => {
    await page.goto('/contacts')
    await expect(page).toHaveURL(/next=%2Fcontacts/)
    // The hidden field is what actually carries it through the form post.
    await expect(page.locator('input[name="next"]')).toHaveValue('/contacts')
  })

  test('sends the root path to login without a next parameter', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
  })
})

test.describe('@public login page', () => {
  test('renders an accessible, labelled form', async ({ page }) => {
    await page.goto('/login')

    const email = page.getByLabel('Email address')
    const password = page.getByLabel('Password')

    await expect(email).toBeVisible()
    await expect(password).toBeVisible()
    await expect(email).toHaveAttribute('type', 'email')
    await expect(password).toHaveAttribute('type', 'password')
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('is operable by keyboard alone', async ({ page }) => {
    await page.goto('/login')

    // The email field autofocuses, so typing should land there immediately.
    await page.keyboard.type('person@gracelead.org')
    await expect(page.getByLabel('Email address')).toHaveValue('person@gracelead.org')

    await page.keyboard.press('Tab')
    await page.keyboard.type('a-password')
    await expect(page.getByLabel('Password')).toHaveValue('a-password')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: /sign in/i })).toBeFocused()
  })

  // Accounts are provisioned by an administrator, so sign-in advertises no
  // route to account creation. `/signup` stays reachable directly, which is
  // how the first (administrator) account gets bootstrapped.
  test('offers no route to account creation', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('link', { name: /create/i })).toHaveCount(0)
    await expect(page.locator('a[href="/signup"]')).toHaveCount(0)
  })

  test('still serves /signup directly, for bootstrapping the first account', async ({ page }) => {
    await page.goto('/signup')
    await expect(page.getByLabel('Full name')).toBeVisible()
  })

  test('logs no console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    expect(errors).toEqual([])
  })
})

test.describe('@public unlisted tutorial', () => {
  test('plays the quick-start video without requiring a session', async ({ page }) => {
    await page.goto(UNLISTED_GUIDE)

    await expect(
      page.getByRole('heading', { name: /learn grace lead manager in under two minutes/i }),
    ).toBeVisible()
    await expect(page.getByLabel('Grace Lead Manager quick-start tutorial')).toBeVisible()
    await expect(page.locator('video source')).toHaveAttribute(
      'src',
      `${UNLISTED_GUIDE}/grace-lead-manager-tutorial.mp4`,
    )
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })
})

test.describe('@public security headers', () => {
  test('sends the hardening headers on every response', async ({ page }) => {
    const response = await page.goto('/login')
    const headers = response!.headers()

    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  test('does not advertise the framework', async ({ page }) => {
    const response = await page.goto('/login')
    expect(response!.headers()['x-powered-by']).toBeUndefined()
  })
})
