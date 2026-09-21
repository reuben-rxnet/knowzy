/** Tailwind v4 runs as a single PostCSS plugin; no other transform is needed.
 * The theme itself lives in @knowzy/shared-ui/tokens.css, imported by
 * src/app/globals.css. */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
