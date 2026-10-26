import { DEFAULT_CONFIG } from './config'
import type { QRConfig } from './config'
import { CONTENT_TYPES } from './contentTypes'
import { PRESET_SHAPES, parseCustomShape } from './shapes'
import type { CustomShape } from './shapes'

// A QR code can be fully described by URL query params, e.g.
//   ?contentType=wifi&f.ssid=HomeNet&f.password=secret&shape=dot&fgColor=1e293b
//    &download=png,svg&sizes=512,2048
// Config keys use their QRConfig names; content fields use `f.<field key>`.
// `logo` is not supported (an image does not belong in a URL). `customShape`
// takes a preset name (diamond, star, heart, plus) or `customShapeSvg` takes
// URL-encoded SVG markup, which is sanitized like an upload.

export type ExportFormat = 'png' | 'svg'

export interface UrlRequest {
  config: QRConfig
  formats: ExportFormat[]
  sizes: number[]
}

export const MIN_EXPORT_SIZE = 16
export const MAX_EXPORT_SIZE = 8192

type NumberKey = 'margin' | 'pngResolution' | 'cornerRadius' | 'dotSize' | 'eyeRoundness' | 'plateSize' |
  'platePadding' | 'plateRadius' | 'borderWidth'

const RANGES: Record<NumberKey, [number, number]> = {
  margin: [0, 8],
  pngResolution: [MIN_EXPORT_SIZE, MAX_EXPORT_SIZE],
  cornerRadius: [0, 50],
  dotSize: [50, 100],
  eyeRoundness: [0, 100],
  plateSize: [0, 200],
  platePadding: [0, 30],
  plateRadius: [0, 50],
  borderWidth: [0, 1.5],
}
const BOOLEAN_KEYS = ['transparentBg', 'connected'] as const
const COLOR_KEYS = ['fgColor', 'bgColor', 'borderColor', 'plateBg'] as const
const ENUMS = {
  errorLevel: ['L', 'M', 'Q', 'H'],
  shape: ['square', 'dot', 'custom'],
} as const

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(Math.max(v, lo), hi)

// Accepts "fff", "#fff", "1e293b", "#1e293b"
function parseColor(v: string): string | null {
  const hex = v.trim().replace(/^#/, '')
  return /^([\da-f]{3}|[\da-f]{6})$/i.test(hex) ? `#${hex.toLowerCase()}` : null
}

function parseBool(v: string): boolean {
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes'
}

function parseSizes(v: string | null): number[] {
  if (!v) return []
  return [...new Set(v.split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0))].map((n) =>
    Math.round(clamp(n, [MIN_EXPORT_SIZE, MAX_EXPORT_SIZE]))
  )
}

// Returns null when the URL carries no QR params, so the app starts normally
export function parseUrlConfig(search: string): UrlRequest | null {
  const p = new URLSearchParams(search)
  const relevant = [...p.keys()].some((k) => k.startsWith('f.') || k in DEFAULT_CONFIG || k === 'customShapeSvg' ||
    k === 'download' || k === 'sizes')
  if (!relevant) return null

  const cfg: QRConfig = { ...DEFAULT_CONFIG, fields: {} }

  const type = p.get('contentType')
  if (type && CONTENT_TYPES.some((t) => t.id === type)) cfg.contentType = type
  const fields: Record<string, string> = {}
  for (const [k, v] of p) if (k.startsWith('f.')) fields[k.slice(2)] = v
  cfg.fields = Object.keys(fields).length ? { [cfg.contentType]: fields } : cfg.contentType === 'url'
    ? DEFAULT_CONFIG.fields
    : {}

  for (const key of Object.keys(RANGES) as NumberKey[]) {
    const v = p.get(key)
    if (v !== null && v.trim() !== '' && Number.isFinite(Number(v))) cfg[key] = clamp(Number(v), RANGES[key])
  }
  for (const key of BOOLEAN_KEYS) {
    const v = p.get(key)
    if (v !== null) cfg[key] = parseBool(v)
  }
  for (const key of COLOR_KEYS) {
    const v = p.get(key)
    const color = v === null ? null : parseColor(v)
    if (color) cfg[key] = color
  }
  const ec = p.get('errorLevel')?.toUpperCase()
  if (ec && (ENUMS.errorLevel as readonly string[]).includes(ec)) cfg.errorLevel = ec as QRConfig['errorLevel']
  const shape = p.get('shape')
  if (shape && (ENUMS.shape as readonly string[]).includes(shape)) cfg.shape = shape as QRConfig['shape']

  const presetName = p.get('customShape')?.toLowerCase()
  const preset = PRESET_SHAPES.find((s) => s.name.toLowerCase() === presetName)
  const svg = p.get('customShapeSvg')
  const custom: CustomShape | null = preset?.shape ?? (svg ? parseCustomShape(svg) : null)
  if (custom) {
    cfg.customShape = custom
    if (!shape) cfg.shape = 'custom'
  } else if (cfg.shape === 'custom') {
    cfg.customShape = PRESET_SHAPES[0].shape
  }

  const formats = (p.get('download') ?? '')
    .toLowerCase()
    .split(',')
    .filter((f): f is ExportFormat => f === 'png' || f === 'svg')
  const sizes = parseSizes(p.get('sizes'))
  return {
    config: cfg,
    formats: [...new Set(formats)],
    sizes: sizes.length ? sizes : [cfg.pngResolution],
  }
}

// Builds a link for the current config. Only values that differ from the
// defaults are included, to keep links short; the logo is never included.
export function buildConfigUrl(
  base: string,
  cfg: QRConfig,
  fields: Record<string, string>,
  formats: ExportFormat[],
  sizes: number[]
): string {
  const p = new URLSearchParams()
  p.set('contentType', cfg.contentType)
  for (const [k, v] of Object.entries(fields)) if (v) p.set(`f.${k}`, v)

  const strip = (c: string) => c.replace(/^#/, '')
  for (const key of Object.keys(RANGES) as NumberKey[]) {
    if (cfg[key] !== DEFAULT_CONFIG[key]) p.set(key, String(cfg[key]))
  }
  for (const key of BOOLEAN_KEYS) if (cfg[key] !== DEFAULT_CONFIG[key]) p.set(key, cfg[key] ? '1' : '0')
  for (const key of COLOR_KEYS) {
    const v = cfg[key]
    if (v && v !== DEFAULT_CONFIG[key]) p.set(key, strip(v))
  }
  if (cfg.errorLevel !== DEFAULT_CONFIG.errorLevel) p.set('errorLevel', cfg.errorLevel)
  if (cfg.shape !== DEFAULT_CONFIG.shape) p.set('shape', cfg.shape)
  if (cfg.shape === 'custom' && cfg.customShape) {
    const preset = PRESET_SHAPES.find((s) => s.shape.body === cfg.customShape?.body)
    if (preset) p.set('customShape', preset.name.toLowerCase())
    else p.set('customShapeSvg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cfg.customShape.viewBox}">${cfg.customShape.body}</svg>`)
  }
  if (formats.length) {
    p.set('download', formats.join(','))
    if (sizes.length) p.set('sizes', sizes.join(','))
  }
  // Keep commas readable in download/sizes
  return `${base}?${p.toString().replace(/%2C/g, ',')}`
}
