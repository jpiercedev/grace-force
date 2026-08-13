'use client'

import {
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Presentation,
  type LucideIcon,
} from 'lucide-react'
import { useActionState, useRef, useState } from 'react'
import { FormError, SubmitButton } from '@/components/domain/contact-form-controls'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/display'
import { SectionHeading } from '@/components/ui/tabs'
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_BYTES,
  formatBytes,
  rejectionReason,
} from '@/lib/attachments'
import { cn, formatDate } from '@/lib/utils'
import type { ContactActionState } from '@/lib/validation/contact'
import type { AttachmentRow } from '@/types/database'

/**
 * Files, kept to what a person needs and no more.
 *
 * The brief was precise about the tension here: attachments must be obvious
 * and easy to manage "without turning the report screen into a document
 * management system". So there are no folders, no tags, no versions, no
 * preview pane. There is a drop area, a list of names with dates, and a way to
 * download or remove one.
 *
 * The icon comes from the file type because a column of identical paperclips
 * tells you nothing, and a scanned will should look different from a
 * spreadsheet at a glance.
 */

function iconFor(mime: string | null, fileName: string): LucideIcon {
  const type = mime ?? ''
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (type.startsWith('image/')) return FileImage
  if (type === 'application/pdf' || extension === 'pdf') return FileText
  if (type.includes('spreadsheet') || ['xlsx', 'xls', 'csv'].includes(extension)) {
    return FileSpreadsheet
  }
  if (type.includes('presentation') || ['pptx', 'ppt', 'key'].includes(extension)) {
    return Presentation
  }
  if (type.startsWith('text/') || ['doc', 'docx', 'rtf', 'txt'].includes(extension)) return FileText
  return FileIcon
}

export type AttachmentWithUrl = AttachmentRow & { url: string | null }

export function AttachmentsPanel({
  contactId,
  callReportId,
  proposalId,
  attachments,
  canEdit,
  currentUserId,
  isAdmin,
  uploadAction,
  removeAction,
  title = 'Files',
  description = 'Proposals, estate papers, scans and anything else worth keeping with this person.',
}: {
  contactId: string
  callReportId?: string
  proposalId?: string
  attachments: AttachmentWithUrl[]
  canEdit: boolean
  currentUserId: string
  isAdmin: boolean
  uploadAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  removeAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  title?: string
  description?: string
}) {
  const [uploadState, uploadFormAction] = useActionState<ContactActionState, FormData>(
    uploadAction,
    {},
  )
  const [removeState, removeFormAction] = useActionState<ContactActionState, FormData>(
    removeAction,
    {},
  )
  const [chosen, setChosen] = useState<string[]>([])
  const [localError, setLocalError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * The same rules the server enforces, run before anything is sent. A 40MB
   * scan should be refused in the moment it is chosen, not after a minute of
   * uploading — and a batch that would exceed the request-body ceiling has to
   * be caught here, because past that point the failure has no usable message.
   */
  function adopt(files: FileList | null) {
    const picked = files ? Array.from(files) : []
    if (picked.length === 0) {
      setChosen([])
      setLocalError(null)
      return
    }
    const reason = rejectionReason(picked)
    if (reason) {
      setLocalError(reason)
      setChosen([])
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setLocalError(null)
    setChosen(picked.map((file) => file.name))
  }

  return (
    <section className="space-y-4">
      <SectionHeading title={title} description={description} />

      <FormError state={removeState} />

      {canEdit ? (
        <form action={uploadFormAction} className="space-y-3">
          <input type="hidden" name="contact_id" value={contactId} />
          {callReportId ? (
            <input type="hidden" name="call_report_id" value={callReportId} />
          ) : null}
          {proposalId ? <input type="hidden" name="proposal_id" value={proposalId} /> : null}

          <FormError state={uploadState} />

          {/* The label *is* the drop area, so a click anywhere in it opens the
              file chooser — a drop zone that only accepts drops excludes
              anyone who does not drag files. */}
          <label
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              if (inputRef.current && event.dataTransfer.files.length > 0) {
                inputRef.current.files = event.dataTransfer.files
                adopt(event.dataTransfer.files)
              }
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors',
              dragging
                ? 'border-brand-500 bg-brand-50'
                : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50',
            )}
          >
            <Paperclip aria-hidden="true" className="h-5 w-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-900">
              Choose files, or drop them here
            </span>
            <span className="text-xs text-slate-500">
              PDFs, documents, spreadsheets, presentations and images — up to{' '}
              {formatBytes(MAX_FILE_BYTES)} each
            </span>
            <input
              ref={inputRef}
              type="file"
              name="files"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              onChange={(event) => adopt(event.target.files)}
              className="sr-only"
            />
          </label>

          {localError ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {localError}
            </p>
          ) : null}

          {chosen.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-slate-700">
                Ready to attach: <span className="font-medium">{chosen.join(', ')}</span>
              </p>
              <SubmitButton size="sm" pendingLabel="Uploading…">
                Attach {chosen.length === 1 ? 'file' : `${chosen.length} files`}
              </SubmitButton>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (inputRef.current) inputRef.current.value = ''
                  setChosen([])
                  setLocalError(null)
                }}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}

      {attachments.length === 0 ? (
        <EmptyState
          title="No files yet"
          description="Proposal documents, estate papers and scans belong here, alongside the rest of the relationship."
        />
      ) : (
        <ul className="divide-y divide-slate-200 border-t border-slate-200">
          {attachments.map((attachment) => {
            const Icon = iconFor(attachment.mime_type, attachment.file_name)
            const size = attachment.size_bytes === null ? null : formatBytes(attachment.size_bytes)
            const mine = attachment.uploaded_by === currentUserId

            return (
              <li key={attachment.id} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <Icon aria-hidden="true" className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  {attachment.url ? (
                    <a
                      href={attachment.url}
                      className="block truncate text-[15px] font-medium text-slate-900 hover:text-brand-800 hover:underline"
                    >
                      {attachment.file_name}
                    </a>
                  ) : (
                    <span className="block truncate text-[15px] font-medium text-slate-500">
                      {attachment.file_name}
                    </span>
                  )}
                  <p className="text-xs text-slate-500">
                    {formatDate(attachment.created_at)}
                    {size ? ` · ${size}` : ''}
                    {attachment.url ? '' : ' · unavailable'}
                  </p>
                </div>
                {canEdit && (mine || isAdmin) ? (
                  <form action={removeFormAction} className="shrink-0">
                    <input type="hidden" name="contact_id" value={contactId} />
                    <input type="hidden" name="attachment_id" value={attachment.id} />
                    <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
                      Remove
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
