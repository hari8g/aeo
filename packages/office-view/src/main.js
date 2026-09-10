import * as THREE from 'three'
import './office.css'
import { DEPT_ORDER, DEPTS, LAYOUT, THEMES } from './theme.js'
import { countsFromRoster, createPods, highlightPod, pickPod, setPodCounts, setPodTheme } from './pods.js'
import {
  createRoster,
  loadRosterSync,
  pickAgent,
  pulseAgent,
  setBusyAgents,
  tickAgents,
} from './agents.js'
import { createGraph } from './graph.js'
import { createPanel } from './panel.js'
import { createSpine } from './spine.js'
import { applyGates, openGate } from './gates.js'
import { createConnectorBar } from './connectors.js'
import { createBoard } from './board.js'
import { startOfficeClient } from './api.js'
import { createHud } from './hud.js'
import { PHASE_TO_DEPT, hostDept } from './theme.js'
import { createAmbient, createFlow } from './flow.js'
import { createInspector } from './inspect.js'
import { enrichRoster } from './floor.js'

const ISO = new THREE.Vector3(1, 0.92, 1).normalize()
const CAM_DIST = 220
const FR = 42
const PANEL_W = 400

const root = document.getElementById('office-root')
if (!root) {
  console.warn('[office-view] #office-root missing')
} else if (root.dataset.booted === '1') {
  /* React Strict Mode remount — keep the first scene */
} else {
  root.dataset.booted = '1'
  boot(root)
}

function wipeChrome() {
  for (const id of [
    'office-panel',
    'office-connectors',
    'office-board',
    'office-help',
    'office-tip',
    'office-hud',
    'office-metrics',
    'office-badges',
    'office-feed',
    'office-legend',
    'office-inspect',
    'office-now',
    'office-topic-floats',
  ]) {
    document.getElementById(id)?.remove()
  }
  document.querySelectorAll('.office-float').forEach((n) => n.remove())
  document.documentElement.classList.remove('office-io-min')
}

