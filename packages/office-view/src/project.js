import * as THREE from 'three'

const ndc = new THREE.Vector3()

/** Map a world point onto an overlay parent using CSS pixels of the canvas (not the drawing buffer). */
export function projectOverlay(world, camera, renderer, el, parent, offset = '-50%, -100%') {
  ndc.copy(world).project(camera)
  const canvas = renderer.domElement
  const cr = canvas.getBoundingClientRect()
  const pr = parent.getBoundingClientRect()
  const x = (ndc.x * 0.5 + 0.5) * cr.width + (cr.left - pr.left)
  const y = (-ndc.y * 0.5 + 0.5) * cr.height + (cr.top - pr.top)
  const onScreen = Math.abs(ndc.x) <= 1.2 && Math.abs(ndc.y) <= 1.2 && ndc.z >= -1 && ndc.z <= 1
  el.style.transform = `translate(${x}px, ${y}px) translate(${offset})`
  el.style.opacity = onScreen ? '1' : '0'
  el.style.visibility = onScreen ? 'visible' : 'hidden'
  el.style.pointerEvents = onScreen ? 'auto' : 'none'
  return onScreen
}

export function projectFixed(world, camera, renderer, el) {
  ndc.copy(world).project(camera)
  const cr = renderer.domElement.getBoundingClientRect()
  const x = (ndc.x * 0.5 + 0.5) * cr.width + cr.left
  const y = (-ndc.y * 0.5 + 0.5) * cr.height + cr.top
  const onScreen = Math.abs(ndc.x) <= 1.2 && Math.abs(ndc.y) <= 1.2 && ndc.z >= -1 && ndc.z <= 1
  el.style.left = `${x}px`
  el.style.top = `${y}px`
  el.style.opacity = onScreen ? '1' : '0'
  return onScreen
}
