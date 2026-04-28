// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Only load the Netlify plugin during builds — in dev it intercepts Vite's
// virtual CSS modules (tailwindcss, tw-animate-css) and causes 404s.
const isDevMode = process.env.NODE_ENV !== "production" && !process.env.NETLIFY;

export default defineConfig({
  cloudflare: false,
  ...(isDevMode ? {} : { plugins: [import("@netlify/vite-plugin-tanstack-start").then(m => m.default())] }),
});

