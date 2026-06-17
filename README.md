# QR Code Generator

A fast, **100% client‑side** QR code generator. Type any text or URL, customize the
colors, make the background transparent, drop a logo in the center, and export a
crisp **PNG (up to 4096×4096)** or a scalable **SVG**.

No accounts, no tracking, no backend — **nothing ever leaves your browser**. Everything
is rendered locally on a `<canvas>` and saved to `localStorage`.

> The UI ships in **Brazilian Portuguese (pt‑BR)**. The code, docs, and this README are in English.

## Features

- **Text or URL → QR code**, regenerated live as you type.
- **Custom colors** — pick the foreground (code) and background colors via color picker or hex input.
- **Transparent background** — export QR codes that sit on any surface, previewed over a checkerboard.
- **Center logo** — upload any image; it's drawn with a rounded "safe zone" backdrop so the code stays scannable. Adjustable size (10–40% of the code).
- **Error correction levels** — `L`, `M`, `Q`, `H`. Defaults to `H` (highest), recommended when a logo covers the center.
- **High‑resolution PNG export** — 512, 1024, 2048, or 4096 px.
- **Vector SVG export** — infinitely scalable, logo embedded as a clipped base64 image.
- **Local history** — save configurations with a thumbnail and restore them with one click. Stored in `localStorage`, never uploaded.
- **Privacy by design** — fully static SPA, no server round‑trips, no analytics.

## How it works

The whole app is a single React component driven by state. Two independent render
paths produce the two output formats:

- **Canvas (PNG):** `drawQRWithLogo(canvas, size)` is the core renderer. It draws the QR
  via the [`qrcode`](https://www.npmjs.com/package/qrcode) library, then post‑processes
  the pixels: for transparency it zeroes the alpha of near‑white pixels, and for the logo
  it paints a rounded backdrop and clips the image into rounded corners.
  - A **320 px preview** canvas re‑renders on every state change.
  - On export, a **detached canvas** is created on demand at the chosen resolution
    (512/1024/2048/4096) and turned into a PNG data URL.
- **SVG (vector):** `downloadSVG` does **not** use canvas. It re‑generates the QR as an
  SVG string (`QRCode.toString({ type: 'svg' })`), parses it with `DOMParser`, strips the
  background rects/paths for transparency, and injects a `<defs>`/`<clipPath>` plus a
  base64 `<image>` for the logo.
- **History:** saved configs live in `localStorage` under the key `qr-code-history`. Each
  entry stores the full config plus a 128 px PNG thumbnail (data URL). Restoring re‑applies
  the state — it does not re‑generate the original file.

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
src/App.tsx     Single component — the entire app (~730 LOC)
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

- **Two render paths.** The canvas (PNG) and SVG exporters implement transparency and the
  logo overlay **separately**. Any visual change must be mirrored in both, or PNG and SVG
  will diverge.
- **Heuristic transparency (PNG).** On the canvas, pixels where R, G, and B are all `> 240`
  are made transparent. A very light, near‑white **foreground** color could be partially
  erased — pick a darker code color when using a transparent background.
- **Secure‑context APIs.** When the app is served over plain `http://` (e.g. on a LAN), the
  browser reports a non‑secure context, so APIs like `crypto.randomUUID` are unavailable.
  History IDs use a `crypto.getRandomValues` fallback (`genId()`) for this reason — avoid
  introducing secure‑context‑only APIs without a fallback.
- **Bleeding‑edge dependencies.** React 19, Vite 8, TypeScript 6, ESLint 10 — check
  compatibility before bumping.

## Contributing

Issues and pull requests are welcome. For changes that affect the generated output, please
verify **both** the PNG and SVG exports, since they share no rendering code.

## License

[MIT](./LICENSE) © Victor Vasconcelos
