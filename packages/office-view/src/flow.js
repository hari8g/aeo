import * as THREE from 'three'
import { DEPTS, LAYOUT, PHASE_ORDER, PHASE_TO_DEPT, hexToInt, phaseColor } from './theme.js'
import { ADAPTERS } from './connectors.js'

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
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.42)
  const halo = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 140, 0.22, 10, true),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
    }),
  )
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 140, 0.055, 8, true),
    new THREE.MeshBasicMaterial({
      color: 0x151414,
      transparent: true,
      opacity: 0.28,
    }),
  )
  group.add(halo, tube)

  for (let i = 0; i < 6; i++) {
    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 14),
      new THREE.MeshBasicMaterial({
        color: hexToInt(phaseColor(PHASE_ORDER[i % PHASE_ORDER.length])),
        transparent: true,
        opacity: 0.95,
      }),
    )
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 12, 10),
      new THREE.MeshBasicMaterial({
        color: hexToInt(phaseColor(PHASE_ORDER[i % PHASE_ORDER.length])),
        transparent: true,
        opacity: 0.16,
      }),
    )
    group.add(bead, glow)
    beads.push({ mesh: bead, glow, u: i / 6, speed: 0.018 + (i % 3) * 0.004 })
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
    while (feed.children.length > 2) feed.lastChild.remove()
    window.setTimeout(() => row.classList.add('out'), 4200)
    window.setTimeout(() => row.remove(), 5000)
  }

  function spawn(from, to, color, label, tone) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 14, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.98 }),
    )
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18 }),
    )
    mesh.position.copy(from)
    aura.position.copy(from)
    group.add(mesh, aura)
    packets.push({
      mesh,
      aura,
      t: 0,
      from: from.clone(),
      to: to.clone(),
      trail: 0,
    })
    if (label) pushFeed(label, tone)
  }

  function spawnWrite(dept, label, quiet = false) {
    const d = DEPTS[dept] ?? DEPTS.cor
    const layout = LAYOUT[dept] ?? LAYOUT.cor
    spawn(
      new THREE.Vector3(layout.pos[0], 1.5, layout.pos[1]),
      new THREE.Vector3(0, 7.4, 0),
      hexToInt(d.chip),
      quiet ? null : label,
      d.chip,
    )
  }

  function spawnHop(fromPhase, toPhase, label, quiet = false) {
    const a = LAYOUT[PHASE_TO_DEPT[fromPhase]]
    const b = LAYOUT[PHASE_TO_DEPT[toPhase]]
    if (!a || !b) return
    spawn(
      new THREE.Vector3(a.pos[0], 2.2, a.pos[1]),
      new THREE.Vector3(b.pos[0], 2.2, b.pos[1]),
      hexToInt(phaseColor(toPhase)),
      quiet ? null : label,
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
      b.u = (b.u + dt * b.speed) % 1
      const p = curve.getPoint(b.u)
      b.mesh.position.copy(p)
      b.glow.position.copy(p)
      const phase = PHASE_ORDER[Math.floor(b.u * PHASE_ORDER.length) % PHASE_ORDER.length]
      const color = phaseColor(phase)
      b.mesh.material.color.set(color)
      b.glow.material.color.set(color)
      const pulse = 0.85 + Math.sin(b.u * Math.PI * 8) * 0.18
      b.mesh.scale.setScalar(pulse)
    }
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i]
      p.t += dt * 0.28
      const k = Math.min(1, p.t)
      p.mesh.position.lerpVectors(p.from, p.to, ease(k))
      p.mesh.position.y += Math.sin(k * Math.PI) * 4.1
      p.aura.position.copy(p.mesh.position)
      const s = 0.7 + Math.sin(k * Math.PI) * 0.7
      p.mesh.scale.setScalar(s)
      p.aura.scale.setScalar(1.15 + Math.sin(k * Math.PI) * 0.8)
      p.mesh.material.opacity = 1 - k * 0.2
      p.aura.material.opacity = 0.2 * (1 - k)
      p.trail += dt
      if (p.trail > 0.09 && k < 0.88 && !p.spark) {
        p.trail = 0
        const spark = new THREE.Mesh(
          new THREE.SphereGeometry(0.11, 8, 6),
          new THREE.MeshBasicMaterial({
            color: p.mesh.material.color,
            transparent: true,
            opacity: 0.45,
          }),
        )
        spark.position.copy(p.mesh.position)
        group.add(spark)
        packets.push({
          mesh: spark,
          aura: spark,
          t: 0.72,
          from: spark.position.clone(),
          to: spark.position.clone(),
          trail: 99,
          spark: true,
        })
      }
      if (k >= 1) {
        group.remove(p.mesh)
        p.mesh.geometry.dispose()
        if (p.aura !== p.mesh) {
          group.remove(p.aura)
          p.aura.geometry.dispose()
        }
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
    if (acc < 2.4) return
    acc = 0
    const { roster, state, pulse, pulseIo } = getState()
    const features = (state?.features ?? []).filter((f) => f.state === 'doing' || f.officeTopic)
    const poolAll = roster?.agents ?? []
    const f = features[i % Math.max(1, features.length)]
    const dept = f
      ? f.hostDept || PHASE_TO_DEPT[f.phase]
      : PHASE_TO_DEPT[PHASE_ORDER[i % PHASE_ORDER.length]]
    const pool = poolAll.filter((a) => a.dept === dept && !a.walker)
    const who = pool[i % Math.max(1, pool.length)]
    const label = f
      ? `${flow.shortName(who)} · ${f.product || f.name.split('—')[0].trim()}`
      : `${DEPTS[dept].name} · ${DEPTS[dept].full}`
    flow.spawnWrite(dept, label, true)
    if (who) pulse?.(who.id)
    if (i % 2 === 1) {
      const hopA = PHASE_ORDER[i % PHASE_ORDER.length]
      const hopB = PHASE_ORDER[(i + 1) % PHASE_ORDER.length]
      flow.spawnHop(hopA, hopB, `${hopA} → ${hopB}`, true)
    }
    if (i % 4 === 0) {
      const phase = f?.phase || DEPTS[dept]?.phase || PHASE_ORDER[i % PHASE_ORDER.length]
      const ioPool = ADAPTERS.filter((a) => a.phase === phase)
      const tools = ioPool.length ? ioPool : ADAPTERS
      const tool = tools[i % tools.length]
      if (tool) pulseIo?.(tool.id, PHASE_TO_DEPT[tool.phase] ?? dept)
    }
    i += 1
  }
  return { tick }
}
