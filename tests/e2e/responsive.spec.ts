import { expect, test, type Page } from '@playwright/test'

/**
 * Layout integrity at phone width.
 *
 * The rule this enforces: wide content (tables, boards, code) may scroll inside
 * its own container, but the page body must never scroll horizontally. A body
 * that scrolls sideways is the single most common way a desktop-first layout
 * breaks on a phone, and it is invisible from a desktop browser.
 */

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement
    // One pixel of slack absorbs sub-pixel rounding in the layout engine.
    return doc.scrollWidth > doc.clientWidth + 1
  })
}

test.describe('@public responsive layout', () => {
  const routes = ['/login', '/signup', '/check-email', '/setup']

  for (const route of routes) {
    test(`${route} does not scroll horizontally on a phone`, async ({ page }) => {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      expect(await hasHorizontalOverflow(page)).toBe(false)
    })
  }

  test('the login form is usable at phone width', async ({ page }) => {
    await page.goto('/login')

    const email = page.getByLabel('Email address')
    const submit = page.getByRole('button', { name: /sign in/i })

    await expect(email).toBeVisible()
    await expect(submit).toBeVisible()

    // Controls must be wide enough to tap, not squeezed into a corner.
    const box = await submit.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(40)

    await email.fill('person@graceforce.org')
    await expect(email).toHaveValue('person@graceforce.org')
  })

  test('survives a 320px viewport, the narrowest device still in use', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    expect(await hasHorizontalOverflow(page)).toBe(false)
  })
})
