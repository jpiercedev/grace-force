import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

/**
 * Two suites live here:
 *
 *  - `@public`  — unauthenticated behaviour (route protection, login page,
 *                 public lead intake form). Runs against a build with
 *                 placeholder Supabase env vars; no live backend required.
 *  - `@authed`  — full CRM workflows. Requires a real Supabase project plus
 *                 E2E_EMAIL / E2E_PASSWORD; skipped with a clear message
 *                 otherwise (see tests/e2e/authenticated.spec.ts).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /responsive\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        /**
         * Builds as well as serves. `NEXT_PUBLIC_*` values are inlined into
         * the middleware bundle at build time, so serving a build produced
         * with different values would silently ignore the env below.
         */
        command: `npm run build && npm run start -- --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        /**
         * Credentials that *look* configured but point nowhere. The @public
         * suite never reaches the auth server — middleware rejects a request
         * with no session cookie first — so route protection is exercised for
         * real without a live project.
         *
         * These must not match `env.ts`'s placeholder heuristic (`your-`,
         * `placeholder`, …), or the app would correctly divert to /setup.
         */
        env: {
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://e2e-fixture.supabase.co',
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'e2e-fixture-anon-key',
          SUPABASE_SERVICE_ROLE_KEY:
            process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'e2e-fixture-service-role-key',
        },
      },
})
