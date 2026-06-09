'use client'

import Tilt from 'react-parallax-tilt'
import { useReducedMotion } from 'framer-motion'

/**
 * TiltCard — a restrained 3D parallax tilt for showcase panels, with a faint glare
 * sweep so a surface catches the light as the pointer crosses it (the "exquisite"
 * touch). Angles are kept small and the transition slow, in keeping with the heavy/
 * no-bounce doctrine. Disabled under reduced-motion or when `enable` is false.
 */
export function TiltCard({
  children,
  className,
  max = 6,
  glare = true,
  enable = true,
}: {
  children: React.ReactNode
  className?: string
  max?: number
  glare?: boolean
  enable?: boolean
}) {
  const reduce = useReducedMotion()
  const on = enable && !reduce

  return (
    <Tilt
      tiltEnable={on}
      tiltMaxAngleX={max}
      tiltMaxAngleY={max}
      perspective={1100}
      transitionSpeed={1600}
      scale={1.01}
      glareEnable={on && glare}
      glareMaxOpacity={0.12}
      glareColor="#ffffff"
      glarePosition="all"
      glareBorderRadius="16px"
      className={className}
    >
      {children}
    </Tilt>
  )
}
