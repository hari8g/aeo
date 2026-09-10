import { DEPTS, PHASE_ORDER, PHASE_TO_DEPT } from './theme.js'

const PHASE_LABEL = {
  listen: 'Listen',
  decide: 'Decide',
  define: 'Define',
  build: 'Build',
  ship: 'Ship',
  learn: 'Learn',
}

const STATE_META = {
  doing: { label: 'IN PROGRESS', tone: 'cyan' },
  waiting: { label: 'WAITING', tone: 'amber' },
  next: { label: 'QUEUED', tone: 'slate' },
  done: { label: 'DONE', tone: 'green' },
  sched: { label: 'SCHEDULED', tone: 'slate' },
}

export function createPanel({ onSelect, onGate }) {
  const el = document.createElement('aside')
  el.id = 'office-panel'
  el.innerHTML = `
    <div class="office-panel__head">
      <div class="office-panel__kicker">Task status</div>
      <div class="office-panel__title">Feature journey</div>
      <div class="office-panel__sub">Listen → Learn · live from the graph</div>
      <div class="office-filters" data-filters>
        <button type="button" class="on" data-filter="">All</button>
        <button type="button" data-filter="doing">In progress</button>
        <button type="button" data-filter="waiting">Waiting</button>
      </div>
      <label class="office-search">
        <span>filter</span>
        <input type="search" placeholder="Search features…" />
      </label>
    </div>
    <div class="office-panel__list"></div>
  `
  document.body.appendChild(el)
  const list = el.querySelector('.office-panel__list')
  const input = el.querySelector('input')
  let cache = []
  let chip = ''

  el.querySelector('[data-filters]').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-filter]')
    if (!btn) return
    chip = btn.getAttribute('data-filter') ?? ''
    el.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('on', b === btn))
    paint(input.value)
  })

  function render(state) {
    cache = state?.features ?? []
    paint(input.value)
  }

  function paint(q = '') {
    const query = q.trim().toLowerCase()
    const features = cache.filter((f) => {
      if (chip && f.state !== chip) return false
      return !query || String(f.name).toLowerCase().includes(query)
    })
    const ordered = [...features].sort((a, b) => rank(a.state) - rank(b.state))
    list.innerHTML = ordered.length
      ? ordered.map(cardHtml).join('')
      : `<p class="empty">No open features in this filter.</p>`
    list.querySelectorAll('[data-feature]').forEach((node) => {
      node.addEventListener('click', () => {
        const id = Number(node.getAttribute('data-feature'))
        const feature = cache.find((f) => f.id === id)
        if (!feature) return
        if (feature.state === 'waiting') onGate?.(feature)
        else onSelect?.(feature)
      })
    })
  }

  input.addEventListener('input', () => paint(input.value))
  input.addEventListener('keydown', (ev) => ev.stopPropagation())
  render({ features: [] })
  return { el, render }
}

function rank(state) {
  return { waiting: 0, doing: 1, next: 2, sched: 3, done: 4 }[state] ?? 5
}

function cardHtml(f) {
  const dept = DEPTS[PHASE_TO_DEPT[f.phase]] ?? DEPTS.cor
  const meta = STATE_META[f.state] ?? STATE_META.next
  const doneN = (f.completedPhases ?? []).length
  const pct = Math.round((doneN / PHASE_ORDER.length) * 100)
  const dots = PHASE_ORDER.map((p) => {
    const done = (f.completedPhases ?? []).includes(p)
    const here = f.phase === p
    const d = DEPTS[PHASE_TO_DEPT[p]]
    return `<i class="mini ${done || here ? 'on' : ''}" style="background:${done || here ? d.chip : 'rgba(21,20,20,0.12)'}"></i>`
  }).join('')
  return `
    <button type="button" class="office-card ${f.state}" data-feature="${f.id}">
      <div class="office-card__meta">
        <span class="pill ${meta.tone}">${meta.label}</span>
        <span class="dept" style="--chip:${dept.chip}">${dept.name} (${dept.full})</span>
      </div>
      <span class="office-card__name">${escapeHtml(f.name)}</span>
      <span class="office-card__path">${PHASE_LABEL[f.phase]} · ${escapeHtml(f.currentStage ?? '')}</span>
      <span class="spine-mini">${dots}</span>
      <span class="office-card__bar"><i style="width:${pct}%"></i></span>
      ${f.state === 'waiting' ? '<span class="await">01 awaiting your decision</span>' : ''}
    </button>
  `
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
