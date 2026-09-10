import * as THREE from 'three'
import { DEPTS, LAYOUT, PHASE_ORDER, PHASE_TO_DEPT, hexToInt, phaseColor } from './theme.js'

function ease(t) {
  return t * t * (3 - 2 * t)
}

function shortName(agent) {
  return String(agent?.name ?? 'Agent')
    .replace(/\s+Agent$/i, '')
    .replace(/\s+Intelligence$/i, '')
}

export function createFlow(scene) {
  const group = new THREE.Group()
  group.name = 'flow'
  scene.add(group)
  const packets = []
  const beads = []

  const pts = PHASE_ORDER.map((p) => {
    const pos = LAYOUT[PHASE_TO_DEPT[p]].pos
    return new THREE.Vector3(pos[0], 2.15, pos[1])
  })
  pts.push(pts[0].clone())
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.35)
  const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 96, 0.07, 8, true),
    new THREE.MeshBasicMaterial({
      color: 0x151414,
      transparent: true,
      opacity: 0.18,
    }),
  )
  group.add(tube)

  for (let i = 0; i < 3; i++) {
    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 14, 12),
      new THREE.MeshBasicMaterial({ color: hexToInt(phaseColor(PHASE_ORDER[i * 2])) }),
    )
    group.add(bead)
    beads.push({ mesh: bead, u: i / 3 })
  }

  const feed = document.createElement('div')
  feed.id = 'office-feed'
  document.body.appendChild(feed)

  function pushFeed(text, tone) {
    const row = document.createElement('div')
    row.className = 'office-feed__row'
    if (tone) row.style.setProperty('--chip', tone)
    row.innerHTML = `<span class="pip"></span><span>${text}</span>`
    feed.prepend(row)
    while (feed.children.length > 5) feed.lastChild.remove()
    window.setTimeout(() => row.classList.add('out'), 4200)
    window.setTimeout(() => row.remove(), 5000)
  }

  function spawn(from, to, color, label, tone) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 12, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    )
    mesh.position.copy(from)
    group.add(mesh)
    packets.push({
      mesh,
      t: 0,
      from: from.clone(),
      to: to.clone(),
    })
    if (label) pushFeed(label, tone)
  }

  function spawnWrite(dept, label) {
    const d = DEPTS[dept] ?? DEPTS.cor
    const layout = LAYOUT[dept] ?? LAYOUT.cor
    spawn(
      new THREE.Vector3(layout.pos[0], 1.5, layout.pos[1]),
      new THREE.Vector3(0, 7.4, 0),
      hexToInt(d.chip),
      label,
      d.chip,
    )
  }

  function spawnHop(fromPhase, toPhase, label) {
    const a = LAYOUT[PHASE_TO_DEPT[fromPhase]]
    const b = LAYOUT[PHASE_TO_DEPT[toPhase]]
    if (!a || !b) return
    spawn(
      new THREE.Vector3(a.pos[0], 2.2, a.pos[1]),
      new THREE.Vector3(b.pos[0], 2.2, b.pos[1]),
      hexToInt(phaseColor(toPhase)),
      label,
      phaseColor(toPhase),
    )
  }

  function noteEvent(event, roster) {
    const domain = event?.domain || event?.metadata?.domain
    const dept = PHASE_TO_DEPT[domain] || event?.dept || 'cor'
    const kind = event?.kind || event?.type || event?.metadata?.kind || 'write'
    const agentId = event?.agentId || event?.agent_id || event?.metadata?.agentId
    const agent = (roster?.agents ?? []).find((a) => a.id === agentId)
    const who = agent ? shortName(agent) : DEPTS[dept]?.name || 'Agent'
    spawnWrite(dept, `${who} · ${String(kind).replace(/_/g, ' ').toLowerCase()} → graph`)
    return { dept, agentId: agent?.id }
  }

  function tick(dt) {
    for (const b of beads) {
      b.u = (b.u + dt * 0.045) % 1
      const p = curve.getPoint(b.u)
      b.mesh.position.copy(p)
      const phase = PHASE_ORDER[Math.floor(b.u * PHASE_ORDER.length) % PHASE_ORDER.length]
      b.mesh.material.color.set(phaseColor(phase))
    }
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i]
      p.t += dt * 0.62
      const k = Math.min(1, p.t)
      p.mesh.position.lerpVectors(p.from, p.to, ease(k))
      p.mesh.position.y += Math.sin(k * Math.PI) * 3.4
      const s = 0.75 + Math.sin(k * Math.PI) * 0.55
      p.mesh.scale.setScalar(s)
      p.mesh.material.opacity = 1 - k * 0.15
      if (k >= 1) {
        group.remove(p.mesh)
        p.mesh.geometry.dispose()
        packets.splice(i, 1)
      }
    }
  }

  return {
    spawnWrite,
    spawnHop,
    noteEvent,
    pushFeed,
    tick,
    shortName,
    destroy() {
      feed.remove()
      scene.remove(group)
    },
  }
}

export function createAmbient(flow, getState) {
  let acc = 0
  let i = 0
  function tick(dt, roster3d) {
    acc += dt
    if (acc < 2.15) return
    acc = 0
    const { roster, state, pulse } = getState()
    const features = state?.features ?? []
    const agents = roster?.agents ?? []
    const f = features[i % Math.max(1, features.length)]
    const dept = f ? PHASE_TO_DEPT[f.phase] : PHASE_TO_DEPT[PHASE_ORDER[i % PHASE_ORDER.length]]
    const pool = agents.filter((a) => a.dept === dept)
    const who = pool[i % Math.max(1, pool.length)]
    const label = f
      ? `${flow.shortName(who)} on ${f.name.split('—')[0].trim()}`
      : `${DEPTS[dept].name} · ${DEPTS[dept].full}`
    flow.spawnWrite(dept, label)
    if (who) pulse?.(who.id)
    if (i % 2 === 1) {
      const a = PHASE_ORDER[i % PHASE_ORDER.length]
      const b = PHASE_ORDER[(i + 1) % PHASE_ORDER.length]
      flow.spawnHop(a, b, `${a} → ${b}`)
    }
    i += 1
  }
  return { tick }
}
