import type { CustomShape } from './shapes'

export type ECLevel = 'L' | 'M' | 'Q' | 'H'
export type ModuleShape = 'square' | 'dot' | 'custom'
export type FieldValues = Record<string, string>

export interface QRConfig {
  contentType: string
  // Field values keyed by content type id, so switching types keeps what was typed
  fields: Record<string, FieldValues>
  fgColor: string
  bgColor: string
  transparentBg: boolean
  errorLevel: ECLevel
  margin: number // quiet zone, in modules
  pngResolution: number
  shape: ModuleShape
  connected: boolean // square only: merge touching modules into shapes
  cornerRadius: number // 0–50, % of a module
  dotSize: number // 50–100, % of a module
  eyeRoundness: number // 0–100
  customShape: CustomShape | null
  logo: string | null
  plateSize: number // 0–200, % of the safe maximum (>100 is beyond safe)
  platePadding: number // 0–30, % of the plate side
  plateRadius: number // 0–50, % of the plate side
  plateBg: string | null // null = follow background
  borderWidth: number // in modules
  borderColor: string
}

export const DEFAULT_CONFIG: QRConfig = {
  contentType: 'url',
  fields: { url: { url: 'https://example.com' } },
  fgColor: '#000000',
  bgColor: '#ffffff',
  transparentBg: false,
  errorLevel: 'H',
  margin: 4,
  pngResolution: 1024,
  shape: 'square',
  connected: false,
  cornerRadius: 0,
  dotSize: 90,
  eyeRoundness: 0,
  customShape: null,
  logo: null,
  plateSize: 70,
  platePadding: 8,
  plateRadius: 20,
  plateBg: null,
  borderWidth: 0,
  borderColor: '#000000',
}

export interface HistoryItem {
  id: string
  savedAt: string
  thumbnail: string
  config: QRConfig
}

const HISTORY_KEY = 'qr-code-history'

// v1 items stored a flat config with a raw `text` field and `logoSize`
interface LegacyHistoryItem {
  id: string
  savedAt: string
  thumbnail: string
  text: string
  fgColor: string
  bgColor: string
  transparentBg: boolean
  logo: string | null
  errorLevel: ECLevel
  pngResolution: number
}

function migrate(raw: HistoryItem | LegacyHistoryItem): HistoryItem {
  if ('config' in raw) {
    return { ...raw, config: { ...DEFAULT_CONFIG, ...raw.config } }
  }
  const isUrl = /^https?:\/\//i.test(raw.text)
  return {
    id: raw.id,
    savedAt: raw.savedAt,
    thumbnail: raw.thumbnail,
    config: {
      ...DEFAULT_CONFIG,
      contentType: isUrl ? 'url' : 'text',
      fields: isUrl ? { url: { url: raw.text } } : { text: { text: raw.text } },
      fgColor: raw.fgColor,
      bgColor: raw.bgColor,
      transparentBg: raw.transparentBg,
      logo: raw.logo,
      errorLevel: raw.errorLevel,
      pngResolution: raw.pngResolution,
    },
  }
}

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as (HistoryItem | LegacyHistoryItem)[]).map(migrate) : []
  } catch {
    return []
  }
}

// Returns false when storage is unavailable or the quota is exceeded
// (logos and custom shapes are stored inline as data and can be large).
export function saveHistory(items: HistoryItem[]): boolean {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items))
    return true
  } catch {
    return false
  }
}
