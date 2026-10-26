# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context
A 100% client-side QR code generator: pick a content type (URL by default, Wi-Fi, vCard,
event, EPC payment…), style modules (square / dots / connected-rounded / custom SVG), add a
logo on a configurable plate, export PNG (up to 4096px) or vector SVG. Nothing leaves the
browser. UI, code and docs are all in English.

## Stack
- Runtime: Node (dev), browser (prod). React 19 + TypeScript ~6.0
- Build: Vite 8 (`@vitejs/plugin-react`)
- Styling: Tailwind CSS v4 via `@tailwindcss/vite` — **no** `tailwind.config.js`, **no** PostCSS;
  utilities come from `@import "tailwindcss"` in `src/index.css`, tokens in the `@theme {}` block
- QR: the `qrcode` library
- Serving: static SPA served by nginx in a multi-stage Docker image. No backend, no `.env`.

## Dev
```bash
npm install        # once, after clone
npm run dev        # vite dev server (HMR) — does NOT type-check
npm run build      # tsc -b && vite build — a type error BREAKS the build
npm run lint       # eslint .
npm run preview    # serve the built dist/
```
There is no test suite configured.

```bash
SSH_HOST=myserver ./deploy.sh   # build + run on a remote host (rsync → docker build → docker run)
```

## Architecture
```
src/App.tsx             UI + state (single QRConfig object), small local form components
src/qr/render.ts        renderSvg(data, cfg, px) — THE renderer; rasterize(svg, px) for PNG
src/qr/shapes.ts        path builders (squares/connected fillets, dots, eyes), custom-SVG sanitizer, presets
src/qr/safeZone.ts      maxPlateModules(size, ecLevel) — logo plate cap
src/qr/contentTypes.ts  CONTENT_TYPES registry: fields (generic form) + encode()
src/qr/config.ts        QRConfig + DEFAULT_CONFIG, history load/save, v1→v2 migration
src/qr/urlConfig.ts     URL query params ⇄ QRConfig (+ download/sizes auto-export); no logo
src/main.tsx            mounts <App/> in StrictMode
src/index.css           @import tailwind + @theme + .checkerboard (transparent preview)
Dockerfile / nginx.conf / deploy.sh   static nginx image + remote deploy
```

Core flow:
- `QRCode.create()` gives the module matrix; `renderSvg` builds the SVG by hand in module
  units (`viewBox` = size + 2×margin). Finder patterns are excluded from the data path and
  drawn as solid eyes. Modules fully inside the (rounded) logo plate are skipped ("excavated");
  ones on its curved edge are clipped by an SVG `<mask>`, so the pattern fills the plate's corners.
- That one SVG string feeds the preview (`<img>` data URL), the SVG download, the PNG export
  and history thumbnails (`rasterize` → canvas). **Never add a second render path.**
- URL config: `parseUrlConfig` runs once at module load (`URL_REQUEST` in App.tsx); auto-downloads
  are guarded by a module-level flag so StrictMode's double effect doesn't export twice. A new
  QRConfig field must be added to `urlConfig.ts` (RANGES / BOOLEAN_KEYS / COLOR_KEYS / ENUMS) too.
- History: `localStorage` key `qr-code-history`, items `{id, savedAt, thumbnail, config}`;
  only the active content type's fields are stored. `loadHistory` migrates v1 flat items.

## Gotchas
- **Logo safe zone**: a QR code has no data-free centre; the logo works only through error
  correction. `maxPlateModules` caps the plate (EC recovery × 0.6, same parity as the symbol so
  it stays centred). The size slider is a % *of that max* and goes to 200% on purpose (the UI warns
  past 100%); `maxPlateGeometry` is the hard cap that keeps the plate off finders/timing.
- **Custom SVG shapes are untrusted input**: `parseCustomShape` whitelists geometry
  tags/attributes only. Keep it whitelist-based, and keep the preview as `<img>` (never inline the SVG).
- Connected mode relies on all subpaths being clockwise in one nonzero-filled path (no seams).
- Changes to how the output looks: test-scan the result. jsQR handles dots/custom shapes poorly; Chrome's
  `BarcodeDetector` (Apple Vision on macOS) is a better proxy for phone cameras.
- Bleeding-edge versions (React 19, Vite 8, TS 6, ESLint 10) — check compatibility before bumping.
- Default error correction `'H'` — recommended when a logo covers the center.
- **`npm run dev` does not type-check; `npm run build` does** (`tsc -b` before vite). Code that
  runs in dev can still break the build/deploy.
- **Non-secure context (HTTP)**: when served over `http://` (e.g. on a LAN),
  `window.isSecureContext === false`, so secure-context-only APIs (`crypto.randomUUID`,
  `crypto.subtle`, `navigator.clipboard`) are `undefined` and throw. They work on `localhost`
  in dev but break in production. History IDs use `genId()` (fallback via
  `crypto.getRandomValues`) for this reason. Do not introduce those APIs without a fallback.
