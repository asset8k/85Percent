import type { ComplianceStatus } from '@headroom/shared'
import type { Thresholds } from './thresholds.js'

/**
 * Determine compliance status based on squad costs vs thresholds.
 * All values in pence.
 */
export function determineStatus(squadCosts: number, thresholds: Thresholds): ComplianceStatus {
  if (squadCosts <= thresholds.greenThreshold) return 'green'
  if (squadCosts <= thresholds.redThreshold) return 'amber'
  return 'red'
}
