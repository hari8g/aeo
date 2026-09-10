import { DEPTS, LEGEND_ORDER, PHASE_TO_DEPT } from './theme.js'

export function createHud({ onDept } = {}) {
  const bar = document.createElement('div')
  bar.id = 'office-hud'
  bar.innerHTML = `
    <a class="office-hud__back" href="/">← Studio</a>
    <div class="office-hud__brand">
      <span class="mark"></span>
      <div>
        <strong>AEO Office</strong>
        <em>Bosch MPS · six departments</em>
      </div>
    </div>
    <div class="office-hud__live"><span class="pip"></span> Live flow</div>
    <div class="office-hud__metrics">
      <div class="metric"><b data-agents>0</b><span>Agents</span></div>
      <div class="metric"><b data-tasks>0</b><span>Features</span></div>
      <div class="metric"><b data-gates>0</b><span>Gates</span></div>
    </div>
    <div class="office-hud__clock" data-clock></div>
  `
  document.body.appendChild(bar)

  const legend = document.createElement('div')
  legend.id = 'office-legend'
  legend.innerHTML = `
    <div class="office-legend__kicker">Departments</div>
    <div class="office-legend__row">
      ${LEGEND_ORDER.map((id) => {
        const d = DEPTS[id]
        return `<button type="button" class="legend-chip" data-dept="${id}" style="--chip:${d.chip}">
          <span class="legend-chip__code">${d.name}</span>
          <span class="legend-chip__role">${d.full}</span>
        </button>`
      }).join('')}
    </div>
  `
  document.body.appendChild(legend)
  legend.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-dept]')
    if (btn) onDept?.(btn.getAttribute('data-dept'))
  })

  const clock = bar.querySelector('[data-clock]')
  const tick = () => {
    const now = new Date()
    clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  tick()
  const id = window.setInterval(tick, 1000)

  function render(state, rosterCount) {
    const features = state?.features ?? []
    const busy = new Set((state?.busyAgents ?? []).map((b) => b.agentId)).size
    bar.querySelector('[data-agents]').textContent = String(busy || rosterCount || 0)
    bar.querySelector('[data-tasks]').textContent = String(features.length)
    bar.querySelector('[data-gates]').textContent = String(
      features.filter((f) => f.state === 'waiting').length,
    )
    const live = new Set()
    for (const f of features) {
      if ((f.state === 'doing' || f.state === 'waiting') && PHASE_TO_DEPT[f.phase]) {
        live.add(PHASE_TO_DEPT[f.phase])
      }
    }
    for (const b of state?.busyAgents ?? []) {
      if (PHASE_TO_DEPT[b.domain]) live.add(PHASE_TO_DEPT[b.domain])
    }
    legend.querySelectorAll('[data-dept]').forEach((btn) => {
      btn.classList.toggle('live', live.has(btn.getAttribute('data-dept')))
    })
  }

  return {
    el: bar,
    legend,
    render,
    destroy() {
      window.clearInterval(id)
      bar.remove()
      legend.remove()
    },
  }
}
