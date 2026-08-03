/**
 * A stable card wrapper. The former pointer-driven 3D implementation continuously
 * recalculated transforms and glare while the cursor moved, which was costly on
 * Safari and offered no value on touch devices.
 */
export function TiltCard({
  children,
  className,
  max: _max,
  glare: _glare,
  enable: _enable,
}: {
  children: React.ReactNode
  className?: string
  max?: number
  glare?: boolean
  enable?: boolean
}) {
  return <div className={className}>{children}</div>
}
