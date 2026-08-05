/**
 * Bodies for internal notification email.
 *
 * Dependency-free on purpose. These run inside a route handler, inside a cron
 * job and inside the unit suite, and the values they interpolate include lead
 * messages typed by anonymous visitors — so every interpolation goes through
 * `escapeHtml`, without exception.
 *
 * The HTML is table-based with inline styles and carries no images: mail
 * clients strip `<style>` blocks and block remote images by default, and a
 * staff notification that half-renders is worse than a plain one that always
 * does. Every message ships a plain-text alternative built from the same data.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Single pass so the ampersands introduced by later replacements are not re-escaped. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

export interface EmailBody {
  text: string
  html: string
}

export interface DetailRow {
  label: string
  value: string | null | undefined
}

export interface EmailAction {
  label: string
  url: string
}

export interface EmailContent {
  title: string
  intro?: string
  details?: readonly DetailRow[]
  /** Free text written by someone outside the organisation; rendered as a quote. */
  quote?: { label: string; body: string } | null
  action?: EmailAction | null
  footer?: string
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const INK = '#111827'
const MUTED = '#6b7280'
const BORDER = '#e5e7eb'
const SURFACE = '#f9fafb'
const ACCENT = '#1d4ed8'

export function renderEmail(content: EmailContent): EmailBody {
  return { text: renderText(content), html: renderHtml(content) }
}

/** Drops rows with nothing in them — a column of em-dashes tells the reader nothing. */
function presentDetails(details: readonly DetailRow[] | undefined): { label: string; value: string }[] {
  return (details ?? [])
    .map((row) => ({ label: row.label, value: row.value?.trim() ?? '' }))
    .filter((row) => row.value !== '')
}

function renderText(content: EmailContent): string {
  const blocks: string[] = [content.title]

  if (content.intro) blocks.push(content.intro)

  const details = presentDetails(content.details)
  if (details.length > 0) {
    blocks.push(details.map((row) => `${row.label}: ${row.value}`).join('\n'))
  }

  const quote = content.quote?.body.trim()
  if (content.quote && quote) {
    blocks.push(`${content.quote.label}:\n${quote.split('\n').map((line) => `> ${line}`).join('\n')}`)
  }

  if (content.action) blocks.push(`${content.action.label}: ${content.action.url}`)
  if (content.footer) blocks.push(content.footer)

  return `${blocks.join('\n\n')}\n`
}

function renderHtml(content: EmailContent): string {
  const sections: string[] = [
    `<h1 style="margin:0 0 16px;font-size:18px;line-height:1.4;color:${INK}">${escapeHtml(content.title)}</h1>`,
  ]

  if (content.intro) {
    sections.push(
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${INK}">${escapeHtml(content.intro)}</p>`,
    )
  }

  const details = presentDetails(content.details)
  if (details.length > 0) {
    const rows = details
      .map(
        (row) =>
          `<tr>` +
          `<th align="left" scope="row" style="padding:6px 12px 6px 0;font-size:13px;font-weight:600;color:${MUTED};vertical-align:top;white-space:nowrap">${escapeHtml(row.label)}</th>` +
          `<td style="padding:6px 0;font-size:14px;color:${INK};vertical-align:top">${escapeHtml(row.value)}</td>` +
          `</tr>`,
      )
      .join('')
    sections.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 16px">${rows}</table>`,
    )
  }

  const quote = content.quote?.body.trim()
  if (content.quote && quote) {
    const paragraphs = quote
      .split(/\n{2,}/)
      .map(
        (para, index) =>
          `<p style="margin:${index === 0 ? '0' : '10px'} 0 0;font-size:14px;line-height:1.6;color:${INK};white-space:pre-wrap">${escapeHtml(para)}</p>`,
      )
      .join('')
    sections.push(
      `<div style="margin:0 0 16px;padding:12px 16px;background:${SURFACE};border-left:3px solid ${BORDER};border-radius:4px">` +
        `<p style="margin:0 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:${MUTED}">${escapeHtml(content.quote.label)}</p>` +
        paragraphs +
        `</div>`,
    )
  }

  if (content.action) {
    sections.push(
      `<p style="margin:0 0 16px"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:10px 18px;background:${ACCENT};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px">${escapeHtml(content.action.label)}</a></p>`,
    )
    // Repeated as text because some clients strip the anchor's styling, and a
    // visible URL is the only reliable fallback.
    sections.push(
      `<p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:${MUTED};word-break:break-all">${escapeHtml(content.action.url)}</p>`,
    )
  }

  if (content.footer) {
    sections.push(
      `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid ${BORDER};font-size:12px;line-height:1.6;color:${MUTED}">${escapeHtml(content.footer)}</p>`,
    )
  }

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(content.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${SURFACE}">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:${SURFACE}">` +
    `<tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;border-collapse:collapse;background:#ffffff;border:1px solid ${BORDER};border-radius:8px">` +
    `<tr><td style="padding:24px;font-family:${FONT};color:${INK}">${sections.join('')}</td></tr>` +
    `</table></td></tr></table></body></html>`
  )
}
