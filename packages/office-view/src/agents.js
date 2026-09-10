import * as THREE from 'three'
import { DEPTS, LAYOUT, PHASE_ORDER, PHASE_TO_DEPT, hexToInt, lookFor } from './theme.js'
import fallbackRoster from './roster.fallback.json'
import generatedRoster from './roster.generated.json'
import { enrichRoster } from './floor.js'

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
  )
  m.position.set(x, y, z)
  m.castShadow = true
  return m
}

function sphere(r, color, x, y, z, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 18, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.62 }),
  )
  m.position.set(x, y, z)
  m.scale.set(sx, sy, sz)
  m.castShadow = true
  return m
}

function paintFace(ctx, look, expr) {
  const S = 256
  ctx.clearRect(0, 0, S, S)
  const skin = look.skin
  const hair = look.hair
  ctx.fillStyle = skin
  ctx.beginPath()
  ctx.ellipse(128, 142, 96, 108, 0, 0, Math.PI * 2)
  ctx.fill()

  const hl = ctx.createRadialGradient(108, 110, 10, 128, 140, 110)
  hl.addColorStop(0, 'rgba(255,255,255,0.22)')
  hl.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = hl
  ctx.fillRect(20, 20, 216, 216)

  ctx.fillStyle = hair
  if (look.style === 'bangs') {
    ctx.beginPath()
    ctx.ellipse(128, 78, 98, 62, 0, Math.PI, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(40, 92)
    ctx.quadraticCurveTo(90, 118, 128, 92)
    ctx.quadraticCurveTo(170, 118, 216, 92)
    ctx.lineTo(216, 70)
    ctx.lineTo(40, 70)
    ctx.fill()
  } else if (look.style === 'side') {
    ctx.beginPath()
    ctx.ellipse(128, 74, 96, 58, 0, Math.PI, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(38, 88)
    ctx.quadraticCurveTo(70, 140, 58, 188)
    ctx.quadraticCurveTo(48, 120, 42, 90)
    ctx.fill()
  } else if (look.style === 'crown') {
    ctx.beginPath()
    ctx.ellipse(128, 70, 92, 54, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(128, 48, 34, 22, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.ellipse(128, 82, 100, 64, 0, Math.PI, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = 'rgba(196, 96, 96, 0.16)'
  ctx.beginPath()
  ctx.ellipse(78, 168, 18, 10, 0, 0, Math.PI * 2)
  ctx.ellipse(178, 168, 18, 10, 0, 0, Math.PI * 2)
  ctx.fill()

  const browY = expr.busy ? 108 : 112
  ctx.strokeStyle = hair
  ctx.lineWidth = 7
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(72, browY)
  ctx.quadraticCurveTo(92, browY - (expr.busy ? 2 : 8), 112, browY)
  ctx.moveTo(144, browY)
  ctx.quadraticCurveTo(164, browY - (expr.busy ? 2 : 8), 184, browY)
  ctx.stroke()

  function eye(cx, cy) {
    if (expr.blink) {
      ctx.strokeStyle = '#5a3d32'
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(cx - 22, cy)
      ctx.quadraticCurveTo(cx, cy + 4, cx + 22, cy)
      ctx.stroke()
      return
    }
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.ellipse(cx, cy, 24, 18, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(21,20,20,0.18)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = look.eyes
    ctx.beginPath()
    ctx.ellipse(cx, cy + 1, 13, 13, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#151414'
    ctx.beginPath()
    ctx.arc(cx, cy + 1, 6.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(cx - 4, cy - 4, 4.2, 0, Math.PI * 2)
    ctx.fill()
  }
  eye(90, 134)
  eye(166, 134)

  ctx.fillStyle = 'rgba(90, 61, 50, 0.35)'
  ctx.beginPath()
  ctx.moveTo(128, 140)
  ctx.lineTo(122, 158)
  ctx.lineTo(134, 158)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = look.lip
  ctx.lineWidth = expr.wave ? 6 : 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  if (expr.wave) {
    ctx.moveTo(108, 178)
    ctx.quadraticCurveTo(128, 196, 148, 178)
  } else if (expr.busy) {
    ctx.moveTo(116, 180)
    ctx.lineTo(140, 180)
  } else {
    ctx.moveTo(112, 178)
    ctx.quadraticCurveTo(128, 188, 144, 178)
  }
  ctx.stroke()

  if (look.glasses) {
    ctx.strokeStyle = '#2a2b30'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.ellipse(92, 132, 24, 18, 0, 0, Math.PI * 2)
    ctx.ellipse(164, 132, 24, 18, 0, 0, Math.PI * 2)
    ctx.moveTo(116, 132)
    ctx.lineTo(140, 132)
    ctx.stroke()
  }
}

function makePerson(look, isLead, seed) {
  const g = new THREE.Group()
  const shirtColors = isLead ? 0x1a2744 : [0xf4f1e8, 0xe8eef6, 0xf6eadc, 0xe4f3e8][Math.floor(seed * 4)]
  g.add(box(0.62, 0.55, 0.36, shirtColors, 0, 0.3, 0.04))
  if (isLead) g.add(box(0.1, 0.3, 0.04, 0xc45c26, 0, 0.4, 0.22))

  const L = box(0.15, 0.44, 0.15, look.skin, -0.42, 0.42, 0.1)
  const R = box(0.15, 0.44, 0.15, look.skin, 0.42, 0.42, 0.1)
  L.name = 'armL'
  R.name = 'armR'
  g.add(L, R)

  const head = new THREE.Group()
  head.name = 'head'
  head.add(sphere(0.46, look.skin, 0, 0, 0, 1.02, 1.12, 0.95))
  const hair = sphere(0.4, look.hair, 0, 0.22, -0.12, 1.08, 0.42, 1.05)
  hair.material.roughness = 0.85
  head.add(hair)
  if (look.style === 'crown') head.add(sphere(0.14, look.hair, 0.02, 0.38, -0.08, 1.2, 0.7, 1))
  if (look.style === 'side') head.add(sphere(0.12, look.hair, -0.38, 0.02, 0, 0.7, 1.4, 0.7))

  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  paintFace(ctx, look, { blink: false, busy: false, wave: false })
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.98, 1.08),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0 }),
  )
  face.position.set(0, 0.04, 0.42)
  face.name = 'face'
  head.add(face)
  head.position.set(0, 1.28, 0.08)
  head.rotation.y = Math.PI / 4
  g.add(head)

  g.userData.look = look
  g.userData.faceCtx = ctx
  g.userData.faceTex = tex
  g.userData.seed = seed
  g.userData.blink = false
  return g
}

function makeChair(theme) {
  const g = new THREE.Group()
  const frame = theme === 'dark' ? 0x2a2b30 : 0x3e4048
  g.add(box(0.7, 0.08, 0.7, frame, 0, 0.42, 0))
  g.add(box(0.7, 0.55, 0.08, frame, 0, 0.72, -0.31))
  return g
}

function makeDesk(theme, chip) {
  const g = new THREE.Group()
  const top = theme === 'dark' ? 0x6b5a45 : 0xdcc29a
  const leg = theme === 'dark' ? 0x2a2b30 : 0xc9b089
  g.add(box(1.7, 0.08, 0.95, top, 0, 0.72, 0))
  g.add(box(0.08, 0.72, 0.08, leg, -0.74, 0.36, -0.38))
  g.add(box(0.08, 0.72, 0.08, leg, 0.74, 0.36, -0.38))
  g.add(box(0.08, 0.72, 0.08, leg, -0.74, 0.36, 0.38))
  g.add(box(0.08, 0.72, 0.08, leg, 0.74, 0.36, 0.38))
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.58, 0.04),
    new THREE.MeshStandardMaterial({
      color: 0xf4f1e6,
      roughness: 0.35,
      emissive: hexToInt(chip),
      emissiveIntensity: 0.05,
    }),
  )
  screen.position.set(0, 1.12, -0.28)
  screen.name = 'screen'
  screen.castShadow = true
  g.add(screen)
  return g
}

function slotsFor(spec, n) {
  const cols = n <= 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const gx = 3.4
  const gz = 3.6
  const cx = spec.pos[0]
  const cz = spec.pos[1]
  const out = []
  for (let i = 0; i < n; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    const rowWidth = Math.min(cols, n - r * cols)
    const x0 = cx - ((rowWidth - 1) * gx) / 2
    const z0 = cz - ((rows - 1) * gz) / 2
    out.push({
      x: x0 + (i % rowWidth) * gx,
      z: z0 + r * gz,
    })
  }
  return out
}

let RING = null
function ringCurve() {
  if (RING) return RING
  const pts = PHASE_ORDER.map((p) => {
    const pos = LAYOUT[PHASE_TO_DEPT[p]].pos
    return new THREE.Vector3(pos[0] * 0.62, 0.12, pos[1] * 0.62)
  })
  RING = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.55)
  return RING
}

function hashSeed(id) {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0
  return (h >>> 0) / 4294967295
}

export function buildAgents(scene, roster, theme) {
  const group = new THREE.Group()
  group.name = 'agents'
  const meshes = new Map()
  const byDept = {}
  const walkers = []
  for (const a of roster.agents || []) {
    if (a.walker) walkers.push(a)
    else (byDept[a.dept] ||= []).push(a)
  }

  for (const [deptId, agents] of Object.entries(byDept)) {
    const spec = LAYOUT[deptId]
    if (!spec) continue
    const slots = slotsFor(spec, agents.length)
    const face = Math.atan2(-spec.pos[0], -spec.pos[1])
    agents.forEach((agent, i) => {
      const look = lookFor(agent.id, i)
      const desk = makeDesk(theme, DEPTS[deptId].chip)
      const chair = makeChair(theme)
      const person = makePerson(look, Boolean(agent.lead), hashSeed(agent.id))
      const slot = slots[i]
      const station = new THREE.Group()
      station.position.set(slot.x, 0.12, slot.z)
      station.rotation.y = face
      desk.scale.setScalar(1.28)
      chair.scale.setScalar(1.22)
      person.scale.setScalar(1.62)
      desk.position.set(0, 0, 0)
      chair.position.set(0, 0, 0.82)
      person.position.set(0, 0, 0.62)
      desk.userData = { kind: 'desk', agentId: agent.id, dept: deptId }
      person.userData = {
        ...person.userData,
        kind: 'agent',
        agentId: agent.id,
        dept: deptId,
        lead: agent.lead,
        agent,
        home: new THREE.Vector3(slot.x, 0.12, slot.z),
        world: new THREE.Vector3(slot.x, 2.4, slot.z),
      }
      station.add(desk, chair, person)
      group.add(station)
      meshes.set(agent.id, { desk, person, agent, look, station })
    })
  }

  walkers.forEach((agent, i) => {
    const look = lookFor(agent.id, i + 20)
    const person = makePerson(look, false, hashSeed(agent.id))
    person.scale.setScalar(1.42)
    person.userData = {
      ...person.userData,
      kind: 'agent',
      agentId: agent.id,
      dept: agent.dept,
      agent,
      walker: true,
      u0: i / Math.max(1, walkers.length),
      world: new THREE.Vector3(),
    }
    group.add(person)
    meshes.set(agent.id, { desk: null, person, agent, look })
  })

  scene.add(group)
  return { group, meshes }
}

export function loadRosterSync() {
  const base = generatedRoster?.agents?.length ? generatedRoster : fallbackRoster
  return enrichRoster(base)
}

export function createRoster(scene, roster, theme) {
  const name = typeof theme === 'string' ? theme : theme?.cream === 0x151619 ? 'dark' : 'light'
  const built = buildAgents(scene, enrichRoster(roster), name)
  return {
    group: built.group,
    meshes: built.meshes,
    pickables: [...built.meshes.values()].map((r) => r.person),
  }
}

export function pickAgent(roster3d, raycaster) {
  const hits = raycaster.intersectObjects(roster3d.pickables ?? [], true)
  if (!hits.length) return null
  let obj = hits[0].object
  while (obj && obj.userData?.kind !== 'agent') obj = obj.parent
  return obj
}

export function setBusyAgents(roster3d, ids, liveDepts) {
  const set = new Set(ids)
  applyAgentState(roster3d.meshes, {
    agents: [...roster3d.meshes.values()].map((r) => ({
      id: r.agent.id,
      dept: r.agent.dept,
      status:
        set.has(r.agent.id) || (liveDepts?.has(r.agent.dept) && r.agent.officeExtra)
          ? 'busy'
          : 'idle',
    })),
  })
}

export function pulseAgent(roster3d, agentId, ms = 2400) {
  const rec = roster3d.meshes.get(agentId)
  if (!rec) return
  rec.person.userData.busy = true
  rec.person.userData.pose = 'type'
  rec.person.userData.pulseUntil = performance.now() + ms
  const screen = rec.desk?.getObjectByName('screen')
  if (screen) screen.material.emissiveIntensity = 0.85
  refreshFace(rec.person)
}

export function waveLead(roster3d, dept) {
  for (const rec of roster3d.meshes.values()) {
    if (rec.agent.dept === dept && rec.agent.lead) {
      rec.person.userData.pose = 'wave'
      refreshFace(rec.person)
    }
  }
}

export function applyAgentState(meshes, state) {
  const byId = Object.fromEntries((state.agents || []).map((a) => [a.id, a]))
  for (const [id, rec] of meshes) {
    const st = byId[id]
    const screen = rec.desk?.getObjectByName('screen')
    const busy = st?.status === 'busy' || rec.person.userData.pulseUntil > performance.now()
    if (screen) screen.material.emissiveIntensity = busy ? 0.85 : 0.05
    rec.person.userData.busy = busy
    rec.person.userData.pose = st?.pose || rec.person.userData.pose || 'idle'
    refreshFace(rec.person)
  }
}

function refreshFace(person) {
  const ctx = person.userData.faceCtx
  const look = person.userData.look
  if (!ctx || !look) return
  paintFace(ctx, look, {
    blink: Boolean(person.userData.blink),
    busy:
      Boolean(person.userData.busy) ||
      person.userData.pose === 'type' ||
      Boolean(person.userData.wasTyping),
    wave: person.userData.pose === 'wave',
  })
  person.userData.faceTex.needsUpdate = true
}

export function tickAgents(rosterOrMeshes, t, camera) {
  const meshes = rosterOrMeshes.meshes ?? rosterOrMeshes
  const now = performance.now()
  const cam = new THREE.Vector3()
  if (camera) camera.getWorldPosition(cam)
  const ring = ringCurve()
  for (const rec of meshes.values()) {
    const person = rec.person
    const seed = person.userData.seed || 0
    if (person.userData.walker) {
      const u = (t * (0.012 + seed * 0.006) + (person.userData.u0 || 0)) % 1
      const p = ring.getPoint(u)
      const tan = ring.getTangent(u)
      person.position.set(p.x, 0.12 + Math.abs(Math.sin(t * 5 + seed * 8)) * 0.04, p.z)
      person.rotation.y = Math.atan2(tan.x, tan.z)
      const Lw = person.getObjectByName('armL')
      const Rw = person.getObjectByName('armR')
      if (Lw && Rw) {
        Lw.rotation.x = Math.sin(t * 5 + seed) * 0.4
        Rw.rotation.x = Math.sin(t * 5 + seed + Math.PI) * 0.4
      }
      const headW = person.getObjectByName('head')
      if (headW) {
        headW.rotation.y = Math.sin(t * 0.6 + seed * 4) * 0.1
        headW.position.y = 1.28 + Math.sin(t * 5 + seed) * 0.012
      }
      person.userData.world.set(p.x, 2.2, p.z)
      continue
    }
    if (person.userData.pulseUntil && now > person.userData.pulseUntil && person.userData.pose === 'type') {
      person.userData.busy = false
      person.userData.pose = 'idle'
      const screen = rec.desk?.getObjectByName('screen')
      if (screen) screen.material.emissiveIntensity = 0.05
      refreshFace(person)
    }
    const L = person.getObjectByName('armL')
    const R = person.getObjectByName('armR')
    const head = person.getObjectByName('head')
    const cycle = (t * 0.16 + seed * 17) % 10
    const burst = cycle < 1.8
    const typing = person.userData.busy || person.userData.pose === 'type' || burst
    const glance = cycle > 6.2 && cycle < 6.8
    const blink = Math.sin(t * 1.6 + seed * 12) > 0.985
    if (blink !== person.userData.blink || typing !== person.userData.wasTyping) {
      person.userData.blink = blink
      person.userData.wasTyping = typing
      refreshFace(person)
    }
    if (L && R) {
      const pose = person.userData.pose
      if (pose === 'wave') {
        L.rotation.x = 0
        R.rotation.x = -1.05 + Math.sin(t * 6) * 0.4
      } else if (typing) {
        L.rotation.x = Math.sin(t * 6 + seed * 3) * 0.28
        R.rotation.x = Math.sin(t * 6 + seed * 3 + 1.1) * 0.28
      } else {
        L.rotation.x = Math.sin(t * 0.9 + seed) * 0.04
        R.rotation.x = Math.sin(t * 0.9 + seed + 1) * 0.04
      }
    }
    person.rotation.x = typing ? 0.07 : 0
    person.position.z = typing ? 0.52 : 0.62
    const screen = rec.desk?.getObjectByName('screen')
    if (screen) {
      screen.material.emissiveIntensity = typing
        ? 0.28 + Math.sin(t * 6 + seed * 10) * 0.1
        : 0.05
    }
    if (head) {
      if (glance) {
        head.rotation.y = Math.sin(t * 0.9 + seed * 6) * 0.55
      } else if (camera) {
        const wp = new THREE.Vector3()
        person.getWorldPosition(wp)
        head.rotation.y = Math.atan2(cam.x - wp.x, cam.z - wp.z) * 0.35
      } else {
        head.rotation.y = Math.PI / 8 + Math.sin(t * 0.7 + seed * 8) * 0.12
      }
      head.position.y = 1.28 + Math.sin(t * 2.1 + seed * 6) * 0.016
    }
  }
}
