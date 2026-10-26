import { useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_CONFIG, loadHistory, saveHistory } from './qr/config'
import type { ECLevel, HistoryItem, ModuleShape, QRConfig } from './qr/config'
import { CONTENT_TYPES, fieldsWithDefaults, getContentType } from './qr/contentTypes'
import type { FieldDef } from './qr/contentTypes'
import { rasterize, renderSvg, svgToDataUrl } from './qr/render'
import { PRESET_SHAPES, parseCustomShape } from './qr/shapes'
import { MAX_EXPORT_SIZE, MIN_EXPORT_SIZE, buildConfigUrl, parseUrlConfig } from './qr/urlConfig'
import type { ExportFormat } from './qr/urlConfig'

// crypto.randomUUID() only exists in secure contexts (HTTPS/localhost). Served
// over plain HTTP on a LAN it's undefined, so fall back to getRandomValues.
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

const PREVIEW_SIZE = 320
const LOGO_MAX_PX = 1024

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all'

function readFile(file: File, as: 'dataUrl' | 'text'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    if (as === 'text') reader.readAsText(file)
    else reader.readAsDataURL(file)
  })
}

// Downscale large raster logos so renders stay fast and history fits in localStorage
async function prepareLogo(file: File): Promise<string> {
  const dataUrl = await readFile(file, 'dataUrl')
  if (file.type === 'image/svg+xml') return dataUrl
  const img = new Image()
  img.src = dataUrl
  await img.decode()
  const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight))
  if (scale === 1) return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

function download(href: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = href
  link.click()
}

function encodeData(cfg: QRConfig): string {
  const type = getContentType(cfg.contentType)
  return type.encode(fieldsWithDefaults(type, cfg.fields[type.id]))
}

async function exportFile(cfg: QRConfig, format: ExportFormat, size: number, filename: string) {
  const data = encodeData(cfg)
  if (!data) return
  const { svg } = renderSvg(data, cfg, size)
  if (format === 'png') {
    download((await rasterize(svg, size)).toDataURL('image/png'), filename)
  } else {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    download(url, filename)
    URL.revokeObjectURL(url)
  }
}

// Clipboard API is missing in non-secure contexts (plain HTTP on a LAN)
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

