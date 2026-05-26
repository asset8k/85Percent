import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  prefix?: string
  suffix?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, prefix, suffix, ...props }, ref) => {
    if (prefix || suffix) {
      return (
        <div className="relative flex items-center">
          {prefix && (
            <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none text-sm">
              {prefix}
            </span>
          )}
          <input
            type={type}
            className={cn(
              'num flex h-9 w-full rounded-lg border border-slate-200 bg-white text-slate-900 text-sm shadow-sm transition-colors placeholder:text-slate-400',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-transparent',
              'disabled:cursor-not-allowed disabled:opacity-50',
              prefix ? 'pl-7 pr-3' : 'px-3',
              suffix ? 'pr-10' : '',
              'py-2.5',
              className
            )}
            ref={ref}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 select-none pointer-events-none">
              {suffix}
            </span>
          )}
        </div>
      )
    }

    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors',
          'placeholder:text-slate-400',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-transparent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'
