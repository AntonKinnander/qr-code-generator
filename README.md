# QR Code Generator

A fast, **100% client‑side** QR code generator. Pick a content type (website, Wi‑Fi,
contact, event, payment…), style the modules (squares, dots, connected rounded shapes or
your own SVG shape), add a logo on a configurable plate, and export a crisp
**PNG (up to 4096×4096)** or a scalable **SVG**.

No accounts, no tracking, no backend — **nothing ever leaves your browser**. Everything
is rendered locally and saved to `localStorage`.

## Features

- **13 content types**: Website (default), Text, Email, Phone, SMS, WhatsApp, Wi‑Fi,
  Contact (vCard), Location, Event (iCalendar), App store link, Crypto payment, and
  SEPA payment (EPC/GiroCode). Each type gets its own form with the correct escaping.
- **Module shapes**: square (with an optional corner radius), dots, or **custom SVG**
  (presets, or upload your own; each shape fills exactly one module).
- **Connected mode** (square only): touching modules merge into shapes with rounded
  outer corners and filleted inner corners.
- **Finder "eyes"** are drawn solid with adjustable roundness, so dots and custom shapes stay scannable.
- **Logo plate**: size, padding, corner radius, border width/color and plate color.
  The size is capped to a **safe zone** worked out from the error-correction level and the
  symbol size (100%). You can push it to 200% past that limit, with a warning to
  test-scan, but never over the finder patterns. Modules under the plate are left out.
- **Colors and transparent background**, an adjustable quiet zone, and error correction `L`/`M`/`Q`/`H` (default `H`).
- **PNG export** (512–4096 px) and **SVG export**, both from the same renderer, so they are identical.
- **Local history**: save configurations with a thumbnail and restore them with one click.

## How it works

`src/qr/render.ts` → `renderSvg(data, config, px)` is the **single renderer**. It reads the
module matrix from `QRCode.create()` and builds an SVG string itself (data path or `<use>`
elements, solid eyes, logo plate). That string is used everywhere:

- **Preview**: shown as an `<img>` data URL. This also sandboxes user-supplied SVG content.
- **SVG export**: downloaded as-is.
- **PNG export and history thumbnails**: the SVG is drawn onto a canvas at the target size (`rasterize`).

Saved history lives in `localStorage` under `qr-code-history` (each entry holds the full
config plus a 128 px thumbnail). Old v1 entries are migrated when loaded.

## Config links and auto-download

Any code can be fully described in the URL. Opening such a link restores the settings,
and with `download` it immediately exports each requested format at each size.
**Export → Link with this configuration** builds a link from the current settings.

```
/?contentType=url&f.url=https://example.com&connected=1&cornerRadius=50&download=png,svg&sizes=512,1024,2048
```

| Param | Values |
| --- | --- |
| `contentType` | `url` `text` `email` `phone` `sms` `whatsapp` `wifi` `vcard` `location` `event` `app` `crypto` `epc` |
| `f.<field>` | content fields, e.g. `f.ssid`, `f.password`, `f.first`, `f.iban` (keys from `src/qr/contentTypes.ts`) |
| `fgColor` `bgColor` `borderColor` `plateBg` | hex, `#` optional |
| `transparentBg` `connected` | `1` / `0` |
| `errorLevel` | `L` `M` `Q` `H` |
| `shape` | `square` `dot` `custom` |
| `customShape` / `customShapeSvg` | preset `diamond` `star` `heart` `plus`, or URL-encoded SVG (sanitized) |
| `margin` `cornerRadius` `dotSize` `eyeRoundness` | numbers (clamped to the UI ranges) |
| `plateSize` `platePadding` `plateRadius` `borderWidth` | logo plate settings (apply once a logo is added) |
| `pngResolution` | default export size |
| `download` | `png`, `svg` or `png,svg` |
| `sizes` | comma-separated pixel sizes, 16–8192 (files are named `qrcode-<size>.<ext>`) |

The logo is never part of the link. Browsers may ask once for permission to download
multiple files.

## Tech stack