// Config passed in the URL (see qr/urlConfig.ts); parsed once at startup
const URL_REQUEST = parseUrlConfig(window.location.search)
// Module-level so StrictMode's double effect run in dev doesn't download twice
let urlDownloadsStarted = false

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h2>
      {children}
    </section>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <label className="block text-sm font-semibold text-slate-700 mb-2">{children}</label>
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`py-2 rounded-lg text-sm font-medium transition-all ${
            value === o.value ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  display?: string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="flex items-center justify-between text-xs text-slate-500 mb-1">
        <span>{label}</span>
        <span className="font-mono">{display ?? `${value}%`}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-indigo-600"
      />
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
          checked ? 'bg-indigo-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
  disabled,
  displayValue,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  displayValue?: string
}) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <div className="shrink-0">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-10 h-10 rounded-lg cursor-pointer border-2 border-slate-200 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>
        <input
          type="text"
          value={displayValue ?? value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-40 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  )
}

function Field({ def, value, onChange }: { def: FieldDef; value: string; onChange: (v: string) => void }) {
  if (def.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-700 h-full pt-6 cursor-pointer">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(String(e.target.checked))}
          className="w-4 h-4 accent-indigo-600"
        />
        {def.label}
      </label>
    )
  }
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{def.label}</label>
      {def.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          rows={3}
          className={inputClass}
        />
      ) : def.type === 'select' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={def.type === 'datetime' ? 'datetime-local' : def.type}
          step={def.type === 'number' ? 'any' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          className={inputClass}
        />
      )}
    </div>
  )
}

const SHAPE_OPTIONS: { value: ModuleShape; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'dot', label: 'Dots' },
  { value: 'custom', label: 'Custom' },
]

function App() {
  const [cfg, setCfg] = useState<QRConfig>(() => URL_REQUEST?.config ?? DEFAULT_CONFIG)
  const [linkFormats, setLinkFormats] = useState<ExportFormat[]>(['png', 'svg'])
  const [linkSizes, setLinkSizes] = useState('512,1024,2048')
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory)
  const [notice, setNotice] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  function set<K extends keyof QRConfig>(key: K, value: QRConfig[K]) {
    setCfg((c) => ({ ...c, [key]: value }))
  }

  const type = getContentType(cfg.contentType)
  const values = fieldsWithDefaults(type, cfg.fields[type.id])
  const data = type.encode(values)

  function setField(key: string, value: string) {
    setCfg((c) => ({ ...c, fields: { ...c.fields, [type.id]: { ...values, [key]: value } } }))
  }

  // Cheap enough (a few ms) to rebuild on every render
  const preview = (() => {
    if (!data) return null
    try {
      return renderSvg(data, cfg, PREVIEW_SIZE)
    } catch {
      return 'too-big' as const
    }
  })()
  const result = preview && preview !== 'too-big' ? preview : null
  const plateModules = result ? Math.round(result.plate * 10) / 10 : 0
  const beyondSafe = !!result && result.plate > result.maxPlate + 1e-6

  const downloadPNG = () => exportFile(cfg, 'png', cfg.pngResolution, 'qrcode.png')
  const downloadSVG = () => exportFile(cfg, 'svg', cfg.pngResolution, 'qrcode.svg')

  // ?download=png,svg&sizes=… : export every format × size once on load
  useEffect(() => {
    if (!URL_REQUEST?.formats.length || urlDownloadsStarted) return
    urlDownloadsStarted = true
    const { config, formats, sizes } = URL_REQUEST
    void (async () => {
      for (const format of formats) {
        for (const size of sizes) {
          await exportFile(config, format, size, `qrcode-${size}.${format}`)
          // Browsers drop downloads fired in the same tick
          await new Promise((r) => setTimeout(r, 250))
        }
      }
    })()
  }, [])

  const linkSizeList = linkSizes
    .split(',')
    .map((v) => Math.round(Number(v)))
    .filter((v) => v >= MIN_EXPORT_SIZE && v <= MAX_EXPORT_SIZE)
  const configUrl = buildConfigUrl(
    window.location.origin + window.location.pathname,
    cfg,
    values,
    linkFormats,
    linkSizeList
  )

  async function copyLink() {
    if (await copyText(configUrl)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      set('logo', await prepareLogo(file))
    } catch {
      setNotice('Could not read that image.')
    }
  }

  function removeLogo() {
    set('logo', null)
    if (logoInputRef.current) logoInputRef.current.value = ''
  }

  async function handleShapeUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const shape = parseCustomShape(await readFile(file, 'text'))
    if (shape) {
      setCfg((c) => ({ ...c, shape: 'custom', customShape: shape }))
      setNotice(null)
    } else {
      setNotice('That SVG has no usable shapes (paths, circles, rects or polygons).')
    }
  }

  async function saveToHistory() {
    if (!data) return
    const thumbSize = 128
    const { svg } = renderSvg(data, cfg, thumbSize)
    const thumbnail = (await rasterize(svg, thumbSize)).toDataURL('image/png')

    const item: HistoryItem = {
      id: genId(),
      savedAt: new Date().toISOString(),
      thumbnail,
      // Only keep the active content type's fields
      config: { ...cfg, fields: { [type.id]: values } },
    }
    const updated = [item, ...history]
    if (saveHistory(updated)) {
      setHistory(updated)
      setNotice(null)
    } else {
      setNotice('Could not save: browser storage is full. Delete some history items or use a smaller logo.')
    }
  }

  function restoreFromHistory(item: HistoryItem) {
    setCfg((c) => ({ ...DEFAULT_CONFIG, ...item.config, fields: { ...c.fields, ...item.config.fields } }))
  }

  function deleteFromHistory(id: string) {
    const updated = history.filter((item) => item.id !== id)
    setHistory(updated)
    saveHistory(updated)
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function historyLabel(item: HistoryItem): string {
    const t = getContentType(item.config.contentType)
    const v = fieldsWithDefaults(t, item.config.fields[t.id])
    const first = Object.values(v).find((x) => x && x !== 'true' && x !== 'false')
    return first ?? t.label
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-start justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-5xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight">QR Code Generator</h1>
          <p className="text-slate-500 mt-2 text-sm sm:text-base">
            Custom QR codes with shapes, colors, logos and transparent backgrounds
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="flex flex-col lg:flex-row">
            {/* Left: Controls */}
            <div className="flex-1 min-w-0 p-6 sm:p-8 space-y-8 border-b lg:border-b-0 lg:border-r border-slate-200">
              <Section title="Content">
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TYPES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => set('contentType', t.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        type.id === t.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {type.fields
                    .filter((f) => !f.showIf || f.showIf(values))
                    .map((f) => (
                      <div key={f.key} className={f.half ? 'col-span-1' : 'col-span-2'}>
                        <Field def={f} value={values[f.key]} onChange={(v) => setField(f.key, v)} />
                      </div>
                    ))}
                </div>
                {data && (
                  <details className="text-xs text-slate-500">
                    <summary className="cursor-pointer select-none">
                      Encoded data · {data.length} characters
                      {result && ` · version ${result.version} (${result.size}×${result.size} modules)`}
                    </summary>
                    <pre className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 whitespace-pre-wrap break-all font-mono">
                      {data}
                    </pre>
                  </details>
                )}
              </Section>

              <Section title="Style">
                <div>
                  <Label>Module shape</Label>
                  <Segmented options={SHAPE_OPTIONS} value={cfg.shape} onChange={(v) =>
                      setCfg((c) => ({
                        ...c,
                        shape: v,
                        customShape: v === 'custom' && !c.customShape ? PRESET_SHAPES[0].shape : c.customShape,
                      }))
                    }
                  />
                </div>

                {cfg.shape === 'square' && (
                  <>
                    <Slider
                      label="Corner radius"
                      value={cfg.cornerRadius}
                      min={0}
                      max={50}
                      onChange={(v) => set('cornerRadius', v)}
                    />
                    <Toggle
                      label="Connect touching modules"
                      checked={cfg.connected}
                      onChange={(v) => set('connected', v)}
                    />
                  </>
                )}

                {cfg.shape === 'dot' && (
                  <Slider label="Dot size" value={cfg.dotSize} min={50} max={100} onChange={(v) => set('dotSize', v)} />
                )}

                {cfg.shape === 'custom' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-5 gap-2">
                      {PRESET_SHAPES.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          title={p.name}
                          onClick={() => set('customShape', p.shape)}
                          className={`aspect-square p-2.5 rounded-lg transition-all ${
                            cfg.customShape?.body === p.shape.body
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          <svg
                            viewBox={p.shape.viewBox}
                            className="w-full h-full"
                            fill="currentColor"
                            dangerouslySetInnerHTML={{ __html: p.shape.body }}
                          />
                        </button>
                      ))}
                      <label
                        title="Upload an SVG shape"
                        className="aspect-square flex items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 cursor-pointer transition-all"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        <input type="file" accept=".svg,image/svg+xml" onChange={handleShapeUpload} className="hidden" />
                      </label>
                    </div>
                    <p className="text-xs text-slate-400">
                      {cfg.customShape
                        ? 'Each dark module is drawn with this shape, scaled to fill one module.'
                        : 'Pick a preset or upload an SVG. Until then, squares are used.'}
                    </p>
                  </div>
                )}

                <Slider
                  label="Eye roundness"
                  value={cfg.eyeRoundness}
                  min={0}
                  max={100}
                  onChange={(v) => set('eyeRoundness', v)}
                />

                <div className="grid grid-cols-2 gap-4">
                  <ColorField label="Code color" value={cfg.fgColor} onChange={(v) => set('fgColor', v)} />
                  <ColorField
                    label="Background"
                    value={cfg.bgColor}
                    onChange={(v) => set('bgColor', v)}
                    disabled={cfg.transparentBg}
                    displayValue={cfg.transparentBg ? 'transparent' : undefined}
                  />
                </div>
                <Toggle
                  label="Transparent background"
                  checked={cfg.transparentBg}
                  onChange={(v) => set('transparentBg', v)}
                />
                <Slider
                  label="Quiet zone (margin)"
                  value={cfg.margin}
                  min={0}
                  max={8}
                  display={`${cfg.margin} modules`}
                  onChange={(v) => set('margin', v)}
                />
                <div>
                  <Label>Error correction</Label>
                  <Segmented<ECLevel>
                    options={[
                      { value: 'L', label: 'L 7%' },
                      { value: 'M', label: 'M 15%' },
                      { value: 'Q', label: 'Q 25%' },
                      { value: 'H', label: 'H 30%' },
                    ]}
                    value={cfg.errorLevel}
                    onChange={(v) => set('errorLevel', v)}
                  />
                  <p className="text-xs text-slate-400 mt-1.5">
                    Higher levels survive more damage and allow a larger logo, but make the code denser
                  </p>
                </div>
              </Section>

              <Section title="Logo">
                {!cfg.logo ? (
                  <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-all group">
                    <svg
                      className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 transition-colors mb-1"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                      />
                    </svg>
                    <span className="text-sm text-slate-500 group-hover:text-indigo-600">Click to upload an image</span>
                    <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <img
                        src={cfg.logo}
                        alt="Logo"
                        className="w-12 h-12 rounded-lg object-contain border border-slate-200 bg-white"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">Logo loaded</p>
                        <p className="text-xs text-slate-400">
                          {result ? `Plate: ${plateModules} modules (safe max ${result.maxPlate})` : '—'}
                        </p>
                      </div>
                      <button
                        onClick={removeLogo}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                        title="Remove logo"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {beyondSafe ? (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        <strong>Beyond the safe zone.</strong> The logo hides more data than error correction is
                        guaranteed to recover. It may still scan, but test it with several phones and scanner apps
                        before printing.
                      </p>
                    ) : result && result.maxPlate < 3 ? (
                      <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        This code is too small for a logo at level {cfg.errorLevel}. Use level H or add more content.
                      </p>
                    ) : (
                      cfg.errorLevel !== 'H' &&
                      result && (
                        <p className="text-xs text-amber-600">
                          Max for level {cfg.errorLevel}: {result.maxPlate}×{result.maxPlate} modules. Switch to H for a
                          larger logo.
                        </p>
                      )
                    )}

                    <Slider
                      label="Size (100% = safe maximum)"
                      value={cfg.plateSize}
                      min={0}
                      max={200}
                      display={`${cfg.plateSize}%${beyondSafe ? ' ⚠' : ''}`}
                      onChange={(v) => set('plateSize', v)}
                    />
                    <Slider
                      label="Padding"
                      value={cfg.platePadding}
                      min={0}
                      max={30}
                      onChange={(v) => set('platePadding', v)}
                    />
                    <Slider
                      label="Corner radius"
                      value={cfg.plateRadius}
                      min={0}
                      max={50}
                      onChange={(v) => set('plateRadius', v)}
                    />
                    <Slider
                      label="Border width"
                      value={cfg.borderWidth}
                      min={0}
                      max={1.5}
                      step={0.1}
                      display={`${cfg.borderWidth.toFixed(1)} modules`}
                      onChange={(v) => set('borderWidth', v)}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <ColorField label="Border color" value={cfg.borderColor} onChange={(v) => set('borderColor', v)} />
                      <ColorField
                        label="Plate color"
                        value={cfg.plateBg ?? cfg.bgColor}
                        onChange={(v) => set('plateBg', v)}
                        displayValue={cfg.plateBg ?? (cfg.transparentBg ? 'none' : 'auto')}
                      />
                    </div>
                    {cfg.plateBg && (
                      <button
                        type="button"
                        onClick={() => set('plateBg', null)}
                        className="text-xs text-indigo-600 hover:underline"
                      >
                        Reset plate color to match the background
                      </button>
                    )}
                  </div>
                )}
              </Section>

              <Section title="Export">
                <div>
                  <Label>PNG resolution</Label>
                  <Segmented
                    options={[512, 1024, 2048, 4096].map((r) => ({ value: r, label: String(r) }))}
                    value={cfg.pngResolution}
                    onChange={(v) => set('pngResolution', v)}
                  />
                </div>
                <div>
                  <Label>Link with this configuration</Label>
                  <p className="text-xs text-slate-400 mb-3">
                    Opening the link restores these settings and immediately downloads the selected files. The logo is
                    not included.
                  </p>
                  <div className="flex flex-wrap items-center gap-4 mb-3">
                    {(['png', 'svg'] as const).map((f) => (
                      <label key={f} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={linkFormats.includes(f)}
                          onChange={(e) =>
                            setLinkFormats((cur) => (e.target.checked ? [...cur, f] : cur.filter((x) => x !== f)))
                          }
                          className="w-4 h-4 accent-indigo-600"
                        />
                        {f.toUpperCase()}
                      </label>
                    ))}
                    <label className="flex items-center gap-2 text-sm text-slate-700 flex-1 min-w-40">
                      Sizes
                      <input
                        type="text"
                        value={linkSizes}
                        onChange={(e) => setLinkSizes(e.target.value)}
                        placeholder="512,1024,2048"
                        className={inputClass}
                      />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={configUrl}
                      onFocus={(e) => e.target.select()}
                      className={`${inputClass} font-mono text-xs`}
                    />
                    <button
                      type="button"
                      onClick={copyLink}
                      className="shrink-0 px-4 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 transition-all"
                    >
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  {cfg.logo && (
                    <p className="text-xs text-amber-600 mt-1.5">The logo is not part of the link.</p>
                  )}
                </div>
              </Section>
            </div>

            {/* Right: Preview & Download */}
            <div className="lg:w-[400px] shrink-0 p-6 sm:p-8 bg-slate-50/50">
              <div className="lg:sticky lg:top-8 flex flex-col items-center">
                <div
                  className={`rounded-2xl p-4 mb-6 ${cfg.transparentBg ? 'checkerboard' : ''}`}
                  style={{ backgroundColor: cfg.transparentBg ? undefined : cfg.bgColor }}
                >
                  {result ? (
                    <img
                      src={svgToDataUrl(result.svg)}
                      alt="QR code preview"
                      className="block"
                      style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, maxWidth: '100%' }}
                    />
                  ) : (
                    <div
                      className="flex items-center justify-center text-center text-sm text-slate-400 p-8"
                      style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, maxWidth: '100%' }}
                    >
                      {preview === 'too-big'
                        ? 'Too much data for a QR code. Shorten the content or lower the error correction level.'
                        : 'Fill in the fields to generate a QR code'}
                    </div>
                  )}
                </div>

                <div className="flex gap-3 w-full max-w-xs">
                  <button
                    onClick={downloadPNG}
                    disabled={!result}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-xl font-semibold text-sm hover:bg-indigo-700 active:bg-indigo-800 transition-all shadow-sm hover:shadow disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-sm"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    PNG
                  </button>
                  <button
                    onClick={downloadSVG}
                    disabled={!result}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white text-slate-700 border-2 border-slate-300 rounded-xl font-semibold text-sm hover:border-indigo-400 hover:text-indigo-600 active:bg-indigo-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    SVG
                  </button>
                </div>

                <button
                  onClick={saveToHistory}
                  disabled={!result}
                  className="mt-4 flex items-center justify-center gap-2 w-full max-w-xs px-4 py-3 bg-emerald-600 text-white rounded-xl font-semibold text-sm hover:bg-emerald-700 active:bg-emerald-800 transition-all shadow-sm hover:shadow disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v4h8V3M7 21v-8h10v8" />
                  </svg>
                  Save configuration
                </button>

                {notice && (
                  <p className="mt-3 w-full max-w-xs text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                    {notice}
                  </p>
                )}

                <p className="text-xs text-slate-400 mt-3 text-center">
                  PNG: {cfg.pngResolution}×{cfg.pngResolution}px • SVG: scalable vector
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* History Panel */}
        {history.length > 0 && (
          <div className="mt-6 bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  History
                </h2>
                <span className="text-xs text-slate-400">
                  {history.length} {history.length === 1 ? 'saved item' : 'saved items'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="group relative flex gap-3 p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer bg-slate-50/50 hover:bg-indigo-50/30"
                    onClick={() => restoreFromHistory(item)}
                    title="Click to restore this configuration"
                  >
                    <div className="shrink-0">
                      <img
                        src={item.thumbnail}
                        alt="QR code"
                        className="w-16 h-16 rounded-lg border border-slate-200 bg-white object-contain"
                      />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <p className="text-sm font-medium text-slate-700 truncate" title={historyLabel(item)}>
                        {historyLabel(item)}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{formatDate(item.savedAt)}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span
                          className="w-3 h-3 rounded-full border border-slate-300"
                          style={{ backgroundColor: item.config.fgColor }}
                          title={`Color: ${item.config.fgColor}`}
                        />
                        <span
                          className="w-3 h-3 rounded-full border border-slate-300"
                          style={{ backgroundColor: item.config.transparentBg ? 'transparent' : item.config.bgColor }}
                          title={`Background: ${item.config.transparentBg ? 'transparent' : item.config.bgColor}`}
                        />
                        <span className="text-[10px] text-slate-400 font-mono">
                          {getContentType(item.config.contentType).label} • {item.config.errorLevel}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteFromHistory(item.id)
                      }}
                      className="absolute top-2 right-2 p-1 rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                      title="Remove from history"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          Generated in your browser • No data is sent to any server
        </p>
      </div>
    </div>
  )
}

export default App
