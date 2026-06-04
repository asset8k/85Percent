/** Small display formatters shared by the admin views. */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatUsd(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n ?? 0
  return usd.format(Number.isFinite(v) ? (v as number) : 0)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Coerce a posted form field to a trimmed string. */
export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
