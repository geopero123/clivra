import type { Transition, Variants } from 'motion/react'

export const spring: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }
export const springSoft: Transition = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 }
/** Slightly under-damped: overshoots like a drop of liquid settling. */
export const springLiquid: Transition = { type: 'spring', stiffness: 380, damping: 22, mass: 0.85 }
export const springSnappy: Transition = { type: 'spring', stiffness: 600, damping: 38, mass: 0.6 }
export const fast: Transition = { duration: 0.16, ease: [0.2, 0, 0, 1] }
export const base: Transition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] }

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: base },
  exit: { opacity: 0, y: -4, transition: fast }
}

export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 4 },
  show: { opacity: 1, scale: 1, y: 0, transition: springLiquid },
  exit: { opacity: 0, scale: 0.98, y: 2, transition: { duration: 0.12 } }
}
