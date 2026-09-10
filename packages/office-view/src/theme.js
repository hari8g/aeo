/** AEO office tokens — cream-paper office profile (visual language only). */

export const TOKENS = {
  cream: '#FDFFF8',
  ink: '#151414',
  grey: '#5A5A5A',
  hairline: 'rgba(21,20,20,0.12)',
  wood: '#DCC29A',
  white: '#F7F7F2',
  walk: '#EFEFE8',
}

export const DEPTS = {
  mkt: {
    name: 'MPS/MKT',
    short: 'MKT',
    phase: 'listen',
    full: 'Marketing',
    chip: '#5ADEB7',
    ink: '#1E9070',
    floor: '#C8EBD8',
  },
  cor: {
    name: 'MPS/COR',
    short: 'COR',
    phase: 'decide',
    full: 'Controlling',
    chip: '#98A5EF',
    ink: '#5B66CE',
    floor: '#C9D2F6',
  },
  px: {
    name: 'MPS/PAx',
    short: 'PAx',
    phase: 'define',
    full: 'Product owners',
    chip: '#BFA2E3',
    ink: '#7449A9',
    floor: '#D9C8F0',
  },
  eng: {
    name: 'MPS/ENG',
    short: 'ENG',
    phase: 'build',
    full: 'Engineering',
    chip: '#8FD3F4',
    ink: '#2E86AB',
    floor: '#B7E0F4',
  },
  gtm: {
    name: 'MPS/GTM',
    short: 'GTM',
    phase: 'ship',
    full: 'Go-to-market',
    chip: '#EADC8F',
    ink: '#A08A1E',
    floor: '#EFE4A8',
  },
  cx: {
    name: 'MPS/Cx',
    short: 'Cx',
    phase: 'learn',
    full: 'Leadership team',
    chip: '#E69393',
    ink: '#C46060',
    floor: '#F3C6C2',
  },
}

/** Audience-facing roster order */
export const LEGEND_ORDER = ['cor', 'eng', 'px', 'mkt', 'gtm', 'cx']

export function deptCaption(dept) {
  const d = typeof dept === 'string' ? DEPTS[dept] : dept
  if (!d) return ''
  return `${d.name} (${d.full})`
}

export const DEPT_ORDER = ['cor', 'gtm', 'eng', 'px', 'cx', 'mkt']
export const PHASE_ORDER = ['listen', 'decide', 'define', 'build', 'ship', 'learn']

export const PHASE_TO_DEPT = {
  listen: 'mkt',
  decide: 'cor',
  define: 'px',
  build: 'eng',
  ship: 'gtm',
  learn: 'cx',
}

export const LAYOUT = {
  graph: { pos: [0, 0], w: 16, d: 16 },
  cor: { pos: [22, -16], w: 18, d: 22 },
  gtm: { pos: [0, -34], w: 18, d: 24 },
  eng: { pos: [-22, -16], w: 18, d: 24 },
  px: { pos: [-22, 16], w: 18, d: 24 },
  cx: { pos: [0, 34], w: 18, d: 22 },
  mkt: { pos: [22, 16], w: 18, d: 24 },
}

