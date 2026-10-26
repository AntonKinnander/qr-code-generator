import type { ECLevel } from './config'

// Share of codewords each error-correction level can recover.
const RECOVERY: Record<ECLevel, number> = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 }

// A logo can hide modules only because error correction rebuilds them, and a
// hidden area damages more codewords than its share of modules suggests. Stay
// well under the theoretical limit.
const SAFETY = 0.6

// Largest centred logo plate, in whole modules, that keeps a symbol of
// `size` × `size` modules scannable. The result has the same parity as
// `size` so the plate stays centred on the module grid, and leaves the finder
// patterns, separators and timing lines (first 8 modules on each side) intact.
export function maxPlateModules(size: number, level: ECLevel): number {
  const dataModules = size * size - 3 * 64
  const byRecovery = Math.floor(Math.sqrt(dataModules * RECOVERY[level] * SAFETY))
  let s = Math.min(byRecovery, maxPlateGeometry(size))
  if (s % 2 !== size % 2) s -= 1
  return Math.max(s, 0)
}

// Hard cap regardless of error correction: a plate covering the finder
// patterns, separators or timing lines makes the code unreadable.
export function maxPlateGeometry(size: number): number {
  return Math.max(size - 2 * 8, 0)
}
