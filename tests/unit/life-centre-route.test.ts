import { NextRequest } from 'next/server'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ rpc: vi.fn(), insert: vi.fn(), single: vi.fn(), notify: vi.fn(), existing: vi.fn() }))
vi.mock('@/lib/env', () => ({ hasServiceRoleKey: () => true, serviceRoleKey: () => 'test-salt', siteUrl: () => 'https://leads.grace.tv', leadIntakeConfig: () => ({ secret: null, allowedOrigins: [], rateLimit: 10 }) }))
vi.mock('@/lib/notifications/events', () => ({ notifyLeadCreated: f.notify }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: f.rpc, from: () => ({ insert: f.insert, select: () => ({ eq: () => ({ maybeSingle: f.existing }) }) }) }) }))
import { POST } from '@/app/api/leads/route'
const lead = { first_name: 'Test', last_name: 'Visitor', email: 'test@example.com', phone: '555-0100', form_key: 'cathedral-life-centre', message: 'Information request' }
const webhook = { triggerType: 'form_submission', payload: { siteId: '663792c3759f35a04eea8483', name: 'Life Centre Inquiry', id: 'submission-123', data: { Name: 'Test Visitor', Email: 'test@example.com', Phone: '555-0100' } } }
const request = (body: unknown, query = '', headers: Record<string,string> = {}) => new NextRequest('https://leads.grace.tv/api/leads' + query, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
beforeEach(() => {
 vi.clearAllMocks()
 vi.stubEnv('LIFE_CENTRE_PROXY_SECRET', 'proxy-secret')
 vi.stubEnv('LIFE_CENTRE_WEBFLOW_TOKEN', 'hook-secret')
 f.rpc.mockResolvedValue({ data: true, error: null })
 f.single.mockResolvedValue({ data: { id: 'lead-123' }, error: null })
 f.insert.mockReturnValue({ select: () => ({ single: f.single }) })
 f.existing.mockResolvedValue({ data: { id: 'lead-123' } })
})
afterEach(() => vi.unstubAllEnvs())
it('accepts the authorized webhook, stores its submission ID and leaves native Webflow email intact', async () => {
 const r = await POST(request(webhook, '?source=webflow-life-centre&token=hook-secret'))
 expect(r.status).toBe(200)
 expect(await r.json()).toEqual({ ok: true, id: 'lead-123' })
 expect(f.insert.mock.calls[0][0]).toMatchObject({ first_name: 'Test', status: 'new', form_key: 'cathedral-life-centre', dedupe_key: expect.stringMatching(/^webflow:/) })
 expect(f.notify).not.toHaveBeenCalled()
})
it('rejects unauthenticated webhooks and forged proxy addresses before database writes', async () => {
 expect((await POST(request(webhook, '?source=webflow-life-centre'))).status).toBe(401)
 expect((await POST(request(lead, '', { 'x-life-centre-key': 'wrong', 'x-life-centre-client-ip': '203.0.113.8' }))).status).toBe(401)
 expect(f.rpc).not.toHaveBeenCalled()
 expect(f.insert).not.toHaveBeenCalled()
})
it('gives authenticated visitors independent rate buckets and rejects other form keys', async () => {
 for (const ip of ['203.0.113.7', '203.0.113.8']) expect((await POST(request(lead, '', { 'x-life-centre-key': 'proxy-secret', 'x-life-centre-client-ip': ip }))).status).toBe(200)
 expect(f.rpc.mock.calls[0][1].p_bucket).not.toBe(f.rpc.mock.calls[1][1].p_bucket)
 expect(f.notify).not.toHaveBeenCalled()
 expect((await POST(request({ ...lead, form_key: 'other' }, '', { 'x-life-centre-key': 'proxy-secret', 'x-life-centre-client-ip': '203.0.113.7' }))).status).toBe(403)
})
it('returns the existing lead on webhook retry rather than generating a duplicate', async () => {
 f.single.mockResolvedValue({ data: null, error: { code: '23505' } })
 expect(await (await POST(request(webhook, '?source=webflow-life-centre&token=hook-secret'))).json()).toEqual({ ok: true, id: 'lead-123' })
})
it('reports persistence failures and retains ordinary intake notifications', async () => {
 f.single.mockResolvedValueOnce({ data: null, error: { code: 'db_failure' } })
 expect((await POST(request(webhook, '?source=webflow-life-centre&token=hook-secret'))).status).toBe(503)
 expect((await POST(request(lead))).status).toBe(200)
 expect(f.notify).toHaveBeenCalledTimes(1)
})
