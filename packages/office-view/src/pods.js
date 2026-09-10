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
  const W = 1600
  const H = 520
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#151414'
  ctx.beginPath()
  ctx.roundRect(0, 0, W, H, 36)
  ctx.fill()
  ctx.fillStyle = '#FDFFF8'
  ctx.beginPath()
  ctx.roundRect(6, 6, W - 12, H - 12, 30)
  ctx.fill()
  ctx.fillStyle = dept.chip
  ctx.fillRect(6, 6, 28, H - 12)
  ctx.fillStyle = dept.ink
  ctx.font = '800 188px Inter, system-ui, sans-serif'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(dept.name, 72, 248)
  ctx.fillStyle = '#151414'
  ctx.globalAlpha = 0.72
  ctx.font = '400 86px "Instrument Serif", Georgia, serif'
  ctx.fillText(dept.full, 74, 400)
  ctx.globalAlpha = 1
  return canvas
}

/** Stand the title on the camera-facing side of the pod (iso looks from +X +Z). */
function plaqueAnchor(spec) {
  const [x, z] = spec.pos
  const fx = 0.707
  const fz = 0.707
  const reach = (spec.w / 2) * fx + (spec.d / 2) * fz
  const gap = 3.4
  return [x + fx * (reach + gap), z + fz * (reach + gap)]
}

function headingPlaque(dept, spec, deptId) {
  const tex = new THREE.CanvasTexture(paintHeading(dept))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  const w = 16.4
  const h = w * (520 / 1600)
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.22, h + 0.22, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x151414, roughness: 0.45 }),
  )
  plate.castShadow = true
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.32,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  )
  face.position.z = 0.07
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 1.15, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x151414, roughness: 0.6 }),
  )
  post.position.set(0, -(h / 2) - 0.52, 0)
  const g = new THREE.Group()
  g.add(plate, face, post)
  const [px, pz] = plaqueAnchor(spec)
  g.position.set(px, 1.15 + h / 2, pz)
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
