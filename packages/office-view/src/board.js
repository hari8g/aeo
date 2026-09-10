import { DEPTS, PHASE_ORDER, PHASE_TO_DEPT } from './theme.js'

const ROWS = [
  { id: 'sched', label: 'Scheduled' },
  { id: 'next', label: 'Backlog' },
  { id: 'doing', label: 'In progress' },
  { id: 'waiting', label: 'Waiting on approval' },
  { id: 'done', label: 'Done' },
]

export function createBoard({ onSelect }) {
  const el = document.createElement('div')
  el.id = 'office-board'
  el.hidden = true
  document.body.appendChild(el)

  function toggle() {
    el.hidden = !el.hidden
    return !el.hidden
  }

  function hide() {
    el.hidden = true
  }

  function render(state) {
    const features = state?.features ?? []
    el.innerHTML = `
      <div class="office-board__inner">
        <header>
          <div>
            <div class="kicker">Company board</div>
            <h2>Every feature · six departments</h2>
          </div>
          <button type="button" class="ghost" data-close>Close · B</button>
        </header>
        <div class="office-board__grid">
          <div class="cell head"></div>
          ${PHASE_ORDER.map((p) => {
            const d = DEPTS[PHASE_TO_DEPT[p]]
            return `<div class="cell head"><span class="dot" style="background:${d.chip}"></span>${d.name}<small>${d.full}</small></div>`
          }).join('')}
          ${ROWS.map((row) => {
            const cells = PHASE_ORDER.map((phase) => {
              const cards = features.filter((f) => {
                if (row.id === 'done') return (f.completedPhases ?? []).includes(phase) && f.phase !== phase
                return f.phase === phase && f.state === row.id
              })
              return `<div class="cell">${cards
                .map(
                  (f) =>
                    `<button type="button" class="chip${f.state === 'waiting' ? ' waiting' : ''}" data-feature="${f.id}">${escapeHtml(f.name)}</button>`,
                )
                .join('')}</div>`
            }).join('')
            return `<div class="cell rowlabel">${row.label}</div>${cells}`
          }).join('')}
        </div>
      </div>
    `
    el.querySelector('[data-close]')?.addEventListener('click', hide)
    el.querySelectorAll('[data-feature]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-feature'))
        const feature = features.find((f) => f.id === id)
        if (feature) onSelect?.(feature)
      })
    })
  }

  render({ features: [] })
  return { el, toggle, hide, render, isOpen: () => !el.hidden }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
