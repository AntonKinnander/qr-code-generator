import type { FieldValues } from './config'

export type FieldType = 'text' | 'textarea' | 'select' | 'checkbox' | 'datetime' | 'email' | 'tel' | 'url' | 'number'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  options?: { value: string; label: string }[]
  default?: string
  half?: boolean // render at half width
  showIf?: (v: FieldValues) => boolean
}

export interface ContentType {
  id: string
  label: string
  fields: FieldDef[]
  encode: (v: FieldValues) => string
}

// WIFI: and MECARD-style escaping
const wifiEsc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')
// vCard / iCalendar text escaping
const textEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1')
const digits = (s: string) => s.replace(/[^\d]/g, '')
const phone = (s: string) => s.replace(/[^\d+]/g, '')

function query(params: Record<string, string | undefined>): string {
  const q = Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&')
  return q ? `?${q}` : ''
}

// Joins property lines, skipping those whose value is empty
function lines(rows: [string, string | undefined][]): string {
  return rows
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join('\r\n')
}

// "2026-10-26T14:30" → "20261026T143000" (floating local time); all-day → "20261026"
function icalDate(v: string, allDay: boolean): string {
  const d = v.replace(/[-:]/g, '')
  if (allDay) return d.slice(0, 8)
  return d.length === 13 ? `${d}00` : d
}

// Decimal ETH → wei, without floating-point rounding
function toWei(amount: string): string {
  const [whole, frac = ''] = amount.trim().split('.')
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return ''
  return (BigInt(whole || '0') * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18))).toString()
}

