/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Approximating the Wellington City Council service palette, not lifted
        // from their stylesheet.
        council: {
          ink: '#0d1b2a',
          navy: '#123456',
          accent: '#0f7b6c',
          sand: '#f5f3ef',
          line: '#d9d5cd',
        },
        urgent: '#b3261e',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
