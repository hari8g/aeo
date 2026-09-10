import * as THREE from 'three'
import { DEPTS, LAYOUT, hexToInt } from './theme.js'

const PLINTH_H = 2.6
const R_TOP = 0.55
const R_SIDE = 0.4

function roundedBox(w, h, d, r, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.88,
      metalness: 0,
    }),
  )
  mesh.userData.radius = r
  return mesh
}

function paintHeading(dept) {
  const W = 1024
  const H = 300
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(253,255,248,0.94)'
  ctx.beginPath()
  ctx.roundRect(8, 8, W - 16, H - 16, 28)
  ctx.fill()
  ctx.strokeStyle = 'rgba(21,20,20,0.10)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.beginPath()
  ctx.fillStyle = dept.chip
  ctx.arc(72, 150, 16, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = dept.chip
  ctx.globalAlpha = 0.42
  ctx.beginPath()
  ctx.roundRect(48, 28, 820, 128, 24)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = dept.ink
  ctx.font = '800 104px Inter, system-ui, sans-serif'
  ctx.fillText(dept.name, 110, 126)
  ctx.fillStyle = '#151414'
  ctx.font = '400 52px "Instrument Serif", Georgia, serif'
  ctx.fillText(dept.full, 110, 226)
  return canvas
}

function headingPlaque(dept, spec, deptId) {
  const tex = new THREE.CanvasTexture(paintHeading(dept))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  const w = Math.min(spec.w - 2.2, 9.4)
  const h = w * (300 / 1024)
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.16, h + 0.16, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
  )
  plate.castShadow = true
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.38,
      metalness: 0,
    }),
  )
  face.position.z = 0.046
  const g = new THREE.Group()
  g.add(plate, face)
  const len = Math.hypot(spec.pos[0], spec.pos[1]) || 1
  const ux = spec.pos[0] / len
  const uz = spec.pos[1] / len
  g.position.set(
    spec.pos[0] - ux * (Math.min(spec.w, spec.d) * 0.18),
    0.18 + h / 2,
    spec.pos[1] - uz * (Math.min(spec.w, spec.d) * 0.18),
  )
  g.rotation.y = Math.PI / 4
  g.userData = { kind: 'heading', dept: deptId }
  g.traverse((o) => {
    o.userData.kind = 'heading'
    o.userData.dept = deptId
  })
  return g
}

function walkway(from, to, color = 0xefefe8) {
  const dx = to[0] - from[0]
  const dz = to[1] - from[1]
  const len = Math.hypot(dx, dz)
  const mesh = roundedBox(2.4, 0.14, len, 0.35, color)
  mesh.position.set((from[0] + to[0]) / 2, -0.05, (from[1] + to[1]) / 2)
  mesh.rotation.y = Math.atan2(dx, dz)
  mesh.receiveShadow = true
  mesh.userData.kind = 'walkway'
  return mesh
}

export function buildPods(scene, theme) {
  const group = new THREE.Group()
  group.name = 'pods'
  const pods = {}

  for (const [id, spec] of Object.entries(LAYOUT)) {
    if (id === 'graph') continue
    const dept = DEPTS[id]
    const body = roundedBox(spec.w, PLINTH_H, spec.d, R_SIDE, 0xffffff)
    body.position.set(spec.pos[0], -PLINTH_H / 2 - 0.02, spec.pos[1])
    body.castShadow = true
    body.receiveShadow = true
    body.userData = { kind: 'pod', dept: id }

    const floor = roundedBox(spec.w - 0.7, 0.22, spec.d - 0.7, R_TOP, hexToInt(dept.floor))
    floor.position.set(spec.pos[0], 0.12, spec.pos[1])
    floor.receiveShadow = true
    floor.userData = { kind: 'floor', dept: id }

    const plaque = headingPlaque(dept, spec, id)
    group.add(body, floor, plaque)
    pods[id] = { mesh: body, floor, plaque, spec, dept }
  }

  const walkColor = theme === 'dark' ? 0x2a2b30 : 0xefefe8
  const routes = [
    [[16, -10], [7, -5]],
    [[0, -22], [0, -8]],
    [[-16, -10], [-7, -5]],
    [[-16, 10], [-7, 5]],
    [[0, 24], [0, 8]],
    [[16, 10], [7, 5]],
  ]
  for (const [a, b] of routes) group.add(walkway(a, b, walkColor))

  scene.add(group)
  return { group, pods }
}

export function createPods(scene, theme) {
  const name = typeof theme === 'string' ? theme : theme?.cream === 0x151619 ? 'dark' : 'light'
  return buildPods(scene, name)
}

export function countsFromRoster(roster) {
  const counts = {}
  for (const a of roster?.agents ?? []) counts[a.dept] = (counts[a.dept] || 0) + 1
  return counts
}

export function setPodCounts() {
  /* HTML badges own headcount; kept for callers */
}

export function setPodTheme(podsOrGroup, theme) {
  const dark = theme === 'dark' || theme?.cream === 0x151619
  const walk = dark ? 0x2a2b30 : 0xefefe8
  const group = podsOrGroup?.group ?? podsOrGroup
  group?.traverse?.((obj) => {
    if (obj.userData?.kind === 'walkway') obj.material.color.setHex(walk)
  })
}

export function setPodDim(pods, reached, dim = 0.18) {
  for (const [id, pod] of Object.entries(pods)) {
    const on = reached.has(id)
    const opacity = on ? 1 : dim
    for (const mesh of [pod.mesh, pod.floor]) {
      mesh.material.transparent = opacity < 1
      mesh.material.opacity = opacity
    }
    pod.plaque?.traverse?.((obj) => {
      if (obj.material) {
        obj.material.transparent = opacity < 1
        obj.material.opacity = opacity
      }
    })
  }
}

export function resetPodDim(pods) {
  setPodDim(pods, new Set(Object.keys(pods)), 1)
}

export function pickPod(pods, raycaster) {
  const meshes = []
  for (const pod of Object.values(pods)) {
    meshes.push(pod.mesh, pod.floor)
    pod.plaque?.traverse((o) => {
      if (o.isMesh) meshes.push(o)
    })
  }
  const hits = raycaster.intersectObjects(meshes, false)
  if (!hits.length) return null
  let obj = hits[0].object
  while (obj && !obj.userData?.dept) obj = obj.parent
  return obj?.userData?.dept ?? null
}

export function highlightPod(pods, deptId) {
  for (const [id, pod] of Object.entries(pods)) {
    const on = id === deptId
    pod.mesh.material.emissive = new THREE.Color(on ? 0x111111 : 0x000000)
    pod.mesh.material.emissiveIntensity = on ? 0.04 : 0
  }
}