function boot(rootEl) {
  wipeChrome()
  const startDark =
    document.documentElement.dataset.officeTheme === 'dark' ||
    new URLSearchParams(location.search).has('dark') ||
    location.pathname.endsWith('/office/dark')
  let themeName = startDark ? 'dark' : 'light'
  document.documentElement.classList.toggle('office-dark', themeName === 'dark')

  const scene = new THREE.Scene()
  applySceneTheme(scene, THEMES[themeName])

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.VSMShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  rootEl.appendChild(renderer.domElement)

  const hemi = new THREE.HemisphereLight(0xfff6e8, 0xc9c2b4, 0.9)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.35)
  sun.position.set(48, 86, 28)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.camera.left = -90
  sun.shadow.camera.right = 90
  sun.shadow.camera.top = 90
  sun.shadow.camera.bottom = -90
  sun.shadow.camera.near = 10
  sun.shadow.camera.far = 220
  scene.add(sun)

  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320),
    new THREE.ShadowMaterial({ opacity: themeName === 'dark' ? 0.35 : 0.16 }),
  )
  catcher.rotation.x = -Math.PI / 2
  catcher.position.y = -7
  catcher.receiveShadow = true
  scene.add(catcher)

  const { group: podGroup, pods } = createPods(scene, themeName)
  let currentRoster = loadRosterSync()
  let roster3d = createRoster(scene, currentRoster, themeName)
  let flyToDept = () => {}
  setPodCounts(pods, countsFromRoster(currentRoster), new Set())
  const graph = createGraph(scene)
  const spine = createSpine(scene, pods)
  const panel = createPanel({
    onSelect: (feature) => {
      flyToDept(hostDept(feature))
      spine.show(feature)
    },
    onGate: (feature) => openGate(feature),
  })
  let inspectFocus = null
  const inspect = createInspector({
    onSelect: (feature) => {
      spine.show(feature)
    },
    onGate: (feature) => openGate(feature),
    onClose: () => {
      inspectFocus = null
      highlightPod(pods, null)
      document.querySelectorAll('#office-legend [data-dept]').forEach((btn) => {
        btn.classList.remove('on')
      })
    },
  })
  const board = createBoard({
    onSelect: (feature) => {
      board.hide()
      spine.show(feature)
    },
  })
  let openIo = () => {}
  const connectors = createConnectorBar(scene, {
    onSelect: (adapter) => openIo(adapter),
  })
  const flow = createFlow(scene)
  const hud = createHud({
    onDept: (id) => flyToDept(id),
  })
  hud.render({ features: [], busyAgents: [] }, currentRoster.agents?.length ?? 0)
  const help = document.createElement('div')
  help.id = 'office-help'
  help.textContent = '1–6 pods · G graph · B board · D theme · V present · Esc overview'
  document.body.appendChild(help)

  const tip = document.createElement('div')
  tip.id = 'office-tip'
  document.body.appendChild(tip)

  let zoom = 1.2
  const target = new THREE.Vector3(6, 0, 2)
  let liveState = { features: [], agents: [], busyAgents: [] }
  let lastGraph = { nodes: [], links: [], notes: 0 }

  function markLegend(deptId) {
    document.querySelectorAll('#office-legend [data-dept]').forEach((btn) => {
      btn.classList.toggle('on', btn.getAttribute('data-dept') === deptId)
    })
  }

  function openGraph(node) {
    inspectFocus = { kind: 'graph', nodeId: node?.id ?? null }
    highlightPod(pods, null)
    markLegend(null)
    inspect.showGraph(lastGraph, liveState, node)
  }

  function openDept(id) {
    inspectFocus = { kind: 'dept', id }
    highlightPod(pods, id)
    markLegend(id)
    inspect.showDept(id, currentRoster, liveState, lastGraph)
  }

  function closeInspect() {
    inspectFocus = null
    highlightPod(pods, null)
    markLegend(null)
    inspect.hide()
  }

  function refreshInspect() {
    if (!inspect.isOpen() || !inspectFocus) return
    if (inspectFocus.kind === 'graph') {
      const node = inspectFocus.nodeId
        ? (lastGraph.nodes ?? []).find((n) => n.id === inspectFocus.nodeId)
        : undefined
      inspect.showGraph(lastGraph, liveState, node)
      return
    }
    if (inspectFocus.kind === 'io') {
      inspect.showIo(connectors.get(inspectFocus.id), connectors.list())
      return
    }
    inspect.showDept(inspectFocus.id, currentRoster, liveState, lastGraph)
  }
  const ambient = createAmbient(flow, () => ({
    roster: currentRoster,
    state: liveState,
    pulse: (id) => pulseAgent(roster3d, id),
    pulseIo: (id, dept) => connectors.pulse(id, dept),
  }))
  const camFly = { active: false, fromZ: 0.8, toZ: 0.8, fromT: target.clone(), toT: target.clone(), t: 1 }
  const pan = { down: false, x: 0, y: 0 }

  function frameCamera() {
    const w = rootEl.clientWidth || window.innerWidth
    const h = rootEl.clientHeight || window.innerHeight
    renderer.setSize(w, h)
    const aspect = w / Math.max(1, h)
    const panelPx = w < 980 ? 0 : PANEL_W
    const shift = (panelPx / Math.max(w, 1)) * FR * zoom
    camera.left = -FR * aspect * zoom - shift * 0.15
    camera.right = FR * aspect * zoom + shift * 0.85
    camera.top = FR * zoom
    camera.bottom = -FR * zoom
    camera.position.copy(ISO).multiplyScalar(CAM_DIST).add(target)
    camera.lookAt(target)
    camera.updateProjectionMatrix()
  }

  function overview() {
    camFly.fromZ = zoom
    camFly.toZ = 1.2
    camFly.fromT.copy(target)
    camFly.toT.set(0, 0, 0)
    camFly.t = 0
    camFly.active = true
    spine.clear()
  }

  function focusPoint(x, z, zed = 0.42) {
    camFly.fromZ = zoom
    camFly.toZ = zed
    camFly.fromT.copy(target)
    camFly.toT.set(x, 0, z)
    camFly.t = 0
    camFly.active = true
  }

  flyToDept = (id) => {
    const spec = LAYOUT[id]
    if (spec) focusPoint(spec.pos[0], spec.pos[1], 0.38)
    openDept(id)
  }

  openIo = (adapter) => {
    if (!adapter) return
    const dept = PHASE_TO_DEPT[adapter.phase]
    const spec = LAYOUT[dept]
    if (spec) focusPoint(spec.pos[0], spec.pos[1], 0.38)
    inspectFocus = { kind: 'io', id: adapter.id }
    highlightPod(pods, dept)
    markLegend(dept)
    inspect.showIo(adapter, connectors.list())
  }

  overview()
  frameCamera()
  window.addEventListener('resize', frameCamera)

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  renderer.domElement.addEventListener('wheel', (ev) => {
    ev.preventDefault()
    zoom = Math.min(1.6, Math.max(0.28, zoom + ev.deltaY * 0.0008))
    frameCamera()
  }, { passive: false })

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (ev.button === 1 || ev.button === 2) {
      pan.down = true
      pan.x = ev.clientX
      pan.y = ev.clientY
      return
    }
    if (ev.button !== 0) return
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const graphHits = raycaster.intersectObject(graph.sprite)
    if (graphHits.length) {
      const uv = graphHits[0].uv
      const node = graph.pickNode(uv.x, 1 - uv.y)
      focusPoint(LAYOUT.graph.pos[0], LAYOUT.graph.pos[1], 0.34)
      openGraph(node)
      if (node?.featureId) {
        const feature = (liveState.features ?? []).find((f) => f.id === node.featureId)
        if (feature) spine.show(feature)
      }
      return
    }
    const agent = pickAgent(roster3d, raycaster)
    if (agent?.userData?.agent) {
      const waiting = (liveState.features ?? []).find(
        (f) => f.state === 'waiting' && PHASE_TO_DEPT[f.phase] === agent.userData.dept,
      )
      if (waiting) {
        openGate(waiting)
        return
      }
      flyToDept(agent.userData.dept)
      return
    }
    const dept = pickPod(pods, raycaster)
    if (dept) flyToDept(dept)
  })

  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (pan.down) {
      const dx = (ev.clientX - pan.x) * 0.06
      const dy = (ev.clientY - pan.y) * 0.06
      target.x -= dx
      target.z -= dy
      pan.x = ev.clientX
      pan.y = ev.clientY
      frameCamera()
      return
    }
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const overGraph = raycaster.intersectObject(graph.sprite).length > 0
    const overPod = pickPod(pods, raycaster)
    const hit = pickAgent(roster3d, raycaster)
    renderer.domElement.style.cursor = overGraph || overPod || hit ? 'pointer' : ''
    if (overGraph && !hit) {
      tip.style.display = 'block'
      tip.style.left = `${ev.clientX + 12}px`
      tip.style.top = `${ev.clientY + 12}px`
      tip.innerHTML = `<strong>MPS Knowledge graph</strong><br>Click for what has gone in`
      return
    }
    if (overPod && !hit && DEPTS[overPod]) {
      const d = DEPTS[overPod]
      tip.style.display = 'block'
      tip.style.left = `${ev.clientX + 12}px`
      tip.style.top = `${ev.clientY + 12}px`
      tip.innerHTML = `<strong>${d.name}</strong><br>${d.full}`
      return
    }
    if (hit) {
      const a = hit.userData.agent
      const busy = liveState.busyAgents?.find((b) => b.agentId === a.id)
      const headroom =
        a.maxWritesPerMinute != null
          ? `${Math.max(0, a.maxWritesPerMinute - (busy?.writesLastMin ?? 0))}/${a.maxWritesPerMinute} writes/min`
          : ''
      tip.style.display = 'block'
      tip.style.left = `${ev.clientX + 12}px`
      tip.style.top = `${ev.clientY + 12}px`
      tip.innerHTML = `<strong>${a.name}</strong><br>${a.archetype}<br>${a.domain} · ${a.dept}${
        a.requiresGate ? '<br>requires gate' : ''
      }${headroom ? `<br>${headroom}` : ''}`
    } else {
      tip.style.display = 'none'
    }
  })

  window.addEventListener('pointerup', () => {
    pan.down = false
  })
  renderer.domElement.addEventListener('contextmenu', (ev) => ev.preventDefault())

  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return
    const key = ev.key
    if (key === 'Escape') {
      board.hide()
      closeInspect()
      document.documentElement.classList.remove('office-dim')
      overview()
      return
    }
    if (key >= '1' && key <= '6') {
      flyToDept(DEPT_ORDER[Number(key) - 1])
      return
    }
    if (key === 'g' || key === 'G') {
      focusPoint(LAYOUT.graph.pos[0], LAYOUT.graph.pos[1], 0.34)
      openGraph()
      return
    }
    if (key === 'b' || key === 'B') {
      board.toggle()
      return
    }
    if (key === 'd' || key === 'D') {
      themeName = themeName === 'dark' ? 'light' : 'dark'
      document.documentElement.classList.toggle('office-dark', themeName === 'dark')
      applySceneTheme(scene, THEMES[themeName])
      catcher.material.opacity = themeName === 'dark' ? 0.35 : 0.16
      setPodTheme(podGroup, themeName)
      return
    }
    if (key === 'v' || key === 'V') {
      document.documentElement.classList.toggle('office-dim')
    }
  })

  const client = startOfficeClient({
    onRoster: (data) => {
      if (!data?.agents?.length) return
      currentRoster = enrichRoster(data)
      scene.remove(roster3d.group)
      roster3d.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
      })
      roster3d = createRoster(scene, currentRoster, themeName)
      setPodCounts(pods, countsFromRoster(currentRoster), liveDeptSet(liveState))
      hud.render(liveState, currentRoster.agents.length)
      refreshInspect()
    },
    onGraph: (data) => {
      lastGraph = data
      graph.update(data, (node) => graph.spawnWrite(scene, node, pods))
      refreshInspect()
    },
    onState: (data) => {
      liveState = data
      panel.render(data)
      board.render(data)
      hud.render(data, currentRoster.agents?.length ?? 0)
      setBusyAgents(
        roster3d,
        (data.busyAgents ?? []).map((b) => b.agentId),
        liveDeptSet(data),
      )
      setPodCounts(pods, countsFromRoster(currentRoster), liveDeptSet(data))
      applyGates(data, roster3d)
      refreshInspect()
    },
    onEvent: (event) => {
      const noted = flow.noteEvent(event, currentRoster)
      if (noted?.agentId) pulseAgent(roster3d, noted.agentId)
      if (event?.metadata?.connector) {
        connectors.pulse(event.metadata.connector, PHASE_TO_DEPT[event.domain] ?? noted?.dept ?? 'cor')
      }
      client.refresh()
    },
    onConnectors: (rows) => connectors.render(rows),
  })

  let last = performance.now()
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (camFly.active) {
      camFly.t = Math.min(1, camFly.t + dt * 1.4)
      const k = ease(camFly.t)
      zoom = camFly.fromZ + (camFly.toZ - camFly.fromZ) * k
      target.lerpVectors(camFly.fromT, camFly.toT, k)
      frameCamera()
      if (camFly.t >= 1) camFly.active = false
    }
    tickAgents(roster3d, now / 1000, camera)
    flow.tick(dt)
    ambient.tick(dt, roster3d)
    graph.tick(dt)
    spine.tick(dt, camera, renderer)
    renderer.render(scene, camera)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)

  window.addEventListener('beforeunload', () => {
    client.stop()
    hud.destroy()
    flow.destroy()
  })
}

function applySceneTheme(scene, theme) {
  scene.background = new THREE.Color(theme.fog)
  scene.fog = null
}

function liveDeptSet(state) {
  const set = new Set()
  for (const f of state?.features ?? []) {
    if (f.state === 'doing' || f.state === 'waiting' || f.officeTopic) {
      const dept = hostDept(f) || PHASE_TO_DEPT[f.phase]
      if (dept) set.add(dept)
    }
  }
  for (const b of state?.busyAgents ?? []) {
    const dept = PHASE_TO_DEPT[b.domain]
    if (dept) set.add(dept)
  }
  return set
}

function ease(t) {
  return t * t * (3 - 2 * t)
}
