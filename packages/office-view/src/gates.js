import { PHASE_TO_DEPT } from './theme.js'
import { waveLead } from './agents.js'

const GATE_HREF = {
  PORTFOLIO_GATE: '/portfolio',
  RELEASE_GATE: '/release',
}

export function applyGates(state, roster3d) {
  const waiting = (state?.features ?? []).filter((f) => f.state === 'waiting')
  const waved = new Set()
  for (const f of waiting) {
    const dept = PHASE_TO_DEPT[f.phase]
    if (dept && !waved.has(dept)) {
      waveLead(roster3d, dept)
      waved.add(dept)
    }
  }
  return waiting
}

export function gateHref(feature) {
  if (feature?.gateHref) return feature.gateHref
  if (feature?.gateKind && GATE_HREF[feature.gateKind]) return GATE_HREF[feature.gateKind]
  if (feature?.phase === 'decide') return '/portfolio'
  if (feature?.phase === 'ship') return '/release'
  return '/portfolio'
}

export function openGate(feature) {
  const href = gateHref(feature)
  window.location.href = href
}
