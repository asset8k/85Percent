import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// AI credits are denominated in USD regardless of the workspace's display
// currency, so they always format as "$4.82" (two decimals).
const usdFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export function formatUsd(amount: number): string {
  return usdFormatter.format(Number.isFinite(amount) ? amount : 0)
}
