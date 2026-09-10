import { DEPTS, PHASE_ORDER, PHASE_TO_DEPT, ownerOf } from './theme.js'

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
      <div class="office-panel__sub">Live topics · Listen → Learn</div>
      <div class="office-filters" data-filters>
        <button type="button" data-filter="doing" class="on">In progress</button>
        <button type="button" data-filter="">All</button>
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
  let chip = 'doing'

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
      return (
        !query ||
        [f.name, f.product, f.owner, f.summary]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
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
  const owner = ownerOf(f.owner)
  const meta = STATE_META[f.state] ?? STATE_META.next
  const doneN = (f.completedPhases ?? []).length
  const pct = Math.round((doneN / PHASE_ORDER.length) * 100)
  const dots = PHASE_ORDER.map((p) => {
    const done = (f.completedPhases ?? []).includes(p)
    const here = f.phase === p
    const d = DEPTS[PHASE_TO_DEPT[p]]
    return `<i class="mini ${done || here ? 'on' : ''}" style="background:${done || here ? d.chip : 'rgba(21,20,20,0.12)'}"></i>`
  }).join('')
  const ownerChip = owner
    ? `<span class="dept-code" style="--chip:${owner.chip}">${owner.name}</span>`
    : `<span class="dept" style="--chip:${dept.chip}">${dept.name}</span>`
  return `
    <button type="button" class="office-card ${f.state}${f.officeTopic ? ' topic' : ''}" data-feature="${f.id}">
      <div class="office-card__meta">
        <span class="pill ${meta.tone}">${meta.label}</span>
        ${ownerChip}
      </div>
      ${f.product ? `<span class="office-card__product">${escapeHtml(f.product)}</span>` : ''}
      <span class="office-card__name">${escapeHtml(f.name)}</span>
      ${f.summary ? `<span class="office-card__summary">${escapeHtml(f.summary)}</span>` : ''}
      <span class="office-card__path">${PHASE_LABEL[f.phase]} · ${escapeHtml(f.currentStage ?? '')}${owner ? ` · ${owner.full}` : ` · ${dept.full}`}</span>
      <span class="spine-mini">${dots}</span>
      <span class="office-card__bar"><i style="width:${pct}%;background:${owner?.chip ?? dept.chip}"></i></span>
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
