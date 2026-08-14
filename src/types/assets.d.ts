/**
 * Static image imports. `next build` generates next-env.d.ts with these
 * declarations, but that file is gitignored — declaring the one format we
 * import keeps `tsc --noEmit` green on a fresh checkout.
 */
declare module '*.webp' {
  import type { StaticImageData } from 'next/image'
  const content: StaticImageData
  export default content
}
