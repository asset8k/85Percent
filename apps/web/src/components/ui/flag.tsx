/**
 * Flag — sharp SVG country flag, styled for the 85Percent UI Kit.
 *
 * Backed by `country-flag-icons` (MIT, pure SVG, ~30 KB gzipped) so the visual
 * is consistent across macOS, Windows and Linux — emoji flags vary platform
 * to platform and can't be styled. The 3:2 aspect matches the traditional
 * national-flag proportion; the slate ring + soft corner radius keeps it
 * visually anchored on white card surfaces without dominating the row.
 *
 * Returns `null` for unknown codes so callers can render unconditionally
 * without an `if`.
 */

import * as Flags from 'country-flag-icons/react/3x2'
import { cn } from '@/lib/utils'

interface FlagProps {
  code: string                 // ISO 3166-1 alpha-2 (e.g. "GB", "BR")
  className?: string
  title?: string               // hover tooltip — usually the country name
  // Size in pixels for the width; height is derived from 3:2 aspect.
  width?: number
}

export function Flag({ code, className, title, width = 18 }: FlagProps) {
  if (!code) return null
  const Component = Flags[code.toUpperCase() as keyof typeof Flags] as
    | React.ComponentType<{ title?: string; width?: number; className?: string }>
    | undefined
  if (!Component) return null
  return (
    <span
      title={title}
      className={cn(
        'inline-block overflow-hidden rounded-[2px] ring-1 ring-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex-shrink-0 align-middle',
        className
      )}
      style={{ width, height: (width / 3) * 2, lineHeight: 0 }}
    >
      <Component title={title} width={width} className="block" />
    </span>
  )
}
