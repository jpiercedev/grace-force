import localFont from 'next/font/local'

/**
 * The interface font, exposed as `--font-sans` and consumed by Tailwind's
 * `font-sans`. Swapping the typeface is a one-file change: everything else in
 * the app only knows the CSS variable.
 *
 * The intended face is Proxima Nova (regular 400, semibold 600, bold 700 —
 * the three weights the interface actually uses). Proxima Nova is a
 * commercial face licensed through Mark Simonson Studio / Adobe Fonts;
 * grace.tv's Adobe Fonts (Typekit) kit covers *hosted* use on its own
 * domains and does not permit extracting or self-hosting the files, so no
 * Proxima Nova binaries are committed here. When properly licensed
 * self-hosting .woff2 files are obtained, place them in this directory as:
 *
 *   proxima-nova-regular.woff2    (weight 400, style normal)
 *   proxima-nova-semibold.woff2   (weight 600, style normal)
 *   proxima-nova-bold.woff2       (weight 700, style normal)
 *   proxima-nova-italic.woff2     (weight 400, style italic — optional;
 *                                  italics are rare in this interface)
 *
 * …then replace the loader below with:
 *
 *   const interfaceFont = localFont({
 *     src: [
 *       { path: './proxima-nova-regular.woff2', weight: '400', style: 'normal' },
 *       { path: './proxima-nova-semibold.woff2', weight: '600', style: 'normal' },
 *       { path: './proxima-nova-bold.woff2', weight: '700', style: 'normal' },
 *     ],
 *     variable: '--font-sans',
 *     display: 'swap',
 *     // adjustFontFallback (on by default) sizes the fallback to the metrics
 *     // of the loaded face, so the swap does not shift layout.
 *     fallback: ['system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
 *   })
 *
 * Until then the interface ships Source Sans 3 (variable, latin subset,
 * SIL OFL 1.1 — license alongside the files), self-hosted so the build needs
 * no network and renders identically everywhere.
 */
const interfaceFont = localFont({
  src: [
    {
      path: './source-sans-3-latin-wght-normal.woff2',
      style: 'normal',
      weight: '200 900',
    },
    {
      path: './source-sans-3-latin-wght-italic.woff2',
      style: 'italic',
      weight: '200 900',
    },
  ],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
})

export { interfaceFont }
