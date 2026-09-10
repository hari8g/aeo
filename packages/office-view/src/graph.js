import * as THREE from 'three'
import {
  DEPTS,
  KIND_TO_PHASE,
  LAYOUT,
  PHASE_ORDER,
  PHASE_TO_DEPT,
  hexToInt,
  phaseColor,
} from './theme.js'

const PX = 1280
const PY = 800
const PW = 15.2
const PH = PW * (PY / PX)

/** Canvas-space hex (y down) matching the floor ring. */
const HEX = {
  gtm: [0, 1],
  cor: [0.866, 0.5],
  mkt: [0.866, -0.5],
  cx: [0, -1],
  px: [-0.866, -0.5],
  eng: [-0.866, 0.5],
}

const PLOT = { x: 56, y: 118, w: PX - 112, h: PY - 198 }

export function createGraph(scene) {
  const canvas = document.createElement('canvas')
  canvas.width = PX
  canvas.height = PY
  const ctx = canvas.getContext('2d')
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false

  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(8.6, 8.6, 0.32, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.58 }),
  )
  stand.position.set(0, 0.16, 0)
  stand.rotation.y = Math.PI / 6
  stand.castShadow = true
  stand.receiveShadow = true

  const board = new THREE.Group()
  board.rotation.order = 'YXZ'
  board.rotation.y = Math.PI / 4
  board.rotation.x = -Math.PI / 2 + 0.38
  board.position.set(0, 1.15, 0)
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(PW + 0.36, PH + 0.36, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
  )
  frame.position.z = -0.02
  frame.castShadow = true
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(PW, PH),
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.3,
      metalness: 0,
      transparent: true,
      side: THREE.DoubleSide,
    }),
  )
  face.position.z = 0.03
  face.userData.isGraph = true
  board.add(frame, face)

  scene.add(stand, board)

  const flying = []
  let lastIds = new Set()
  let snapshot = { nodes: [], links: [], notes: 0 }
  let placed = []

  function etch(data) {
    snapshot = data
    const nodes = data.nodes ?? []
    const links = data.links ?? []
    placed = layoutNodes(nodes)

    ctx.clearRect(0, 0, PX, PY)
    ctx.fillStyle = '#FFFFFF'
    roundRect(ctx, 8, 8, PX - 16, PY - 16, 22)
    ctx.fill()
    ctx.strokeStyle = 'rgba(21,20,20,0.16)'
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.fillStyle = 'rgba(152, 165, 239, 0.36)'
    roundRect(ctx, 40, 28, 92, 40, 10)
    ctx.fill()
    ctx.fillStyle = '#151414'
    ctx.font = '800 28px Inter, system-ui, sans-serif'
    ctx.fillText('MPS', 54, 56)
    ctx.font = '700 28px Inter, system-ui, sans-serif'
    ctx.fillText('Knowledge graph', 146, 56)
    ctx.font = '400 20px "Instrument Serif", Georgia, serif'
    ctx.fillStyle = '#5A5A5A'
    ctx.fillText('Shared memory · six departments', 146, 82)

    ctx.textAlign = 'right'
    ctx.fillStyle = '#151414'
    ctx.font = '600 22px Inter, system-ui, sans-serif'
    ctx.fillText(`${nodes.length} nodes`, PX - 48, 50)
    ctx.font = '400 18px Inter, system-ui, sans-serif'
    ctx.fillStyle = '#5A5A5A'
    ctx.fillText(`${links.length} edges · click a cluster`, PX - 48, 76)
    ctx.textAlign = 'left'

    ctx.strokeStyle = 'rgba(21,20,20,0.08)'
    ctx.beginPath()
    ctx.moveTo(40, 100)
    ctx.lineTo(PX - 40, 100)
    ctx.stroke()

    const cx = PLOT.x + PLOT.w / 2
    const cy = PLOT.y + PLOT.h / 2
    const ring = Math.min(PLOT.w, PLOT.h) * 0.36

    ctx.save()
    ctx.strokeStyle = 'rgba(21,20,20,0.07)'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const id = ['gtm', 'cor', 'mkt', 'cx', 'px', 'eng'][i]
      const [hx, hy] = HEX[id]
      const x = cx + hx * ring
      const y = cy + hy * ring
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
    ctx.restore()

    const byId = new Map(placed.map((p) => [p.node.id, p]))
    ctx.lineCap = 'round'
    for (const l of links) {
      const a = nodes[l.source]
      const b = nodes[l.target]
      const pa = a && byId.get(a.id)
      const pb = b && byId.get(b.id)
      if (!pa || !pb) continue
      ctx.strokeStyle = 'rgba(21,20,20,0.10)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
    }

    for (const p of placed) {
      ctx.beginPath()
      ctx.fillStyle = p.color
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(21,20,20,0.16)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    ctx.textAlign = 'center'
    for (const [deptId, dir] of Object.entries(HEX)) {
      const d = DEPTS[deptId]
      const x = cx + dir[0] * (ring + 78)
      const y = cy + dir[1] * (ring + 78)
      ctx.fillStyle = d.chip
      roundRect(ctx, x - 54, y - 16, 108, 28, 8)
      ctx.fill()
      ctx.fillStyle = '#151414'
      ctx.font = '800 15px Inter, system-ui, sans-serif'
      ctx.fillText(d.name, x, y + 5)
    }
    ctx.textAlign = 'left'

    let lx = 48
    const ly = PY - 44
    ctx.font = '600 12px Inter, system-ui, sans-serif'
    ctx.fillStyle = '#5A5A5A'
    ctx.fillText('Listen → Learn', lx, ly)
    lx += 118
    for (const phase of PHASE_ORDER) {
      const d = DEPTS[PHASE_TO_DEPT[phase]]
      ctx.fillStyle = d.chip
      ctx.beginPath()
      ctx.arc(lx, ly - 4, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#151414'
      ctx.font = '600 12px Inter, system-ui, sans-serif'
      ctx.fillText(d.short, lx + 10, ly)
      lx += 72
    }

    tex.needsUpdate = true
  }

  function update(data, spawnNode) {
    const next = new Set((data.nodes ?? []).map((n) => n.id))
    if (lastIds.size) {
      for (const n of data.nodes ?? []) {
        if (!lastIds.has(n.id)) spawnNode?.(n)
      }
    }
    lastIds = next
    etch(data)
  }

  function spawnWrite(sceneRef, node) {
    const phase = KIND_TO_PHASE[node.kind] ?? 'decide'
    const dept = PHASE_TO_DEPT[phase]
    const layout = LAYOUT[dept] ?? LAYOUT.graph
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 10),
      new THREE.MeshBasicMaterial({ color: phaseColor(phase) }),
    )
    mesh.position.set(layout.pos[0], 2.2, layout.pos[1])
    sceneRef.add(mesh)
    const dest = new THREE.Vector3(0, 1.2, 0)
    flying.push({
      mesh,
      t: 0,
      from: mesh.position.clone(),
      to: dest,
    })
  }

  function tick(dt) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i]
      f.t += dt * 0.9
      const k = Math.min(1, f.t)
      f.mesh.position.lerpVectors(f.from, f.to, k)
      f.mesh.position.y += Math.sin(k * Math.PI) * 3
      if (k >= 1) {
        scene.remove(f.mesh)
        f.mesh.geometry.dispose()
        flying.splice(i, 1)
      }
    }
  }

  function pickNode(nx, ny) {
    const x = nx * PX
    const y = ny * PY
    let best = null
    let bestD = 22
    for (const p of placed) {
      const d = Math.hypot(x - p.x, y - p.y)
      if (d < Math.max(bestD, p.r + 8)) {
        bestD = d
        best = p.node
      }
    }
    return best
  }

  etch({ nodes: [], links: [], notes: 0 })
  return { sprite: face, etch, update, spawnWrite, tick, pickNode, getSnapshot: () => snapshot }
}

