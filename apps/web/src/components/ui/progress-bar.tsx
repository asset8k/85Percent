import { motion, AnimatePresence } from 'framer-motion'
import { create } from 'zustand'

// Global lightweight "is something loading" tracker. Any async operation can
// call `progress.start()` / `progress.done()` to drive the top progress bar.
// Reference-counted so concurrent fetches don't blink the bar off prematurely.
interface ProgressState {
  count: number
  start: () => void
  done: () => void
}

export const useProgress = create<ProgressState>((set) => ({
  count: 0,
  start: () => set((s) => ({ count: s.count + 1 })),
  done: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
}))

/** Top progress bar. Mounted once at the layout root. */
export function ProgressBar() {
  const active = useProgress((s) => s.count > 0)
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="progress"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          className="fixed top-0 left-0 right-0 h-[2px] z-[100] pointer-events-none overflow-hidden"
        >
          <div
            className="h-full w-full origin-left"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, #8b5cf6 40%, #6d28d9 60%, transparent 100%)',
              animation: 'hr-progress-indeterminate 1.1s ease-in-out infinite',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
