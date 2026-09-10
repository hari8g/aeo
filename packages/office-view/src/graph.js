import * as THREE from 'three'
import { KIND_TO_PHASE, LAYOUT, PHASE_TO_DEPT, phaseColor } from './theme.js'

const BW = 17
const BH = BW * 0.6
const PX = 1024
const PY = Math.round(PX * 0.6)

export function createGraph(scene) {
  const canvas = document.createElement('canvas')
  canvas.width = PX
  canvas.height = PY
  const ctx = canvas.getContext('2d')
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  )
  sprite.scale.set(BW, BH, 1)
  sprite.position.set(LAYOUT.graph.pos[0], 8.4, LAYOUT.graph.pos[1])
  sprite.userData.isGraph = true
  scene.add(sprite)

  const flying = []
  let lastIds = new Set()
  let snapshot = { nodes: [], links: [], notes: 0 }

  function etch(data) {
    snapshot = data
    const nodes = data.nodes ?? []
    const links = data.links ?? []
    const deg = new Array(nodes.length).fill(0)
    for (const l of links) {
      if (l.source != null) deg[l.source]++
      if (l.target != null) deg[l.target]++
    }
    ctx.clearRect(0, 0, PX, PY)
    ctx.fillStyle = '#FDFFF8'
    ctx.beginPath()
    ctx.roundRect(8, 8, PX - 16, PY - 16, 28)
    ctx.fill()
    ctx.strokeStyle = 'rgba(21,20,20,0.12)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = 'rgba(152, 165, 239, 0.38)'
    ctx.beginPath()
    ctx.roundRect(28, 22, 118, 44, 12)
    ctx.fill()
    ctx.fillStyle = '#151414'
    ctx.font = '800 36px Inter, system-ui, sans-serif'
    ctx.fillText('MPS', 40, 54)
    ctx.font = '700 30px Inter, system-ui, sans-serif'
    ctx.fillText('Knowledge graph', 158, 54)
    ctx.font = '400 24px "Instrument Serif", Georgia, serif'
    ctx.fillStyle = '#5A5A5A'
    ctx.fillText(`${data.notes ?? nodes.length} nodes · ${links.length} edges · click for detail`, 36, 92)

    const cx = PX / 2
    const cy = PY / 2 + 18
    const sx = PX * 0.38
    const sy = PY * 0.32

    ctx.strokeStyle = 'rgba(21,20,20,0.16)'
    ctx.lineWidth = 1
    for (const l of links) {
      const a = nodes[l.source]
      const b = nodes[l.target]
      if (!a || !b) continue
      ctx.beginPath()
      ctx.moveTo(cx + a.x * sx, cy + a.y * sy)
      ctx.lineTo(cx + b.x * sx, cy + b.y * sy)
      ctx.stroke()
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const phase = KIND_TO_PHASE[n.kind] ?? 'decide'
      const r = (0.8 + Math.sqrt((deg[i] || 0) * 0.28)) * (PX / 130)
      ctx.beginPath()
      ctx.fillStyle = phaseColor(phase)
      ctx.arc(cx + n.x * sx, cy + n.y * sy, Math.max(2.2, r), 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(21,20,20,0.22)'
      ctx.lineWidth = 1
      ctx.stroke()
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
      new THREE.SphereGeometry(0.28, 12, 10),
      new THREE.MeshBasicMaterial({ color: phaseColor(phase) }),
    )
    mesh.position.set(layout.pos[0], 2.2, layout.pos[1])
    sceneRef.add(mesh)
    flying.push({
      mesh,
      t: 0,
      from: mesh.position.clone(),
      to: sprite.position.clone(),
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
        flying.splice(i, 1)
      }
    }
    sprite.material.rotation = 0
  }

  function pickNode(nx, ny) {
    const nodes = snapshot.nodes ?? []
    const cx = PX / 2
    const cy = PY / 2 + 18
    const sx = PX * 0.38
    const sy = PY * 0.32
    let best = null
    let bestD = 28
    for (const n of nodes) {
      const x = cx + n.x * sx
      const y = cy + n.y * sy
      const d = Math.hypot(nx * PX - x, ny * PY - y)
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    return best
  }

  etch({ nodes: [], links: [], notes: 0 })
  return { sprite, etch, update, spawnWrite, tick, pickNode, getSnapshot: () => snapshot }
}