export const CONTENT_TYPES: ContentType[] = [
  {
    id: 'url',
    label: 'Website',
    fields: [{ key: 'url', label: 'URL', type: 'url', placeholder: 'https://example.com', default: 'https://example.com' }],
    encode: (v) => {
      const url = (v.url ?? '').trim()
      if (!url) return ''
      return /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`
    },
  },
  {
    id: 'text',
    label: 'Text',
    fields: [{ key: 'text', label: 'Text', type: 'textarea', placeholder: 'Any text…' }],
    encode: (v) => v.text ?? '',
  },
  {
    id: 'email',
    label: 'Email',
    fields: [
      { key: 'to', label: 'Email address', type: 'email', placeholder: 'name@example.com' },
      { key: 'subject', label: 'Subject', type: 'text' },
      { key: 'body', label: 'Message', type: 'textarea' },
    ],
    encode: (v) => (v.to ? `mailto:${v.to.trim()}${query({ subject: v.subject, body: v.body })}` : ''),
  },
  {
    id: 'phone',
    label: 'Phone',
    fields: [{ key: 'number', label: 'Phone number', type: 'tel', placeholder: '+46 70 123 45 67' }],
    encode: (v) => (phone(v.number ?? '') ? `tel:${phone(v.number)}` : ''),
  },
  {
    id: 'sms',
    label: 'SMS',
    fields: [
      { key: 'number', label: 'Phone number', type: 'tel', placeholder: '+46 70 123 45 67' },
      { key: 'message', label: 'Message', type: 'textarea' },
    ],
    encode: (v) => {
      const num = phone(v.number ?? '')
      if (!num) return ''
      return v.message ? `SMSTO:${num}:${v.message}` : `SMSTO:${num}`
    },
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    fields: [
      { key: 'number', label: 'Phone number (with country code)', type: 'tel', placeholder: '+46 70 123 45 67' },
      { key: 'message', label: 'Prefilled message', type: 'textarea' },
    ],
    encode: (v) => (digits(v.number ?? '') ? `https://wa.me/${digits(v.number)}${query({ text: v.message })}` : ''),
  },
  {
    id: 'wifi',
    label: 'Wi-Fi',
    fields: [
      { key: 'ssid', label: 'Network name (SSID)', type: 'text' },
      { key: 'password', label: 'Password', type: 'text', showIf: (v) => v.security !== 'nopass' },
      {
        key: 'security',
        label: 'Security',
        type: 'select',
        default: 'WPA',
        half: true,
        options: [
          { value: 'WPA', label: 'WPA/WPA2/WPA3' },
          { value: 'WEP', label: 'WEP' },
          { value: 'nopass', label: 'None' },
        ],
      },
      { key: 'hidden', label: 'Hidden network', type: 'checkbox', half: true },
    ],
    encode: (v) => {
      if (!v.ssid) return ''
      const sec = v.security || 'WPA'
      const pass = sec !== 'nopass' && v.password ? `P:${wifiEsc(v.password)};` : ''
      return `WIFI:T:${sec};S:${wifiEsc(v.ssid)};${pass}${v.hidden === 'true' ? 'H:true;' : ''};`
    },
  },
  {
    id: 'vcard',
    label: 'Contact',
    fields: [
      { key: 'first', label: 'First name', type: 'text', half: true },
      { key: 'last', label: 'Last name', type: 'text', half: true },
      { key: 'org', label: 'Company', type: 'text', half: true },
      { key: 'title', label: 'Job title', type: 'text', half: true },
      { key: 'mobile', label: 'Mobile', type: 'tel', half: true },
      { key: 'work', label: 'Work phone', type: 'tel', half: true },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'url', label: 'Website', type: 'url' },
      { key: 'street', label: 'Street', type: 'text' },
      { key: 'zip', label: 'Postal code', type: 'text', half: true },
      { key: 'city', label: 'City', type: 'text', half: true },
      { key: 'country', label: 'Country', type: 'text' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
    encode: (v) => {
      const e = (k: string) => (v[k] ? textEsc(v[k]) : '')
      const name = [v.first, v.last].filter(Boolean).join(' ')
      if (!name && !v.org) return ''
      const hasAdr = v.street || v.city || v.zip || v.country
      return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        lines([
          ['N', `${e('last')};${e('first')};;;`],
          ['FN', textEsc(name || v.org)],
          ['ORG', e('org')],
          ['TITLE', e('title')],
          ['TEL;TYPE=CELL', phone(v.mobile ?? '')],
          ['TEL;TYPE=WORK,VOICE', phone(v.work ?? '')],
          ['EMAIL', v.email?.trim()],
          ['URL', v.url?.trim()],
          ['ADR;TYPE=WORK', hasAdr ? `;;${e('street')};${e('city')};;${e('zip')};${e('country')}` : ''],
          ['NOTE', e('note')],
        ]),
        'END:VCARD',
      ].join('\r\n')
    },
  },
  {
    id: 'location',
    label: 'Location',
    fields: [
      { key: 'lat', label: 'Latitude', type: 'number', placeholder: '59.3293', half: true },
      { key: 'lng', label: 'Longitude', type: 'number', placeholder: '18.0686', half: true },
      { key: 'label', label: 'Label', type: 'text', placeholder: 'Optional' },
      {
        key: 'format',
        label: 'Format',
        type: 'select',
        default: 'geo',
        options: [
          { value: 'geo', label: 'geo: (opens the default maps app)' },
          { value: 'google', label: 'Google Maps link' },
        ],
      },
    ],
    encode: (v) => {
      const lat = v.lat?.trim()
      const lng = v.lng?.trim()
      if (!lat || !lng) return ''
      if (v.format === 'google') return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
      return v.label ? `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(v.label)})` : `geo:${lat},${lng}`
    },
  },
  {
    id: 'event',
    label: 'Event',
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'start', label: 'Start', type: 'datetime', half: true },
      { key: 'end', label: 'End', type: 'datetime', half: true },
      { key: 'allDay', label: 'All-day event', type: 'checkbox' },
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
    encode: (v) => {
      if (!v.title || !v.start) return ''
      const allDay = v.allDay === 'true'
      const dt = allDay ? 'DTSTART;VALUE=DATE' : 'DTSTART'
      const de = allDay ? 'DTEND;VALUE=DATE' : 'DTEND'
      return [
        'BEGIN:VEVENT',
        lines([
          ['SUMMARY', textEsc(v.title)],
          [dt, icalDate(v.start, allDay)],
          [de, v.end ? icalDate(v.end, allDay) : ''],
          ['LOCATION', v.location ? textEsc(v.location) : ''],
          ['DESCRIPTION', v.description ? textEsc(v.description) : ''],
        ]),
        'END:VEVENT',
      ].join('\r\n')
    },
  },
  {
    id: 'app',
    label: 'App',
    fields: [
      {
        key: 'platform',
        label: 'Store',
        type: 'select',
        default: 'ios',
        options: [
          { value: 'ios', label: 'Apple App Store' },
          { value: 'android', label: 'Google Play' },
          { value: 'custom', label: 'Custom link (e.g. a smart link service)' },
        ],
      },
      {
        key: 'appId',
        label: 'App Store ID',
        type: 'text',
        placeholder: '1234567890',
        showIf: (v) => (v.platform || 'ios') === 'ios',
      },
      {
        key: 'package',
        label: 'Package name',
        type: 'text',
        placeholder: 'com.example.app',
        showIf: (v) => v.platform === 'android',
      },
      { key: 'url', label: 'URL', type: 'url', showIf: (v) => v.platform === 'custom' },
    ],
    encode: (v) => {
      const platform = v.platform || 'ios'
      if (platform === 'ios') return digits(v.appId ?? '') ? `https://apps.apple.com/app/id${digits(v.appId)}` : ''
      if (platform === 'android') {
        return v.package?.trim() ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(v.package.trim())}` : ''
      }
      return v.url?.trim() ?? ''
    },
  },
  {
    id: 'crypto',
    label: 'Crypto',
    fields: [
      {
        key: 'coin',
        label: 'Currency',
        type: 'select',
        default: 'bitcoin',
        half: true,
        options: [
          { value: 'bitcoin', label: 'Bitcoin' },
          { value: 'ethereum', label: 'Ethereum' },
          { value: 'litecoin', label: 'Litecoin' },
          { value: 'bitcoincash', label: 'Bitcoin Cash' },
        ],
      },
      { key: 'amount', label: 'Amount', type: 'number', half: true, placeholder: 'Optional' },
      { key: 'address', label: 'Wallet address', type: 'text' },
      { key: 'label', label: 'Label', type: 'text', showIf: (v) => v.coin !== 'ethereum' },
      { key: 'message', label: 'Message', type: 'text', showIf: (v) => v.coin !== 'ethereum' },
    ],
    encode: (v) => {
      const addr = v.address?.trim()
      if (!addr) return ''
      const coin = v.coin || 'bitcoin'
      if (coin === 'ethereum') {
        const wei = v.amount ? toWei(v.amount) : ''
        return `ethereum:${addr}${wei ? `?value=${wei}` : ''}`
      }
      return `${coin}:${addr}${query({ amount: v.amount?.trim(), label: v.label, message: v.message })}`
    },
  },
  {
    id: 'epc',
    label: 'SEPA payment',
    fields: [
      { key: 'name', label: 'Beneficiary name', type: 'text' },
      { key: 'iban', label: 'IBAN', type: 'text', placeholder: 'SE45 5000 0000 0583 9825 7466' },
      { key: 'bic', label: 'BIC', type: 'text', half: true, placeholder: 'Optional in the EEA' },
      { key: 'amount', label: 'Amount (EUR)', type: 'number', half: true },
      { key: 'reference', label: 'Reference / message', type: 'text' },
    ],
    // European Payments Council QR ("GiroCode"), version 002, UTF-8
    encode: (v) => {
      const iban = (v.iban ?? '').replace(/\s/g, '').toUpperCase()
      if (!v.name || !iban) return ''
      const amount = parseFloat(v.amount ?? '')
      return [
        'BCD',
        '002',
        '1',
        'SCT',
        (v.bic ?? '').replace(/\s/g, '').toUpperCase(),
        v.name.slice(0, 70),
        iban,
        amount > 0 ? `EUR${amount.toFixed(2)}` : '',
        '',
        '',
        (v.reference ?? '').slice(0, 140),
      ]
        .join('\n')
        .trimEnd()
    },
  },
]

export function getContentType(id: string): ContentType {
  return CONTENT_TYPES.find((t) => t.id === id) ?? CONTENT_TYPES[0]
}

export function fieldsWithDefaults(type: ContentType, values: FieldValues | undefined): FieldValues {
  const out: FieldValues = {}
  for (const f of type.fields) out[f.key] = values?.[f.key] ?? f.default ?? ''
  return out
}
