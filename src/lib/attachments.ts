/**
 * The rules an attachment has to satisfy, in one place.
 *
 * Both sides use this module: the browser to refuse a file before spending a
 * minute uploading it, and the server action to decide what is actually
 * allowed. Keeping one implementation is the point — a client-only check is
 * advisory, and a server-only check makes the person wait for the round trip
 * to be told no.
 *
 * Pure data and pure functions. Safe to import from a client component.
 */

/**
 * Per file. Chosen for what this is actually for: scanned estate documents and
 * proposal illustrations. Comfortably above a 40-page colour scan, well below
 * anything that belongs in a document management system instead.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/**
 * Per submission, across every file chosen at once.
 *
 * This is the number that matters for correctness rather than taste. Uploads
 * are posted through a server action, so the whole batch travels in one
 * request body and must fit inside `serverActions.bodySizeLimit` in
 * `next.config.ts` (24mb). Capping the *total* — not just each file — is what
 * guarantees an accepted submission never trips the framework limit, which
 * would fail opaquely instead of with a sentence a person can act on.
 */
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024

/**
 * Extension allowlist and the canonical MIME type stored for each extension.
 *
 * Browsers report MIME types inconsistently — an empty string, or
 * `application/octet-stream`, is common for perfectly ordinary files — so
 * gating on MIME rejects real documents and accepts nothing extra. The
 * extension comes from the filename, which is what gets stored and shown, so
 * it is the honest thing to check. The browser-provided MIME type is not
 * trusted as metadata either: an allowed extension determines the MIME type
 * used for both Storage and the attachment row.
 *
 * Archives are absent on purpose: a zip is an envelope, and allowing one means
 * allowing whatever is inside it. So are `.svg` and `.html`, which can carry
 * script — the bucket is private and downloads are forced rather than
 * rendered, but there is no reason to hold the risk at all.
 */
export const MIME_TYPE_BY_EXTENSION = {
  // Documents
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  pages: 'application/vnd.apple.pages',
  // Spreadsheets
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  numbers: 'application/vnd.apple.numbers',
  // Presentations
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  key: 'application/vnd.apple.keynote',
  // Images and scans
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
} as const

export type AllowedExtension = keyof typeof MIME_TYPE_BY_EXTENSION

export const ALLOWED_EXTENSIONS = Object.keys(MIME_TYPE_BY_EXTENSION) as AllowedExtension[]

/** For the file input's `accept`, so the picker offers the right files first. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')

export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

export function canonicalMimeType(fileName: string): string | null {
  const extension = fileExtension(fileName) as AllowedExtension
  return MIME_TYPE_BY_EXTENSION[extension] ?? null
}

export function isAllowedFileName(fileName: string): boolean {
  return canonicalMimeType(fileName) !== null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export interface AttachmentCandidate {
  name: string
  size: number
}

/**
 * Checks a whole batch and returns the first reason it cannot be accepted, or
 * null. One message at a time: a list of six complaints is harder to act on
 * than the first thing to fix.
 */
export function rejectionReason(files: readonly AttachmentCandidate[]): string | null {
  const present = files.filter((file) => file.size > 0)

  if (present.length === 0) return 'Choose a file to attach.'

  const wrongType = present.find((file) => !isAllowedFileName(file.name))
  if (wrongType) {
    return (
      `“${wrongType.name}” is not a kind of file we can attach. ` +
      'Documents, spreadsheets, presentations, images and PDFs are fine.'
    )
  }

  const tooBig = present.find((file) => file.size > MAX_FILE_BYTES)
  if (tooBig) {
    return (
      `“${tooBig.name}” is ${formatBytes(tooBig.size)}, over the ` +
      `${formatBytes(MAX_FILE_BYTES)} limit. Attach a smaller copy, or link to it in the notes.`
    )
  }

  const total = present.reduce((sum, file) => sum + file.size, 0)
  if (total > MAX_TOTAL_BYTES) {
    return (
      `Those files come to ${formatBytes(total)} together, over the ` +
      `${formatBytes(MAX_TOTAL_BYTES)} limit for one upload. Attach them in smaller batches.`
    )
  }

  return null
}

/**
 * The object key for a file. Contact-scoped so "everything on this donor" is a
 * prefix listing, randomised so the key leaks no name and two files called
 * `proposal.pdf` cannot collide.
 *
 * `randomId` is injected rather than generated here so the function stays pure
 * and testable.
 */
export function storagePathFor(contactId: string, fileName: string, randomId: string): string {
  // Keep the extension readable at the end of the key, and strip everything
  // that could confuse a path.
  const safeName = fileName.replace(/[^\w.\-]+/g, '_').slice(-80)
  return `${contactId}/${randomId}-${safeName}`
}
