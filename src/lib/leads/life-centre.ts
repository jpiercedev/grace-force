import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

export const LIFE_CENTRE_SITE_ID = '663792c3759f35a04eea8483'
export const LIFE_CENTRE_FORM = 'Life Centre Inquiry'

export function verifyWebflow(body: string, headers: Headers, secret: string | undefined, now = Date.now()): boolean {
  const timestamp = headers.get('x-webflow-timestamp') ?? ''
  const signature = headers.get('x-webflow-signature') ?? ''
  if (!secret || !/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false
  if (Math.abs(now - Number(timestamp)) > 300_000) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}:${body}`).digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function mapWebflowInquiry(event: Record<string, unknown>) {
  const payload = record(event.payload)
  if (event.triggerType !== 'form_submission' || payload?.siteId !== LIFE_CENTRE_SITE_ID || payload.name !== LIFE_CENTRE_FORM) return null
  const fields = record(payload.data)
  if (!fields || typeof payload.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(payload.id)) return null
  const text = (key: string) => typeof fields[key] === 'string' ? fields[key].trim() : ''
  const name = text('Name')
  const [first, ...last] = name.split(/\s+/)
  const time = text('Best Time To Contact') || text('Best-Time-To-Contact')
  const tour = fields['Tour Requested'] ?? fields['Tour-Requested']
  const wantsTour = tour === true || tour === 'true' || tour === 'on' || tour === 'Yes'
  return {
    dedupeKey: `webflow:${createHash('sha256').update(`${LIFE_CENTRE_SITE_ID}:${payload.id}`).digest('hex')}`,
    lead: {
      first_name: (first ?? '').slice(0, 80), last_name: last.join(' ').slice(0, 80),
      email: text('Email'), phone: text('Phone'), form_key: 'cathedral-life-centre',
      page_url: 'https://www.cathedrallifecentre.com/',
      message: [
        'Information request for Cathedral Life Centre', `Name: ${name}`,
        `Best Time To Contact: ${time || 'Not specified'}`,
        `Would like to take a tour: ${wantsTour ? 'Yes' : 'No'}`,
      ].join('\n'),
    },
  }
}

/** Only an authenticated Life Centre server may supply a visitor address. */
export function lifeCentreProxyIp(headers: Headers, secret: string | undefined): string | null {
  const provided = headers.get('x-life-centre-key')
  if (!secret || !provided || Buffer.byteLength(provided) !== Buffer.byteLength(secret)) return null
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) return null
  const ip = headers.get('x-life-centre-client-ip') ?? ''
  return isIP(ip) ? ip : null
}