| Concern | Choice |
| --- | --- |
| UI | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) |
| Build | [Vite](https://vite.dev/) (`@vitejs/plugin-react`) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) via `@tailwindcss/vite` — no `tailwind.config.js`, no PostCSS; utilities come from `@import "tailwindcss"` in `src/index.css`, design tokens in the `@theme {}` block |
| QR engine | [`qrcode`](https://www.npmjs.com/package/qrcode) |
| Serving | Static SPA served by **nginx** in a multi‑stage **Docker** image |

There is **no backend** and **no environment configuration** — it's a static site.

## Getting started

**Prerequisites:** Node.js 20+ (Node 22 recommended) and npm.

```bash
git clone https://github.com/viktorkav/qr-code-generator.git
cd qr-code-generator
npm install        # once, after cloning
npm run dev        # start the Vite dev server with HMR
```

Then open the URL Vite prints (usually http://localhost:5173).

### Available scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload. **Does not type‑check.** |
| `npm run build` | `tsc -b && vite build` — a type error **fails the build**. |
| `npm run preview` | Serve the production build from `dist/` locally. |
| `npm run lint` | Run ESLint over the project. |

> ⚠️ `npm run dev` does **not** type‑check, but `npm run build` does (`tsc -b` runs first).
> Code that runs fine in dev can still break the build. Run `npm run build` before deploying.

There is no test suite configured.

## Project structure

```
src/App.tsx             UI + state (form controls, history panel)
src/qr/render.ts        the single renderer: config → SVG string; rasterize to PNG
src/qr/shapes.ts        path builders (squares, connected fillets, dots, eyes), custom-SVG sanitizer, preset shapes
src/qr/safeZone.ts      max logo plate size per EC level / symbol size
src/qr/contentTypes.ts  content-type registry: form fields + encode()
src/qr/config.ts        QRConfig, defaults, history load/save + migration
src/main.tsx    Mounts <App/> in StrictMode
src/index.css   @import tailwindcss + @theme tokens + .checkerboard (transparent preview)
index.html      Loads the Inter font from Google Fonts
public/         favicon.svg + icons.svg
Dockerfile      Multi-stage: node:22-alpine builds → nginx:alpine serves
nginx.conf      gzip + immutable cache for /assets/ + SPA try_files fallback
deploy.sh       rsync source → docker build → docker run on a remote host
```

## Deployment

The app builds to a folder of static files (`dist/`) that any static host can serve —
GitHub Pages, Netlify, Vercel, Cloudflare Pages, an S3 bucket, or your own nginx.

### Docker (recommended for self‑hosting)

The included `Dockerfile` is a multi‑stage build: `node:22-alpine` compiles the SPA,
then `nginx:alpine` serves the static `dist/` with gzip and long‑lived caching for
hashed assets.

```bash
docker build -t qr-code-generator .
docker run -d --name qr-code-generator --restart unless-stopped -p 8080:80 qr-code-generator
# now open http://localhost:8080
```

### Deploy to a remote host over SSH

`deploy.sh` rsyncs the source to a remote machine, builds the image **on that host**
(so the host needs Docker but not Node), and (re)starts the container. Configure it with
environment variables:

```bash
SSH_HOST=myserver PORT=8080 ./deploy.sh
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `SSH_HOST` | *(required)* | SSH host/alias of the target machine |
| `REMOTE_DIR` | `/opt/qr-code-generator` | Where to sync the source on the host |
| `PORT` | `8080` | Host port mapped to the container's port 80 |
| `IMAGE` | `qr-code-generator` | Docker image name |
| `CONTAINER` | `qr-code-generator` | Docker container name |

## Privacy

Everything happens in your browser. The QR codes, uploaded logos, and saved history are
processed and stored locally (`localStorage`); they are never sent to a server. Clearing
your browser storage clears your history.

## Notes & limitations

- **The logo relies on error correction.** No area of a QR code is free of data. The safe
  zone keeps the hidden area well inside what the chosen EC level can recover (×0.6
  safety factor), so short content at a low EC level allows only a small logo or none.
  Use `H` for the largest logo.
- **Always test-scan** stylized codes (especially small dots and sparse custom shapes) with
  the scanners your audience uses.
- **Secure‑context APIs.** When the app is served over plain `http://` (e.g. on a LAN), the
  browser reports a non‑secure context, so APIs like `crypto.randomUUID` are unavailable.
  History IDs use a `crypto.getRandomValues` fallback (`genId()`) for this reason — avoid
  introducing secure‑context‑only APIs without a fallback.
- **Bleeding‑edge dependencies.** React 19, Vite 8, TypeScript 6, ESLint 10 — check
  compatibility before bumping.

## Contributing

Issues and pull requests are welcome. For changes that affect the generated output, please
test-scan the result. PNG and SVG share one renderer, so checking one covers both.

## License

[MIT](./LICENSE) © Victor Vasconcelos
