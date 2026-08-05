import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom persists the document between tests; without this, a query that should
// match one element finds several and the failure is baffling.
afterEach(() => {
  cleanup()
})
