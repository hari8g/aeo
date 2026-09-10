import * as THREE from 'three'
import { DEPTS, LAYOUT, PHASE_TO_DEPT } from './theme.js'
import { projectOverlay } from './project.js'

export function mountBadges(root, { onDept } = {}) {
  let host = root.querySelector('#office-badges')
  if (!host) {
    host = document.createElement('div')
    host.id = 'office-badges'
    root.appendChild(host)
  }
  host.innerHTML = ''
  const nodes = {}
  for (const id of Object.keys(DEPTS)) {
    const spec = LAYOUT[id]
    const d = DEPTS[id]
    const el = document.createElement('div')
    el.className = 'dept-badge'
    el.dataset.dept = id
    el.style.setProperty('--chip', d.chip)
    el.innerHTML = `
      <div class="dept-badge-code">${d.name}</div>
      <div class="dept-badge-role">${d.full}</div>
      <div class="dept-badge-count" data-count>0</div>
      <div class="dept-badge-live" hidden><span class="pip"></span> LIVE</div>
      <div class="dept-badge-wait" hidden>WAITING APPROVAL</div>
    `
    el.addEventListener('click', () => onDept?.(id))
    host.appendChild(el)
    nodes[id] = {
      el,
      count: el.querySelector('[data-count]'),
      live: el.querySelector('.dept-badge-live'),
      wait: el.querySelector('.dept-badge-wait'),
      world: new THREE.Vector3(spec.pos[0], 0.2, spec.pos[1] - spec.d / 2 - 1.4),
    }
  }
  return { host, nodes }
}

export function projectBadges(badges, camera, renderer) {
  for (const node of Object.values(badges.nodes)) {
    projectOverlay(node.world, camera, renderer, node.el, badges.host)
  }
}

export function updateBadges(badges, roster, state) {
  const byDept = Object.fromEntries(Object.keys(DEPTS).map((id) => [id, 0]))
  const live = Object.fromEntries(Object.keys(DEPTS).map((id) => [id, false]))
  const wait = Object.fromEntries(Object.keys(DEPTS).map((id) => [id, false]))
  for (const a of roster.agents || []) {
    if (byDept[a.dept] != null) byDept[a.dept] += 1
  }
  for (const a of state.agents || []) {
    if (a.status === 'busy' && live[a.dept] != null) live[a.dept] = true
    if (a.waitingApproval && wait[a.dept] != null) wait[a.dept] = true
  }
  for (const f of state.features || []) {
    const id = PHASE_TO_DEPT[f.phase]
    if (!id) continue
    if (f.state === 'waiting') wait[id] = true
    if (f.state === 'doing') live[id] = true
  }
  for (const [id, node] of Object.entries(badges.nodes)) {
    node.count.textContent = String(byDept[id] || 0)
    node.live.hidden = !live[id]
    node.wait.hidden = !wait[id]
  }
}
