import * as THREE from 'three'
import { LAYOUT, PHASE_ORDER, PHASE_TO_DEPT, hexToInt, phaseColor } from './theme.js'
import { resetPodDim, setPodDim } from './pods.js'

export function createSpine(scene, pods) {
  const group = new THREE.Group()
  group.name = 'spine'
  scene.add(group)
  let light = null
  let curve = null
  let t = 0
  let running = false
  let labels = []

  function clear() {
    running = false
    group.clear()
    light = null
    curve = null
    labels.forEach((l) => l.remove())
    labels = []
    resetPodDim(pods)
  }

  function show(feature) {
    clear()
    const phases = feature.journey?.length
      ? feature.journey
      : PHASE_ORDER.filter(
          (p) => (feature.completedPhases ?? []).includes(p) || p === feature.phase,
        )
    if (!phases.length) return

    const reached = new Set(phases.map((p) => PHASE_TO_DEPT[p]))
    setPodDim(pods, reached, 0.18)

    const pts = phases.map((p) => {
      const dept = PHASE_TO_DEPT[p]
      const pos = LAYOUT[dept].pos
      return new THREE.Vector3(pos[0], 2.6, pos[1])
    })
    if (pts.length === 1) pts.push(pts[0].clone().add(new THREE.Vector3(0.01, 0, 0)))
    curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4)
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 64, 0.08, 8, false),
      new THREE.MeshBasicMaterial({
        color: hexToInt(phaseColor(feature.phase)),
        transparent: true,
        opacity: 0.55,
      }),
    )
    group.add(tube)

    light = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 14, 12),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: hexToInt(phaseColor(feature.phase)),
        emissiveIntensity: 2.4,
      }),
    )
    group.add(light)

    phases.forEach((p, i) => {
      const dwell = feature.dwell?.[p]
      const label = document.createElement('div')
      label.className = 'office-float'
      label.textContent = dwell
        ? `${p} · ${dwell}`
        : i === phases.length - 1
          ? `${p} · now`
          : p
      document.body.appendChild(label)
      labels.push({
        el: label,
        world: pts[i],
      })
    })

    t = 0
    running = true
  }

  function tick(dt, camera, renderer) {
    if (!running || !curve || !light) return
    t = Math.min(1, t + dt * 0.18)
    const p = curve.getPoint(t)
    light.position.copy(p)
    light.material.emissiveIntensity = 1.6 + Math.sin(performance.now() / 180) * 0.6
    const rect = renderer.domElement.getBoundingClientRect()
    for (const lab of labels) {
      const v = lab.world.clone().project(camera)
      lab.el.style.left = `${((v.x + 1) / 2) * rect.width + rect.left}px`
      lab.el.style.top = `${((1 - v.y) / 2) * rect.height + rect.top}px`
    }
  }

  return { show, clear, tick, isActive: () => running }
}
