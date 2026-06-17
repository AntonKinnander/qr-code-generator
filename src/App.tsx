import { useState, useEffect, useRef, useCallback } from 'react'
import QRCode from 'qrcode'

interface HistoryItem {
  id: string
  text: string
  fgColor: string
  bgColor: string
  transparentBg: boolean
  logo: string | null
  logoSize: number
  errorLevel: 'L' | 'M' | 'Q' | 'H'
  pngResolution: number
  thumbnail: string
  savedAt: string
}

const HISTORY_KEY = 'qr-code-history'

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory(items: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items))
}

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

function App() {
  const [text, setText] = useState('https://example.com')
  const [fgColor, setFgColor] = useState('#000000')
  const [bgColor, setBgColor] = useState('#ffffff')
  const [transparentBg, setTransparentBg] = useState(false)
  const [logo, setLogo] = useState<string | null>(null)
  const [logoSize, setLogoSize] = useState(20) // percentage of QR code size
  const [errorLevel, setErrorLevel] = useState<'L' | 'M' | 'Q' | 'H'>('H')
  const [pngResolution, setPngResolution] = useState(1024)
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const QR_SIZE = pngResolution
  const PREVIEW_SIZE = 320

  const drawQRWithLogo = useCallback(
    async (canvas: HTMLCanvasElement, size: number) => {
      if (!text.trim()) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, size, size)
        }
        return
      }

      const effectiveBg = transparentBg ? 'rgba(0,0,0,0)' : bgColor

      try {
        await QRCode.toCanvas(canvas, text, {
          width: size,
          margin: 2,
          color: {
            dark: fgColor,
            light: transparentBg ? '#00000000' : bgColor,
          },
          errorCorrectionLevel: errorLevel,
        })

        // If transparent, clear the background
        if (transparentBg) {
          const ctx = canvas.getContext('2d')
          if (ctx) {
            const imageData = ctx.getImageData(0, 0, size, size)
            const data = imageData.data
            for (let i = 0; i < data.length; i += 4) {
              // Make near-white pixels transparent
              if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
                data[i + 3] = 0
              }
            }
            ctx.putImageData(imageData, 0, 0)
          }
        }

        // Draw logo if present
        if (logo) {
          const ctx = canvas.getContext('2d')
          if (ctx) {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve()
              img.onerror = reject
              img.src = logo
            })

            const logoSizePx = (size * logoSize) / 100
            const x = (size - logoSizePx) / 2
            const y = (size - logoSizePx) / 2
            const padding = logoSizePx * 0.1
            const radius = 8 * (size / PREVIEW_SIZE)

            // Draw white background behind logo with rounded corners
            ctx.save()
            ctx.beginPath()
            roundRect(ctx, x - padding, y - padding, logoSizePx + padding * 2, logoSizePx + padding * 2, radius)
            ctx.fillStyle = transparentBg ? 'rgba(255,255,255,0.95)' : effectiveBg
            ctx.fill()
            ctx.restore()

            // Draw logo with rounded corners
            ctx.save()
            ctx.beginPath()
            roundRect(ctx, x, y, logoSizePx, logoSizePx, radius * 0.7)
            ctx.clip()
            ctx.drawImage(img, x, y, logoSizePx, logoSizePx)
            ctx.restore()
          }
        }
      } catch {
        // Invalid QR data, ignore
      }
    },
    [text, fgColor, bgColor, transparentBg, logo, logoSize, errorLevel]
  )

  // Draw preview
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (canvas) {
      canvas.width = PREVIEW_SIZE
      canvas.height = PREVIEW_SIZE
      drawQRWithLogo(canvas, PREVIEW_SIZE)
    }
  }, [drawQRWithLogo])

  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  async function downloadPNG() {
    if (!text.trim()) return
    const canvas = document.createElement('canvas')
    canvas.width = QR_SIZE
    canvas.height = QR_SIZE
    await drawQRWithLogo(canvas, QR_SIZE)

    const link = document.createElement('a')
    link.download = 'qrcode.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  async function downloadSVG() {
    if (!text.trim()) return

    try {
      const svgString = await QRCode.toString(text, {
        type: 'svg',
        width: QR_SIZE,
        margin: 2,
        color: {
          dark: fgColor,
          light: transparentBg ? '#00000000' : bgColor,
        },
        errorCorrectionLevel: errorLevel,
      })

      // Parse SVG and add logo if present
      const parser = new DOMParser()
      const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
      const svgEl = svgDoc.documentElement

      if (transparentBg) {
        // Remove the background rect
        const rects = svgEl.querySelectorAll('rect')
        rects.forEach((rect) => {
          const fill = rect.getAttribute('fill')
          if (fill === '#00000000' || fill === 'transparent') {
            rect.remove()
          }
        })
        // Also remove path elements that represent the background
        const paths = svgEl.querySelectorAll('path')
        paths.forEach((path) => {
          const fill = path.getAttribute('fill')
          if (fill === '#00000000' || fill === 'transparent') {
            path.remove()
          }
        })
      }

      if (logo) {
        const logoSizePx = (QR_SIZE * logoSize) / 100
        const x = (QR_SIZE - logoSizePx) / 2
        const y = (QR_SIZE - logoSizePx) / 2
        const padding = logoSizePx * 0.1
        const radius = 8 * (QR_SIZE / PREVIEW_SIZE)

        // Add white background behind logo
        const bgRect = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'rect')
        bgRect.setAttribute('x', String(x - padding))
        bgRect.setAttribute('y', String(y - padding))
        bgRect.setAttribute('width', String(logoSizePx + padding * 2))
        bgRect.setAttribute('height', String(logoSizePx + padding * 2))
        bgRect.setAttribute('rx', String(radius))
        bgRect.setAttribute('ry', String(radius))
        bgRect.setAttribute('fill', transparentBg ? 'rgba(255,255,255,0.95)' : bgColor)
        svgEl.appendChild(bgRect)

        // Add clipPath for rounded corners
        const defs = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'defs')
        const clipPath = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'clipPath')
        clipPath.setAttribute('id', 'logo-clip')
        const clipRect = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'rect')
        clipRect.setAttribute('x', String(x))
        clipRect.setAttribute('y', String(y))
        clipRect.setAttribute('width', String(logoSizePx))
        clipRect.setAttribute('height', String(logoSizePx))
        clipRect.setAttribute('rx', String(radius * 0.7))
        clipRect.setAttribute('ry', String(radius * 0.7))
        clipPath.appendChild(clipRect)
        defs.appendChild(clipPath)
        svgEl.insertBefore(defs, svgEl.firstChild)

        // Embed logo as base64 image
        const image = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'image')
        image.setAttribute('x', String(x))
        image.setAttribute('y', String(y))
        image.setAttribute('width', String(logoSizePx))
        image.setAttribute('height', String(logoSizePx))
        image.setAttribute('href', logo)
        image.setAttribute('clip-path', 'url(#logo-clip)')
        svgEl.appendChild(image)
      }

      const serializer = new XMLSerializer()
      const finalSvg = serializer.serializeToString(svgEl)

      const blob = new Blob([finalSvg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = 'qrcode.svg'
      link.href = url
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      // Invalid QR data
    }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setLogo(ev.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  function removeLogo() {
    setLogo(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function saveToHistory() {
    if (!text.trim()) return

    // Generate a small thumbnail
    const thumbCanvas = document.createElement('canvas')
    const thumbSize = 128
    thumbCanvas.width = thumbSize
    thumbCanvas.height = thumbSize
    await drawQRWithLogo(thumbCanvas, thumbSize)
    const thumbnail = thumbCanvas.toDataURL('image/png')

    const item: HistoryItem = {
      id: genId(),
      text,
      fgColor,
      bgColor,
      transparentBg,
      logo,
      logoSize,
      errorLevel,
      pngResolution,
      thumbnail,
      savedAt: new Date().toISOString(),
    }

    const updated = [item, ...history]
    setHistory(updated)
    saveHistory(updated)
  }

  function restoreFromHistory(item: HistoryItem) {
    setText(item.text)
    setFgColor(item.fgColor)
    setBgColor(item.bgColor)
    setTransparentBg(item.transparentBg)
    setLogo(item.logo)
    setLogoSize(item.logoSize)
    setErrorLevel(item.errorLevel)
    setPngResolution(item.pngResolution)
  }

  function deleteFromHistory(id: string) {
    const updated = history.filter((item) => item.id !== id)
    setHistory(updated)
    saveHistory(updated)
  }

  function formatDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-start justify-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight">
            QR Code Generator
          </h1>
          <p className="text-slate-500 mt-2 text-sm sm:text-base">
            Gere QR Codes personalizados com logo, cores e fundo transparente
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="flex flex-col lg:flex-row">
            {/* Left: Controls */}
            <div className="flex-1 p-6 sm:p-8 space-y-6 border-b lg:border-b-0 lg:border-r border-slate-200">
              {/* Text Input */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Texto ou URL
                </label>
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Digite o texto ou URL..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 bg-slate-50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-sm"
                />
              </div>

              {/* Colors */}
              <div className="grid grid-cols-2 gap-4">
                <div className="min-w-0">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Cor do código
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="shrink-0">
                      <input
                        type="color"
                        value={fgColor}
                        onChange={(e) => setFgColor(e.target.value)}
                        className="w-10 h-10 rounded-lg cursor-pointer border-2 border-slate-200 hover:border-slate-300 transition-colors"
                      />
                    </div>
                    <input
                      type="text"
                      value={fgColor}
                      onChange={(e) => setFgColor(e.target.value)}
                      className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Cor do fundo
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="shrink-0">
                      <input
                        type="color"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        disabled={transparentBg}
                        className="w-10 h-10 rounded-lg cursor-pointer border-2 border-slate-200 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>
                    <input
                      type="text"
                      value={transparentBg ? 'transparent' : bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      disabled={transparentBg}
                      className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-slate-700 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>

              {/* Transparent Background Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-sm font-medium text-slate-700">
                  Fundo transparente
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={transparentBg}
                  onClick={() => setTransparentBg(!transparentBg)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                    transparentBg ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      transparentBg ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Error Correction Level */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Nível de correção de erro
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['L', 'M', 'Q', 'H'] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setErrorLevel(level)}
                      className={`py-2 rounded-lg text-sm font-medium transition-all ${
                        errorLevel === level
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1.5">
                  Use H (alto) ao adicionar logo para melhor leitura
                </p>
              </div>

              {/* PNG Resolution */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Resolução do PNG
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[512, 1024, 2048, 4096].map((res) => (
                    <button
                      key={res}
                      onClick={() => setPngResolution(res)}
                      className={`py-2 rounded-lg text-sm font-medium transition-all ${
                        pngResolution === res
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-1.5">
                  Tamanho em pixels do arquivo PNG exportado
                </p>
              </div>

              {/* Logo Upload */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Logo (opcional)
                </label>
                {!logo ? (
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
                    <span className="text-sm text-slate-500 group-hover:text-indigo-600">
                      Clique para enviar uma imagem
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <img
                        src={logo}
                        alt="Logo"
                        className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">
                          Logo carregado
                        </p>
                        <p className="text-xs text-slate-400">
                          Tamanho: {logoSize}%
                        </p>
                      </div>
                      <button
                        onClick={removeLogo}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                        title="Remover logo"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div>
                      <label className="flex items-center justify-between text-xs text-slate-500 mb-1">
                        <span>Tamanho do logo</span>
                        <span className="font-mono">{logoSize}%</span>
                      </label>
                      <input
                        type="range"
                        min="10"
                        max="40"
                        value={logoSize}
                        onChange={(e) => setLogoSize(Number(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-indigo-600"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Preview & Download */}
            <div className="flex-1 p-6 sm:p-8 flex flex-col items-center justify-center bg-slate-50/50">
              {/* QR Preview */}
              <div
                className={`rounded-2xl p-6 mb-6 ${
                  transparentBg ? 'checkerboard' : ''
                }`}
                style={{
                  backgroundColor: transparentBg ? undefined : bgColor,
                }}
              >
                <canvas
                  ref={previewCanvasRef}
                  width={PREVIEW_SIZE}
                  height={PREVIEW_SIZE}
                  className="block"
                  style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
                />
              </div>

              {/* Hidden canvas for high-res export */}
              <canvas
                ref={canvasRef}
                width={QR_SIZE}
                height={QR_SIZE}
                className="hidden"
              />

              {/* Download & Save Buttons */}
              <div className="flex gap-3 w-full max-w-xs">
                <button
                  onClick={downloadPNG}
                  disabled={!text.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 text-white rounded-xl font-semibold text-sm hover:bg-indigo-700 active:bg-indigo-800 transition-all shadow-sm hover:shadow disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  PNG
                </button>
                <button
                  onClick={downloadSVG}
                  disabled={!text.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white text-slate-700 border-2 border-slate-300 rounded-xl font-semibold text-sm hover:border-indigo-400 hover:text-indigo-600 active:bg-indigo-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  SVG
                </button>
              </div>

              {/* Save Button */}
              <button
                onClick={saveToHistory}
                disabled={!text.trim()}
                className="mt-4 flex items-center justify-center gap-2 w-full max-w-xs px-4 py-3 bg-emerald-600 text-white rounded-xl font-semibold text-sm hover:bg-emerald-700 active:bg-emerald-800 transition-all shadow-sm hover:shadow disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v4h8V3M7 21v-8h10v8" />
                </svg>
                Salvar Configuração
              </button>

              <p className="text-xs text-slate-400 mt-3 text-center">
                PNG: {pngResolution}×{pngResolution}px • SVG: vetorial escalável
              </p>
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
                  Histórico
                </h2>
                <span className="text-xs text-slate-400">
                  {history.length} {history.length === 1 ? 'item salvo' : 'itens salvos'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="group relative flex gap-3 p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer bg-slate-50/50 hover:bg-indigo-50/30"
                    onClick={() => restoreFromHistory(item)}
                    title="Clique para restaurar esta configuração"
                  >
                    {/* Thumbnail */}
                    <div className="shrink-0">
                      <img
                        src={item.thumbnail}
                        alt="QR Code"
                        className="w-16 h-16 rounded-lg border border-slate-200 bg-white object-contain"
                      />
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <p className="text-sm font-medium text-slate-700 truncate" title={item.text}>
                        {item.text}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatDate(item.savedAt)}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span
                          className="w-3 h-3 rounded-full border border-slate-300"
                          style={{ backgroundColor: item.fgColor }}
                          title={`Cor: ${item.fgColor}`}
                        />
                        <span
                          className="w-3 h-3 rounded-full border border-slate-300"
                          style={{ backgroundColor: item.transparentBg ? 'transparent' : item.bgColor }}
                          title={`Fundo: ${item.transparentBg ? 'transparente' : item.bgColor}`}
                        />
                        <span className="text-[10px] text-slate-400 font-mono">
                          {item.errorLevel} • {item.pngResolution}px
                        </span>
                      </div>
                    </div>
                    {/* Delete Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteFromHistory(item.id)
                      }}
                      className="absolute top-2 right-2 p-1 rounded-lg text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                      title="Remover do histórico"
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

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          Gerado no navegador • Nenhum dado é enviado para servidores
        </p>
      </div>
    </div>
  )
}

export default App
