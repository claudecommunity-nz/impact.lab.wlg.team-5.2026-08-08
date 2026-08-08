/** @type {import('tailwindcss').Config} */

// Every value here points at a CSS custom property defined in app/tokens/,
// which is the Wellington City Council design system verbatim. Nothing in this
// file invents a colour, a radius or a type step.
//
// Opacity modifiers (text-black/60) do not work through var() and are not
// wanted anyway: the system uses opacity to signal disabled and nothing else.
// Reach for a grey token instead.

module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Two brand colours, on white. Yellow is a signal, never a surface
        // behind body copy, and never carries white text.
        wcc: {
          yellow: 'var(--wcc-yellow)',
          black: 'var(--wcc-black)',
          white: 'var(--wcc-white)',
        },
        // Tints and shades of the brand yellow, for states only.
        brand: {
          100: 'var(--yellow-100)',
          200: 'var(--yellow-200)',
          300: 'var(--yellow-300)',
          400: 'var(--yellow-400)',
          600: 'var(--yellow-600)',
          700: 'var(--yellow-700)',
        },
        // Warm-leaning, so they sit with the yellow rather than fighting it.
        grey: {
          50: 'var(--grey-050)',
          100: 'var(--grey-100)',
          200: 'var(--grey-200)',
          300: 'var(--grey-300)',
          400: 'var(--grey-400)',
          500: 'var(--grey-500)',
          600: 'var(--grey-600)',
          700: 'var(--grey-700)',
          800: 'var(--grey-800)',
          900: 'var(--grey-900)',
        },
        ink: 'var(--text-body)',
        muted: 'var(--text-muted)',
        link: 'var(--text-link)',
        // Additions, not brand colours — see the design system readme.
        success: { fg: 'var(--status-success-fg)', bg: 'var(--status-success-bg)' },
        warning: { fg: 'var(--status-warning-fg)', bg: 'var(--status-warning-bg)' },
        error: { fg: 'var(--status-error-fg)', bg: 'var(--status-error-bg)' },
        info: { fg: 'var(--status-info-fg)', bg: 'var(--status-info-bg)' },
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        xs: ['var(--fs-100)', { lineHeight: 'var(--lh-body)' }],
        sm: ['var(--fs-200)', { lineHeight: 'var(--lh-body)' }],
        base: ['var(--fs-300)', { lineHeight: 'var(--lh-body)' }],
        lg: ['var(--fs-400)', { lineHeight: 'var(--lh-body)' }],
        xl: ['var(--fs-500)', { lineHeight: 'var(--lh-snug)' }],
        '2xl': ['var(--fs-600)', { lineHeight: 'var(--lh-snug)' }],
        '3xl': ['var(--fs-700)', { lineHeight: 'var(--lh-tight)' }],
        '4xl': ['var(--fs-800)', { lineHeight: 'var(--lh-tight)' }],
        '5xl': ['var(--fs-900)', { lineHeight: 'var(--lh-tight)' }],
      },
      // 1px for containers, 2px for emphasis and errors, and the 4px yellow
      // rule as the recurring structural motif.
      borderWidth: {
        DEFAULT: 'var(--border-width)',
        thick: 'var(--border-width-thick)',
        rule: 'var(--rule-heavy)',
      },
      // 4px on everything. Pills are reserved for status tags.
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-md)',
        xl: 'var(--radius-md)',
        '2xl': 'var(--radius-md)',
        full: 'var(--radius-pill)',
      },
      // Effectively flat: the raised shadow is for a hovered interactive card,
      // the overlay one for modals. Never on buttons, inputs or headers.
      boxShadow: {
        DEFAULT: 'var(--shadow-raised)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
        none: 'var(--shadow-none)',
      },
      // The 6px base grid, for structural spacing. Tailwind's own 4px scale is
      // left intact for spacing inside components.
      spacing: {
        gutter: 'var(--gutter)',
        section: 'var(--section-y)',
        field: 'var(--field-gap)',
        stack: 'var(--stack-gap)',
        tap: 'var(--tap-min)',
        rule: 'var(--rule-heavy)',
      },
      maxWidth: {
        container: 'var(--container-max)',
        narrow: 'var(--container-narrow)',
        measure: 'var(--measure)',
      },
      minHeight: {
        tap: 'var(--tap-min)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
      },
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
      },
    },
  },
  plugins: [],
}
