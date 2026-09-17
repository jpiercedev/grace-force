import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LIFE_CENTRE_SITE_ID, lifeCentreProxyIp, mapWebflowInquiry, verifyWebflow } from '@/lib/leads/life-centre'

const event = { triggerType: 'form_submission', payload: { siteId: LIFE_CENTRE_SITE_ID, name: 'Life Centre Inquiry', id: 'submission-123', data: { Name: 'Test Visitor', Email: 'test@example.com', Phone: '555-0100', 'Best Time To Contact': 'Evening', 'Tour Requested': true } } }

describe('Life Centre authenticated intake', () => {
 it('maps Webflow fields and preserves a stable submission identity across retries', () => {
  const mapped = mapWebflowInquiry(event)!
  expect(mapped.lead).toMatchObject({ first_name: 'Test', last_name: 'Visitor', email: 'test@example.com', phone: '555-0100', form_key: 'cathedral-life-centre' })
  expect(mapped.lead.message).toContain('Best Time To Contact: Evening')
  expect(mapped.lead.message).toContain('Would like to take a tour: Yes')
  expect(mapWebflowInquiry(event)?.dedupeKey).toBe(mapped.dedupeKey)
  expect(mapWebflowInquiry({ ...event, payload: { ...event.payload, id: 'submission-124' } })?.dedupeKey).not.toBe(mapped.dedupeKey)
 })
 it('ignores unrelated sites, forms, and malformed envelopes', () => {
  for (const payload of [null, [], {}, { ...event.payload, siteId: 'other' }, { ...event.payload, name: 'RSVP' }, { ...event.payload, id: '' }]) expect(mapWebflowInquiry({ ...event, payload })).toBeNull()
 })
 it('accepts signed requests and rejects tampering, expired or future timestamps and missing credentials', () => {
  const now = Date.now(), body = JSON.stringify(event), timestamp = String(now)
  const headers = new Headers({ 'x-webflow-timestamp': timestamp, 'x-webflow-signature': createHmac('sha256', 'secret').update(`${timestamp}:${body}`).digest('hex') })
  expect(verifyWebflow(body, headers, 'secret', now)).toBe(true)
  expect(verifyWebflow(body + ' ', headers, 'secret', now)).toBe(false)
  expect(verifyWebflow(body, headers, 'wrong', now)).toBe(false)
  expect(verifyWebflow(body, headers, undefined, now)).toBe(false)
  expect(verifyWebflow(body, headers, 'secret', now + 300001)).toBe(false)
  expect(verifyWebflow(body, headers, 'secret', now - 300001)).toBe(false)
  headers.set('x-webflow-signature', 'garbage')
  expect(verifyWebflow(body, headers, 'secret', now)).toBe(false)
 })
 it('trusts a visitor IP only with the dedicated server credential', () => {
  const headers = new Headers({ 'x-life-centre-key': 'secret', 'x-life-centre-client-ip': '203.0.113.7', 'x-forwarded-for': 'spoofed' })
  expect(lifeCentreProxyIp(headers, 'secret')).toBe('203.0.113.7')
  expect(lifeCentreProxyIp(headers, undefined)).toBeNull()
  expect(lifeCentreProxyIp(headers, 'wrong!')).toBeNull()
  headers.set('x-life-centre-client-ip', 'spoofed')
  expect(lifeCentreProxyIp(headers, 'secret')).toBeNull()
 })
})
