import { forwardRef, useState, useEffect } from 'react'

function fmt(n: number): string {
  if (n == null || !isFinite(n)) return ''
  return Math.round(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })
}

interface Props {
  value: number
  onChange: (n: number) => void
  onBlur?: () => void
  className?: string
  max?: number
}

export const NumericInput = forwardRef<HTMLInputElement, Props>(
  function NumericInput({ value, onChange, onBlur, className, max }, ref) {
    const [focused, setFocused] = useState(false)
    const [display, setDisplay] = useState(() => fmt(value))

    // Sync display when form value changes externally (e.g. loaded from DB)
    useEffect(() => {
      if (!focused) setDisplay(fmt(value))
    }, [value, focused])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const digits = e.target.value.replace(/[^\d]/g, '')
      if (!digits) {
        setDisplay('')
        onChange(NaN)
        return
      }
      const n = parseInt(digits, 10)
      setDisplay(n.toLocaleString('en-GB', { maximumFractionDigits: 0 }))
      onChange(n)
    }

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          if (max != null && isFinite(value) && value > max) {
            setDisplay(fmt(max))
            onChange(max)
          }
          onBlur?.()
        }}
        className={className}
      />
    )
  }
)
