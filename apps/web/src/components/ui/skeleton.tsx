import { cn } from '@/lib/utils'

// Animated shimmer block — base primitive for skeleton screens. Uses the
// `shimmer` keyframe defined in index.css. Compose into page-shaped layouts
// in each page's skeleton file rather than using this directly.
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn(
        'rounded-md bg-slate-200/70 overflow-hidden relative',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.4s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent',
        className,
      )}
    />
  )
}

// Convenience presets — used across page skeletons for consistency.
export function SkeletonText({ className }: { className?: string }) {
  return <Skeleton className={cn('h-3.5', className)} />
}

export function SkeletonNumber({ className }: { className?: string }) {
  return <Skeleton className={cn('h-7 w-24', className)} />
}

export function SkeletonCard({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 shadow-sm p-5', className)}>
      {children}
    </div>
  )
}
