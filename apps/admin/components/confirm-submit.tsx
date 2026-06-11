'use client'

import { Button, type ButtonProps } from '@/components/ui/button'

/** A submit button that requires a confirm() before the form posts. */
export function ConfirmSubmit({
  message,
  children,
  ...props
}: ButtonProps & { message: string }) {
  return (
    <Button
      type="submit"
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault()
      }}
      {...props}
    >
      {children}
    </Button>
  )
}
