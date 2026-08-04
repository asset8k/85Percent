'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Check, Loader2 } from 'lucide-react'
import { EASE_EXPO } from './motion/variants'
import { demoRequestSchema } from '@/lib/demoRequest'
import { site } from '@/content/site'

type Status = 'idle' | 'submitting' | 'success' | 'error'

/**
 * DemoRequestDialog — the motion-driven lead-capture modal every CTA opens
 * (spec §5b). Validates with the shared zod schema, carries a honeypot, and POSTs
 * to the server route `/api/demo-request` (which performs the anon-only Supabase
 * insert). The dialog never talks to Supabase directly.
 *
 * Accessibility: role="dialog" aria-modal, labelled by its title, Escape + backdrop
 * close, focus moves to the first field on open and restores to the opener on close,
 * and a Tab cycle kept inside the panel.
 */
export function DemoRequestDialog({
  open,
  onClose,
  source = 'navbar',
}: {
  open: boolean
  onClose: () => void
  source?: string
}) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<Element | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // Remember the opener, lock scroll, focus the first field, restore on close.
  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => firstFieldRef.current?.focus({ preventScroll: true }), 60)
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prevOverflow
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus({ preventScroll: true })
    }
  }, [open])

  // Reset transient state a beat after the exit animation when fully closed.
  useEffect(() => {
    if (open) return
    const t = window.setTimeout(() => {
      setStatus('idle')
      setError(null)
    }, 300)
    return () => window.clearTimeout(t)
  }, [open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    // Minimal focus trap: keep Tab within the panel's focusables.
    const panel = panelRef.current
    if (!panel) return
    const focusables = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus({ preventScroll: true })
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus({ preventScroll: true })
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const parsed = demoRequestSchema.safeParse({
      fullName: String(fd.get('fullName') ?? ''),
      workEmail: String(fd.get('workEmail') ?? ''),
      club: String(fd.get('club') ?? ''),
      role: String(fd.get('role') ?? ''),
      message: String(fd.get('message') ?? ''),
      company: String(fd.get('company') ?? ''), // honeypot
      source,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check the form and try again.')
      return
    }
    setStatus('submitting')
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      })
      if (!res.ok) {
        // Surface the server's own message when it sends one (e.g. the 429
        // rate-limit notice) rather than a generic fallback.
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setStatus('error')
        setError(body?.error ?? 'Something went wrong sending your request. Please try again.')
        return
      }
      setStatus('success')
    } catch {
      setStatus('error')
      setError('Something went wrong sending your request. Please try again.')
    }
  }

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
          onKeyDown={onKeyDown}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-charcoal/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE_EXPO }}
            onClick={onClose}
            aria-hidden
          />
          {/* Panel */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="relative w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-[0_24px_64px_-24px_rgba(15,18,32,0.45)] sm:p-8"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.985 }}
            transition={{ duration: 0.6, ease: EASE_EXPO }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={18} />
            </button>

            {status === 'success' ? (
              <div className="flex flex-col items-center py-6 text-center">
                <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-violet-tip text-white">
                  <Check size={22} />
                </span>
                <h2 id={titleId} className="font-display text-2xl font-semibold tracking-tight">
                  Request received.
                </h2>
                <p id={descId} className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Thank you. Our team will be in touch shortly to arrange your
                  access. For anything urgent, reach us at{' '}
                  <a className="text-primary hover:underline" href={`mailto:${site.contact.email}`}>
                    {site.contact.email}
                  </a>
                  .
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-6 rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate>
                <h2 id={titleId} className="font-display text-2xl font-semibold tracking-tight">
                  Request access
                </h2>
                <p id={descId} className="mt-1.5 text-sm text-muted-foreground">
                  Tell us about your club and we’ll arrange a walkthrough of the
                  Squad Cost Engine.
                </p>

                {/* Honeypot — visually hidden, off the tab order, not for humans. */}
                <div aria-hidden className="absolute left-[-9999px] top-[-9999px]" tabIndex={-1}>
                  <label>
                    Company
                    <input type="text" name="company" tabIndex={-1} autoComplete="off" />
                  </label>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="Full name"
                    name="fullName"
                    required
                    autoComplete="name"
                    inputRef={firstFieldRef}
                  />
                  <Field
                    label="Work email"
                    name="workEmail"
                    type="email"
                    required
                    autoComplete="email"
                  />
                  <Field label="Club / organisation" name="club" autoComplete="organization" />
                  <Field label="Role" name="role" placeholder="e.g. CFO, Sporting Director" />
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium" htmlFor="dr-message">
                    Anything specific?{' '}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <textarea
                    id="dr-message"
                    name="message"
                    rows={3}
                    className="mt-1.5 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30"
                  />
                </div>

                {error && (
                  <p role="alert" className="mt-3 text-sm text-[hsl(0_72%_45%)]">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-violet-tip px-5 py-3 text-sm font-medium text-white shadow-[0_8px_24px_-8px_rgba(109,40,217,0.6)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {status === 'submitting' && <Loader2 size={16} className="animate-spin" />}
                  {status === 'submitting' ? 'Sending…' : 'Request access'}
                </button>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  We’ll only use your details to arrange your access.
                </p>
              </form>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Field({
  label,
  name,
  type = 'text',
  required,
  placeholder,
  autoComplete,
  inputRef,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  placeholder?: string
  autoComplete?: string
  inputRef?: React.Ref<HTMLInputElement>
}) {
  const id = `dr-${name}`
  return (
    <div>
      <label className="block text-sm font-medium" htmlFor={id}>
        {label}
        {required && <span className="text-primary"> *</span>}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </div>
  )
}
