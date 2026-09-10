import * as THREE from 'three'
import { LAYOUT, hexToInt } from './theme.js'

const MARKS = {
  zendesk: { name: 'Zendesk', color: '#03363D', glyph: 'Z' },
  intercom: { name: 'Intercom', color: '#1F8DED', glyph: 'I' },
  slack: { name: 'Slack', color: '#4A154B', glyph: 'S' },
  hubspot: { name: 'HubSpot', color: '#FF7A59', glyph: 'H' },
}

export function createConnectorBar(scene) {
  const el = document.createElement('div')
  el.id = 'office-connectors'
  el.innerHTML = `<div class="office-connectors__label">I/O</div><div class="office-connectors__row"></div>`
  document.body.appendChild(el)
  const row = el.querySelector('.office-connectors__row')
  const wires = new THREE.Group()
  wires.name = 'connector-wires'
  scene.add(wires)

  let last = [
    { connector: 'zendesk', connected_at: null },
    { connector: 'intercom', connected_at: null },
    { connector: 'slack', connected_at: null },
  ]

  function render(list) {
    last = Array.isArray(list) && list.length ? list : last
    row.innerHTML = last
      .map((c) => {
        const id = c.connector ?? c.id
        const meta = MARKS[id] ?? { name: id, color: '#64748B', glyph: '?' }
        const on = !!c.connected_at
        return `<button type="button" class="office-logo${on ? ' on' : ''}" data-id="${id}" title="${meta.name}">
          <span class="swatch" style="background:${meta.color}">${meta.glyph}</span>
        </button>`
      })
      .join('')
  }

  function pulse(connector, dept) {
    const btn = row.querySelector(`[data-id="${connector}"]`)
    if (btn) {
      btn.classList.add('pulse')
      setTimeout(() => btn.classList.remove('pulse'), 900)
    }
    const layout = LAYOUT[dept]
    if (!layout) return
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 12, -36),
      new THREE.Vector3(layout.pos[0], 3.2, layout.pos[1]),
    ])
    const line = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({
        color: hexToInt((MARKS[connector] ?? { color: '#67e8f9' }).color),
        dashSize: 0.8,
        gapSize: 0.3,
        transparent: true,
        opacity: 0.85,
      }),
    )
    line.computeLineDistances()
    wires.add(line)
    setTimeout(() => {
      wires.remove(line)
      geo.dispose()
    }, 1200)
  }

  render(last)
  return { el, render, pulse }
}
