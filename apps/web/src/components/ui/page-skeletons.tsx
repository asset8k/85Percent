import { motion } from 'framer-motion'
import { Skeleton } from './skeleton'

// Per-page skeleton screens. Each one mirrors the actual page's layout so the
// content swap feels like the data filling in, not a screen replacement.
// All wrapped in a soft fade so first paint isn't jarring.
//
// Pattern note: we use fixed pixel heights for typographic skeletons (text
// rows, big numbers) so they don't shift as content loads, and percentage
// widths for fluid columns.

function FadeIn({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      {children}
    </motion.div>
  )
}

function SkeletonShellCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-5 ${className ?? ''}`}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export function DashboardSkeleton() {
  return (
    <FadeIn>
      {/* Page header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-200" />
        <div className="flex-1">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-72 mt-2" />
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonShellCard key={i}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-28 mt-3" />
            <Skeleton className="h-3 w-32 mt-3" />
          </SkeletonShellCard>
        ))}
      </div>

      {/* Main two-column */}
      <div className="grid grid-cols-[1fr_360px] gap-5">
        <SkeletonShellCard className="p-6">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-64 mt-2" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </SkeletonShellCard>
        <SkeletonShellCard className="p-6">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-24 mt-3" />
          <Skeleton className="h-3 w-40 mt-2" />
          <div className="mt-6 pt-5 border-t border-slate-100 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-32" />
          </div>
        </SkeletonShellCard>
      </div>
    </FadeIn>
  )
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------
export function RosterSkeleton() {
  return (
    <FadeIn>
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-200" />
        <div className="flex-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-80 mt-2" />
        </div>
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Tab strip */}
      <div className="flex gap-6 border-b border-slate-200 mb-5 pb-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 mb-4">
        {[40, 64, 36, 36, 36, 36].map((w, i) => (
          <Skeleton key={i} className="h-7 rounded-full" style={{ width: w }} />
        ))}
      </div>

      {/* Table */}
      <SkeletonShellCard className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 grid grid-cols-[1fr_80px_120px_120px_120px_120px] gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-3" />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-5 py-3.5 border-b border-slate-100 last:border-0 grid grid-cols-[1fr_80px_120px_120px_120px_120px] gap-4 items-center">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-6 rounded-sm" />
              <Skeleton className="h-3.5 w-32" />
            </div>
            <Skeleton className="h-5 w-12 rounded-md" />
            <Skeleton className="h-3.5 w-20 justify-self-end" />
            <Skeleton className="h-3.5 w-20 justify-self-end" />
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-16 justify-self-end" />
          </div>
        ))}
      </SkeletonShellCard>
    </FadeIn>
  )
}

// ---------------------------------------------------------------------------
// Scenarios — 320px rail + builder
// ---------------------------------------------------------------------------
export function ScenariosSkeleton() {
  return (
    <FadeIn>
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-200" />
        <div className="flex-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-96 mt-2" />
        </div>
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-5">
        <SkeletonShellCard>
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-6" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-24 mt-1.5" />
              </div>
            ))}
          </div>
        </SkeletonShellCard>

        <div className="flex flex-col gap-5">
          <SkeletonShellCard className="p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 w-32" />
            </div>
          </SkeletonShellCard>
          <SkeletonShellCard className="p-6">
            <div className="grid grid-cols-2 gap-4 mb-5">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-20 mt-3" />
                  <Skeleton className="h-3 w-32 mt-3" />
                </div>
              ))}
            </div>
            <Skeleton className="h-32 rounded-lg" />
          </SkeletonShellCard>
          <SkeletonShellCard className="p-5">
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-28" />
            </div>
            <Skeleton className="h-32 rounded-xl" />
          </SkeletonShellCard>
        </div>
      </div>
    </FadeIn>
  )
}

// ---------------------------------------------------------------------------
// SSR / Settings — generic two-column form skeleton
// ---------------------------------------------------------------------------
export function FormPageSkeleton() {
  return (
    <FadeIn>
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-200" />
        <div className="flex-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-80 mt-2" />
        </div>
      </div>
      <SkeletonShellCard className="p-6 mb-6">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="grid grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-10 w-full mt-2" />
              <Skeleton className="h-3 w-48 mt-2" />
            </div>
          ))}
        </div>
      </SkeletonShellCard>
    </FadeIn>
  )
}
