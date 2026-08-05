import { IntakePanel } from '@/app/intake/intake-panel'
import { DEFAULT_FORM_KEY } from '@/lib/leads/form'

/**
 * The generic enquiry form. `/intake/<key>` exists for campaign-specific
 * variants; this is the one to link to when there is nothing to distinguish.
 */
export default function IntakePage() {
  return <IntakePanel formKey={DEFAULT_FORM_KEY} />
}