function layoutNodes(nodes) {
  const buckets = Object.fromEntries(PHASE_ORDER.map((p) => [p, []]))
  const hub = []
  for (const n of nodes) {
    if (n.kind === 'FEATURE') hub.push(n)
    else buckets[KIND_TO_PHASE[n.kind] ?? 'decide'].push(n)
  }

  const cx = PLOT.x + PLOT.w / 2
  const cy = PLOT.y + PLOT.h / 2
  const ring = Math.min(PLOT.w, PLOT.h) * 0.36
  const out = []

  pack(hub, cx, cy, 46, out, '#98A5EF')

  for (const phase of PHASE_ORDER) {
    const dept = PHASE_TO_DEPT[phase]
    const [hx, hy] = HEX[dept]
    pack(buckets[phase], cx + hx * ring, cy + hy * ring, 58, out, phaseColor(phase))
  }
  return out
}

function pack(list, ox, oy, radius, out, color) {
  const n = list.length
  if (!n) return
  const maxR = Math.min(4.6, Math.max(2.4, 22 / Math.sqrt(n)))
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / n
    const twist = i * 2.399963
    const rad = n === 1 ? 0 : radius * Math.sqrt((i + 0.4) / n) * 0.92
    out.push({
      node: list[i],
      x: ox + Math.cos(twist) * rad,
      y: oy + Math.sin(twist) * rad,
      r: maxR,
      color,
      t,
    })
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
