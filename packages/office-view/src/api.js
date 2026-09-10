export function startOfficeClient({ onGraph, onState, onEvent, onConnectors, onRoster }) {
  let graphTimer = 0
  let stateTimer = 0
  let source = null
  let stopped = false

  async function pullGraph() {
    try {
      const res = await fetch('/api/office/graph')
      if (!res.ok) return
      onGraph?.(await res.json())
    } catch {
      /* platform offline */
    }
  }

  async function pullState() {
    try {
      const res = await fetch('/api/office/state')
      if (!res.ok) return
      onState?.(await res.json())
    } catch {
      /* platform offline */
    }
  }

  async function pullConnectors() {
    try {
      const res = await fetch('/api/connectors')
      if (!res.ok) return
      onConnectors?.(await res.json())
    } catch {
      /* ignore */
    }
  }

  async function pullRoster() {
    try {
      const res = await fetch('/api/office/roster')
      if (!res.ok) return
      onRoster?.(await res.json())
    } catch {
      /* ignore */
    }
  }

  function openSse() {
    try {
      source = new EventSource('/api/office/stream')
      source.onmessage = (ev) => {
        try {
          onEvent?.(JSON.parse(ev.data))
        } catch {
          /* skip */
        }
      }
      source.onerror = () => {
        source?.close()
        source = null
        if (!stopped) setTimeout(openSse, 4000)
      }
    } catch {
      source = null
    }
  }

  pullRoster()
  pullGraph()
  pullState()
  pullConnectors()
  graphTimer = window.setInterval(pullGraph, 8000)
  stateTimer = window.setInterval(pullState, 2500)
  openSse()

  return {
    refresh: () => {
      pullGraph()
      pullState()
      pullConnectors()
    },
    stop() {
      stopped = true
      window.clearInterval(graphTimer)
      window.clearInterval(stateTimer)
      source?.close()
    },
  }
}