export const KIND_TO_PHASE = {
  CUSTOMER_SIGNAL: 'listen',
  PAIN_POINT: 'listen',
  MARKET_SIGNAL: 'listen',
  COMPETITOR_MOVE: 'listen',
  REGULATORY_SIGNAL: 'listen',
  TREND: 'listen',
  BUSINESS_CASE: 'decide',
  KPI_TARGET: 'decide',
  VALUE_MODEL: 'decide',
  VALUE_LEVER: 'decide',
  HYPOTHESIS: 'decide',
  STRATEGY_BET: 'decide',
  ESTIMATE: 'decide',
  EFFORT_BAND: 'decide',
  PORTFOLIO_DECISION: 'decide',
  FEATURE: 'decide',
  BRIEF: 'decide',
  BUSINESS_IMPACT: 'decide',
  VALUE_HYPOTHESIS: 'decide',
  GTM_PROJECTION: 'decide',
  SEGMENT: 'decide',
  DEV_IMPACT: 'decide',
  EFFORT_ESTIMATE: 'decide',
  PORTFOLIO_PACKET: 'decide',
  DECISION_RECORD: 'decide',
  REQUIREMENT: 'define',
  ACCEPTANCE_CRITERION: 'define',
  USER_STORY: 'define',
  DOMAIN_CONCEPT: 'define',
  GLOSSARY_TERM: 'define',
  KPI: 'define',
  REGULATION: 'define',
  BUSINESS_RULE: 'define',
  ARCHITECTURE: 'define',
  COMPONENT: 'define',
  INTERFACE: 'define',
  BOUNDED_CONTEXT: 'define',
  SERVICE_INTERFACE: 'define',
  CODE_ARTIFACT: 'build',
  CHANGESET: 'build',
  CODE_FILE: 'build',
  IMPLEMENTATION_NOTE: 'build',
  TEST_EVIDENCE: 'build',
  DEFECT: 'build',
  TEST_SUITE: 'build',
  TEST_CASE: 'build',
  TEST_RUN: 'build',
  DOCUMENTATION: 'build',
  RUNBOOK_STUB: 'build',
  CHANGELOG: 'build',
  SECURITY_SCAN: 'ship',
  CVE_FINDING: 'ship',
  COMPLIANCE_CHECK: 'ship',
  BUILD_RUN: 'ship',
  PIPELINE_STEP: 'ship',
  BUILD: 'ship',
  IAC_CHANGESET: 'ship',
  COST_FORECAST: 'ship',
  COST_ANOMALY: 'ship',
  COST_ESTIMATE: 'ship',
  COST_ALERT: 'ship',
  RELEASE_CANDIDATE: 'ship',
  RELEASE_NOTE: 'ship',
  READINESS_REPORT: 'ship',
  DEPLOYMENT: 'ship',
  ENV_TARGET: 'ship',
  SLO: 'ship',
  SLO_BREACH: 'ship',
  INCIDENT: 'ship',
  KPI_OBSERVATION: 'ship',
  NOTIFICATION: 'ship',
  VERDICT: 'learn',
  OUTCOME: 'learn',
  HYPOTHESIS_VERDICT: 'learn',
  STAKEHOLDER_IMPACT: 'learn',
  SENTIMENT: 'learn',
  IMPACT_ASSESSMENT: 'learn',
  LESSON: 'learn',
  PLAYBOOK_UPDATE: 'learn',
  LEARNING: 'learn',
  CALIBRATION: 'learn',
  CALIBRATION_RECORD: 'learn',
  DRIFT_ALERT: 'learn',
}

export const THEMES = {
  light: {
    cream: 0xfdfff8,
    ground: 0xfdfff8,
    fog: 0xf2f3ea,
    wall: 0xf7f7f2,
    desk: 0x3e4048,
    deskTop: 0xdcc29a,
    ink: '#151414',
    muted: '#5A5A5A',
  },
  dark: {
    cream: 0x151619,
    ground: 0x151619,
    fog: 0x0e0f12,
    wall: 0x1b1c21,
    desk: 0x2a2b30,
    deskTop: 0x6b5a45,
    ink: '#ECEAE3',
    muted: '#A8A69E',
  },
}

const SKINS = ['#F3D1B3', '#E8B98E', '#F0C9A0', '#C68B59', '#F5D5B0', '#D89F70', '#E0A878', '#C9956C']
const HAIRS = ['#1c1c1c', '#2b2b2b', '#3b2b1d', '#5a2d0c', '#7a3b12', '#4a2a10', '#111111', '#6b3f2a', '#2a1c14', '#8a5a32']
const EYES = ['#3d2914', '#5b3a1c', '#2e5a3c', '#3a5c7a', '#4a3728', '#1f3d4d']
const STYLES = ['bangs', 'side', 'short', 'crown']

export function lookFor(id, index = 0) {
  const s = String(id || index)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  const u = h >>> 0
  return {
    skin: SKINS[u % SKINS.length],
    hair: HAIRS[(u >>> 4) % HAIRS.length],
    eyes: EYES[(u >>> 8) % EYES.length],
    style: STYLES[(u >>> 12) % STYLES.length],
    glasses: (u >>> 16) % 5 === 0,
    lip: (u >>> 20) % 2 === 0 ? '#c97b7b' : '#b56a62',
  }
}

export function hexToInt(hex) {
  return parseInt(String(hex).replace('#', ''), 16)
}

export function phaseColor(phase) {
  const dept = PHASE_TO_DEPT[phase]
  return dept ? DEPTS[dept].chip : '#64748B'
}
