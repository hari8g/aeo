import * as THREE from 'three'
import { LAYOUT, ownerOf, hostDept } from './theme.js'
import { projectOverlay } from './project.js'

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function createTopicLayer(root, { onSelect } = {}) {
  const rail = document.createElement('div')
  rail.id = 'office-now'
  document.body.appendChild(rail)

  const floats = document.createElement('div')
  floats.id = 'office-topic-floats'
  root.appendChild(floats)

  const world = new Map()

  function items(state) {
    const features = state?.features ?? []
    const pinned = features.filter((f) => f.officeTopic)
    const extra = features.filter((f) => !f.officeTopic && f.state === 'doing')
    return [...pinned, ...extra]
  }

  function render(state) {
    const rows = items(state)
    rail.innerHTML = `
      <div class="office-now__kicker">Now in progress</div>
      <div class="office-now__row">
        ${
          rows.length
            ? rows
                .map((f) => {
                  const owner = ownerOf(f.owner) ?? ownerOf(f.hostDept)
                  const chip = owner?.chip ?? '#98A5EF'
                  const code = owner?.name ?? 'MPS'
                  return `<button type="button" class="office-now__chip" data-feature="${f.id}" style="--chip:${chip}">
                    <em>${escapeHtml(f.product || 'Topic')}</em>
                    <strong>${escapeHtml(code)}</strong>
                    <span>${escapeHtml(shortTitle(f.name))}</span>
                  </button>`
                })
                .join('')
            : '<p class="office-now__empty">No live topics yet.</p>'
        }
      </div>
    `
    rail.querySelectorAll('[data-feature]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-feature'))
        const feature = rows.find((f) => f.id === id)
        if (feature) onSelect?.(feature)
      })
    })

    floats.innerHTML = ''
    world.clear()
    const used = {}
    for (const f of rows.filter((x) => x.officeTopic || x.state === 'doing')) {
      const host = hostDept(f)
      const spec = LAYOUT[host]
      if (!spec) continue
      used[host] = (used[host] || 0) + 1
      const slot = used[host] - 1
      const owner = ownerOf(f.owner)
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'office-topic-card'
      el.style.setProperty('--chip', owner?.chip ?? '#98A5EF')
      el.innerHTML = `
        <div class="office-topic-card__top">
          <span class="office-topic-card__product">${escapeHtml(f.product || 'Live')}</span>
          <span class="office-topic-card__owner">${escapeHtml(owner?.name ?? 'MPS')}</span>
        </div>
        <strong>${escapeHtml(shortTitle(f.name))}</strong>
        <em>In progress</em>
      `
      el.addEventListener('click', () => onSelect?.(f))
      floats.appendChild(el)
      const lateral = (slot - (used[host] - 1) / 2) * 7.2
      world.set(el, new THREE.Vector3(spec.pos[0] + lateral, 6.4, spec.pos[1] + 1.2))
    }
  }

  function project(camera, renderer) {
    for (const [el, pos] of world) {
      projectOverlay(pos, camera, renderer, el, floats)
    }
  }

  render({ features: [] })
  return {
    rail,
    floats,
    render,
    project,
    destroy() {
      rail.remove()
      floats.remove()
    },
  }
}

function shortTitle(name) {
  return String(name ?? '')
    .replace(/^[^-—]+[-—]\s*/, '')
    .trim()
}
