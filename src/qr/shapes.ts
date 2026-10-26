// SVG path builders. All coordinates are in module units; every subpath is
// drawn clockwise so a single nonzero-filled path never cancels itself out.

const n = (v: number) => String(Math.round(v * 1000) / 1000)

// Rect with an individual radius per corner (top-left, top-right, bottom-right, bottom-left)
export function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  [tl, tr, br, bl]: [number, number, number, number]
): string {
  const arc = (r: number, ex: number, ey: number) => (r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(ex)} ${n(ey)}` : '')
  return (
    `M${n(x + tl)} ${n(y)}H${n(x + w - tr)}${arc(tr, x + w, y + tr)}` +
    `V${n(y + h - br)}${arc(br, x + w - br, y + h)}` +
    `H${n(x + bl)}${arc(bl, x, y + h - bl)}` +
    `V${n(y + tl)}${arc(tl, x + tl, y)}Z`
  )
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 1 ${n(r * 2)} 0a${n(r)} ${n(r)} 0 1 1 ${n(-r * 2)} 0Z`
}

export type IsDark = (x: number, y: number) => boolean

// Square modules. With `connected`, only convex corners (both orthogonal
// neighbours light) are rounded, and concave corners get an inverse fillet
// drawn into the light cell, so touching modules read as one smooth shape.
// Modules that touch only diagonally stay separate.
export function squaresPath(size: number, isDark: IsDark, radius: number, connected: boolean): string {
  const r = Math.min(Math.max(radius, 0), 0.5)
  const parts: string[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isDark(x, y)) {
        if (!connected) {
          parts.push(roundedRectPath(x, y, 1, 1, [r, r, r, r]))
          continue
        }
        const t = isDark(x, y - 1)
        const b = isDark(x, y + 1)
        const l = isDark(x - 1, y)
        const rt = isDark(x + 1, y)
        parts.push(
          roundedRectPath(x, y, 1, 1, [!t && !l ? r : 0, !t && !rt ? r : 0, !b && !rt ? r : 0, !b && !l ? r : 0])
        )
      } else if (connected && r > 0) {
        const t = isDark(x, y - 1)
        const b = isDark(x, y + 1)
        const l = isDark(x - 1, y)
        const rt = isDark(x + 1, y)
        // Only fill a true concave corner (an L of three dark modules). If the
        // diagonal is light, the two neighbours merely touch at a point and a
        // fillet would bridge them.
        if (t && l && isDark(x - 1, y - 1)) parts.push(`M${n(x)} ${n(y)}H${n(x + r)}A${n(r)} ${n(r)} 0 0 0 ${n(x)} ${n(y + r)}Z`)
        if (t && rt && isDark(x + 1, y - 1)) parts.push(`M${n(x + 1)} ${n(y)}V${n(y + r)}A${n(r)} ${n(r)} 0 0 0 ${n(x + 1 - r)} ${n(y)}Z`)
        if (b && rt && isDark(x + 1, y + 1)) parts.push(`M${n(x + 1)} ${n(y + 1)}H${n(x + 1 - r)}A${n(r)} ${n(r)} 0 0 0 ${n(x + 1)} ${n(y + 1 - r)}Z`)
        if (b && l && isDark(x - 1, y + 1)) parts.push(`M${n(x)} ${n(y + 1)}V${n(y + 1 - r)}A${n(r)} ${n(r)} 0 0 0 ${n(x + r)} ${n(y + 1)}Z`)
      }
    }
  }
  return parts.join('')
}

export function dotsPath(size: number, isDark: IsDark, dotSize: number): string {
  const r = dotSize / 2
  const parts: string[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isDark(x, y)) parts.push(circlePath(x + 0.5, y + 0.5, r))
    }
  }
  return parts.join('')
}

// Finder pattern ("eye") at module (x, y): 7×7 frame + 3×3 ball, drawn solid
// rather than per-module so dots and custom shapes stay scannable.
// `roundness` is 0–1 (1 = circles). Use with fill-rule="evenodd".
export function eyePath(x: number, y: number, roundness: number): string {
  const rr = (o: number, s: number) => {
    const r = (s / 2) * roundness
    return roundedRectPath(x + o, y + o, s, s, [r, r, r, r])
  }
  return rr(0, 7) + rr(1, 5) + rr(2, 3)
}

export interface CustomShape {
  viewBox: string
  body: string // sanitized inner SVG markup
}

const ALLOWED_TAGS = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line'])
const ALLOWED_ATTRS = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'points',
  'x1', 'y1', 'x2', 'y2', 'transform', 'fill-rule', 'clip-rule', 'opacity',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin',
])

// Whitelist-based sanitizer: keeps only basic geometry, drops scripts, styles,
// links and external references. Colors are replaced by currentColor so the
// shape takes the code color; `fill="none"` is kept so outlines stay outlines.
export function parseCustomShape(svgText: string): CustomShape | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg' || doc.querySelector('parsererror')) return null

  let viewBox = root.getAttribute('viewBox')?.trim()
  if (!viewBox) {
    const w = parseFloat(root.getAttribute('width') ?? '')
    const h = parseFloat(root.getAttribute('height') ?? '')
    if (!(w > 0 && h > 0)) return null
    viewBox = `0 0 ${w} ${h}`
  }
  if (!/^[-\d.eE\s,]+$/.test(viewBox)) return null

  const clean = (el: Element): string => {
    const tag = el.nodeName
    if (!ALLOWED_TAGS.has(tag)) return ''
    const attrs: string[] = []
    for (const { name, value } of Array.from(el.attributes)) {
      if (ALLOWED_ATTRS.has(name)) attrs.push(`${name}="${escapeAttr(value)}"`)
    }
    if (el.getAttribute('fill') === 'none') attrs.push('fill="none"')
    const stroke = el.getAttribute('stroke')
    if (stroke && stroke !== 'none') attrs.push('stroke="currentColor"')
    const children = Array.from(el.children).map(clean).join('')
    return `<${tag} ${attrs.join(' ')}>${children}</${tag}>`
  }

  const body = Array.from(root.children).map(clean).join('')
  return body ? { viewBox, body } : null
}

export function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const PRESET_SHAPES: { name: string; shape: CustomShape }[] = [
  { name: 'Diamond', shape: { viewBox: '0 0 10 10', body: '<path d="M5 0L10 5L5 10L0 5Z"></path>' } },
  {
    name: 'Star',
    shape: {
      viewBox: '0 0 24 24',
      body: '<path d="M12 1l3.4 6.9 7.6 1.1-5.5 5.4 1.3 7.6L12 18.4 5.2 22l1.3-7.6L1 9l7.6-1.1z"></path>',
    },
  },
  {
    name: 'Heart',
    shape: {
      viewBox: '0 0 24 24',
      body: '<path d="M12 22S1 15 1 8a5.5 5.5 0 0 1 11-1.5A5.5 5.5 0 0 1 23 8c0 7-11 14-11 14z"></path>',
    },
  },
  {
    name: 'Plus',
    shape: { viewBox: '0 0 3 3', body: '<path d="M1 0h1v1h1v1H2v1H1V2H0V1h1z"></path>' },
  },
]
