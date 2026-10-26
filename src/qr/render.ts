import QRCode from 'qrcode'
import type { QRConfig } from './config'
import { maxPlateGeometry, maxPlateModules } from './safeZone'
import { dotsPath, escapeAttr, eyePath, roundedRectPath, squaresPath } from './shapes'

export interface RenderResult {
  svg: string
  version: number
  size: number // modules per side, without quiet zone
  maxPlate: number // largest safe logo plate, in modules
  plate: number // actual logo plate side, in modules (0 without a logo)
}

const n = (v: number) => String(Math.round(v * 1000) / 1000)

// The single renderer: SVG export, PNG export, the preview and history
// thumbnails all come from this string, so they can never diverge.
// Throws if the data does not fit in a QR code.
export function renderSvg(data: string, cfg: QRConfig, pixelSize: number): RenderResult {
  const qr = QRCode.create(data, { errorCorrectionLevel: cfg.errorLevel })
  const size = qr.modules.size
  const m = cfg.margin
  const total = size + m * 2

  const inFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7)

  // Logo plate geometry (module units, relative to the symbol's top-left)
  const maxPlate = maxPlateModules(size, cfg.errorLevel)
  // plateSize may exceed 100% (beyond the safe zone, at the user's risk), but
  // never far enough to cover the finder or timing patterns
  const plate = cfg.logo ? Math.min((maxPlate * cfg.plateSize) / 100, maxPlateGeometry(size)) : 0
  const hasPlate = plate >= 1
  // The visible plate ("box") is the plate snapped outward to whole modules,
  // with the symbol's parity so it stays centred. The background and border
  // follow its (rounded) edge.
  let box = Math.ceil(plate - 1e-6)
  if (box % 2 !== size % 2) box += 1
  const b0 = (size - box) / 2
  const radius = (box * cfg.plateRadius) / 100
  const insidePlate = (px: number, py: number) => {
    const dx = Math.max(b0 + radius - px, px - (b0 + box - radius), 0)
    const dy = Math.max(b0 + radius - py, py - (b0 + box - radius), 0)
    return px >= b0 && px <= b0 + box && py >= b0 && py <= b0 + box && dx * dx + dy * dy <= radius * radius + 1e-6
  }
  // Modules entirely inside the rounded plate are left out ("excavated");
  // ones straddling its curved edge are drawn and masked along the curve, so
  // the pattern fills the corners instead of leaving a square hole.
  const underPlate = (x: number, y: number) =>
    hasPlate && insidePlate(x, y) && insidePlate(x + 1, y) && insidePlate(x, y + 1) && insidePlate(x + 1, y + 1)
  const plateShape = roundedRectPath(b0, b0, box, box, [radius, radius, radius, radius])
  const masked = hasPlate && radius > 0

  const isDark = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && !inFinder(x, y) && !underPlate(x, y) && qr.modules.get(y, x) === 1

  const fg = escapeAttr(cfg.fgColor)
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${total} ${total}">`
  )
  if (!cfg.transparentBg) {
    parts.push(`<rect width="${total}" height="${total}" fill="${escapeAttr(cfg.bgColor)}"/>`)
  }
  parts.push(`<g transform="translate(${m} ${m})">`)

  // Data modules
  if (masked) {
    parts.push(
      `<mask id="qr-hole" maskUnits="userSpaceOnUse" x="${-m}" y="${-m}" width="${total}" height="${total}">` +
        `<rect x="${-m}" y="${-m}" width="${total}" height="${total}" fill="#fff"/><path fill="#000" d="${plateShape}"/></mask>` +
        `<g mask="url(#qr-hole)">`
    )
  }
  if (cfg.shape === 'custom' && cfg.customShape) {
    parts.push(`<defs><symbol id="qr-m" viewBox="${escapeAttr(cfg.customShape.viewBox)}">${cfg.customShape.body}</symbol></defs>`)
    parts.push(`<g color="${fg}" fill="currentColor">`)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isDark(x, y)) parts.push(`<use xlink:href="#qr-m" x="${x}" y="${y}" width="1" height="1"/>`)
      }
    }
    parts.push('</g>')
  } else {
    const d =
      cfg.shape === 'dot'
        ? dotsPath(size, isDark, cfg.dotSize / 100)
        : squaresPath(size, isDark, cfg.cornerRadius / 100, cfg.connected)
    if (d) parts.push(`<path fill="${fg}" d="${d}"/>`)
  }
  if (masked) parts.push('</g>')

  // Finder patterns
  const roundness = cfg.eyeRoundness / 100
  parts.push(
    `<path fill="${fg}" fill-rule="evenodd" d="${eyePath(0, 0, roundness)}${eyePath(size - 7, 0, roundness)}${eyePath(0, size - 7, roundness)}"/>`
  )

  // Logo plate: background and inset border on the box edge, then the logo
  // (scaling smoothly with `plate`) centred and clipped inside it
  if (hasPlate && cfg.logo) {
    const bw = Math.min(cfg.borderWidth, box / 4)
    const plateFill = cfg.plateBg ?? (cfg.transparentBg ? null : cfg.bgColor)
    if (plateFill) {
      parts.push(`<path fill="${escapeAttr(plateFill)}" d="${plateShape}"/>`)
    }
    if (bw > 0) {
      const o = b0 + bw / 2
      const s = box - bw
      const r = Math.max(radius - bw / 2, 0)
      parts.push(
        `<rect x="${n(o)}" y="${n(o)}" width="${n(s)}" height="${n(s)}" rx="${n(r)}" fill="none" ` +
          `stroke="${escapeAttr(cfg.borderColor)}" stroke-width="${n(bw)}"/>`
      )
    }
    const pad = (box * cfg.platePadding) / 100
    const is = Math.min(plate, box - 2 * bw) - 2 * pad
    const io = (size - is) / 2
    if (is > 0) {
      const ir = Math.max(radius - (box - is) / 2, 0)
      parts.push(
        `<clipPath id="qr-logo"><rect x="${n(io)}" y="${n(io)}" width="${n(is)}" height="${n(is)}" rx="${n(ir)}"/></clipPath>` +
          `<image xlink:href="${escapeAttr(cfg.logo)}" x="${n(io)}" y="${n(io)}" width="${n(is)}" height="${n(is)}" ` +
          `preserveAspectRatio="xMidYMid meet" clip-path="url(#qr-logo)"/>`
      )
    }
  }

  parts.push('</g></svg>')
  return { svg: parts.join(''), version: qr.version, size, maxPlate, plate: hasPlate ? plate : 0 }
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export async function rasterize(svg: string, pixelSize: number): Promise<HTMLCanvasElement> {
  const img = new Image()
  img.src = svgToDataUrl(svg)
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = pixelSize
  canvas.height = pixelSize
  canvas.getContext('2d')?.drawImage(img, 0, 0, pixelSize, pixelSize)
  return canvas
}
